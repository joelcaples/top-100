const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { BlobServiceClient } = require("@azure/storage-blob");
const sharp = require("sharp");

const GENERATED_IMAGE_DIR = path.join(__dirname, "..", "data", "generated-images");
const GENERATED_IMAGE_URL_PREFIX = "/generated-images";
const OPENVERSE_API_URL = "https://api.openverse.org/v1/images/";
const IMAGE_PAGE_SIZE = 16;
const OUTPUT_WIDTH = 640;
const OUTPUT_HEIGHT = 480;
const STORAGE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const STORAGE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER || "generated-images";
const USE_BLOB_STORAGE = Boolean(STORAGE_CONNECTION_STRING);
const CATEGORY_QUERY_HINTS = {
  music: ["band", "musician", "logo", "album cover"],
  movies: ["film", "poster", "still"],
  sports: ["athlete", "team", "action"],
  gaming: ["game", "character", "art"]
};

const GENERIC_STOCK_TERMS = /(stock|vector|illustration|clipart|template|background)/;
let containerClientPromise;

async function getContainerClient() {
  if (!USE_BLOB_STORAGE) {
    return null;
  }

  if (!containerClientPromise) {
    containerClientPromise = (async () => {
      const blobServiceClient = BlobServiceClient.fromConnectionString(STORAGE_CONNECTION_STRING);
      const containerClient = blobServiceClient.getContainerClient(STORAGE_CONTAINER);
      await containerClient.createIfNotExists({ access: "blob" });
      return containerClient;
    })();
  }

  return containerClientPromise;
}

function buildQueries(entry) {
  const queries = new Set();
  const name = entry.name.trim();
  const category = entry.category.trim();
  const categoryKey = category.toLowerCase();
  const hints = CATEGORY_QUERY_HINTS[categoryKey] || [];

  if (name && category) {
    queries.add(`${name} ${category}`);
    queries.add(`"${name}" ${category}`);
  }

  for (const hint of hints) {
    queries.add(`${name} ${hint}`);
    queries.add(`"${name}" ${hint}`);
  }

  if (name) {
    queries.add(name);
  }

  return [...queries];
}

function tokenize(value) {
  return (value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function normaliseTags(tags) {
  return (tags || []).map((tag) => {
    if (typeof tag === "string") {
      return tag;
    }

    return tag?.name || "";
  });
}

function getCandidateText(candidate) {
  return [candidate.title, candidate.creator, candidate.source, ...normaliseTags(candidate.tags)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getCandidateScore(candidate, entry, query) {
  const haystack = getCandidateText(candidate);
  const namePhrase = entry.name.toLowerCase();
  const categoryPhrase = entry.category.toLowerCase();
  const queryTokens = tokenize(query);
  const nameTokens = tokenize(entry.name);
  const categoryTokens = tokenize(entry.category);
  let score = 0;
  let nameTokenMatches = 0;
  let categoryTokenMatches = 0;

  if (haystack.includes(namePhrase)) {
    score += 50;
  }

  if (categoryPhrase && haystack.includes(categoryPhrase)) {
    score += 16;
  }

  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += 8;
    }
  }

  for (const token of nameTokens) {
    if (haystack.includes(token)) {
      score += 10;
      nameTokenMatches += 1;
    }
  }

  for (const token of categoryTokens) {
    if (haystack.includes(token)) {
      score += 4;
      categoryTokenMatches += 1;
    }
  }

  if (nameTokens.length > 0 && nameTokenMatches === 0) {
    score -= 40;
  }

  if (categoryTokens.length > 0 && categoryTokenMatches === 0) {
    score -= 8;
  }

  const width = Number(candidate.width || 0);
  const height = Number(candidate.height || 0);
  if (width >= 400 && height >= 300) {
    score += 18;
  }

  if (width && height) {
    const areaScore = Math.min((width * height) / 250000, 18);
    const ratio = width / height;
    const ratioScore = Math.max(0, 10 - Math.abs(ratio - 1.2) * 10);
    score += areaScore + ratioScore;
  }

  const title = (candidate.title || "").toLowerCase();
  if (/(stock|vector|illustration|clipart|template|background|icon)/.test(title)) {
    score -= 20;
  }

  if (GENERIC_STOCK_TERMS.test(haystack)) {
    score -= 18;
  }

  if (categoryPhrase === "music") {
    if (/(band|musician|artist|album|cover|logo)/.test(haystack)) {
      score += 16;
    }

    if (/(music background|musical background|abstract music|equalizer)/.test(haystack)) {
      score -= 20;
    }
  }

  if (!candidate.url && !candidate.thumbnail) {
    score -= 100;
  }

  return score;
}

async function searchOpenverse(entry) {
  const ranked = [];
  const seen = new Set();

  for (const query of buildQueries(entry)) {
    const response = await fetch(
      `${OPENVERSE_API_URL}?q=${encodeURIComponent(query)}&page_size=${IMAGE_PAGE_SIZE}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "listflair-app/1.0"
        }
      }
    );

    if (!response.ok) {
      continue;
    }

    const payload = await response.json();
    const results = payload.results || [];
    for (const candidate of results) {
      const dedupeKey = candidate.id || candidate.foreign_landing_url || candidate.url || candidate.thumbnail;
      if (!dedupeKey || seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      ranked.push({
        query,
        score: getCandidateScore(candidate, entry, query),
        sourceUrl: candidate.foreign_landing_url || candidate.url || null,
        fetchUrl: candidate.url || candidate.thumbnail || null,
        thumbnailUrl: candidate.thumbnail || null,
        candidate
      });
    }
  }

  ranked.sort((left, right) => right.score - left.score);
  return ranked;
}

async function ensureGeneratedImageDir() {
  await fs.promises.mkdir(GENERATED_IMAGE_DIR, { recursive: true });
}

async function downloadBuffer(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "image/*",
      "User-Agent": "listflair-app/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function cacheImageLocally(entry, rankedCandidate) {
  let imageBuffer;
  try {
    imageBuffer = await downloadBuffer(rankedCandidate.fetchUrl);
  } catch (error) {
    if (!rankedCandidate.thumbnailUrl || rankedCandidate.thumbnailUrl === rankedCandidate.fetchUrl) {
      throw error;
    }
    imageBuffer = await downloadBuffer(rankedCandidate.thumbnailUrl);
  }

  const fileHash = crypto
    .createHash("sha1")
    .update(`${entry.id}:${rankedCandidate.fetchUrl}:${Date.now()}`)
    .digest("hex")
    .slice(0, 12);
  const fileName = `${entry.id}-${fileHash}.jpg`;
  const transformedBuffer = await sharp(imageBuffer)
    .rotate()
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  if (USE_BLOB_STORAGE) {
    const containerClient = await getContainerClient();
    const blobClient = containerClient.getBlockBlobClient(fileName);
    await blobClient.uploadData(transformedBuffer, {
      blobHTTPHeaders: { blobContentType: "image/jpeg" }
    });

    return {
      imageUrl: blobClient.url,
      imageSource: rankedCandidate.sourceUrl,
      imageQuery: rankedCandidate.query
    };
  }

  await ensureGeneratedImageDir();
  const filePath = path.join(GENERATED_IMAGE_DIR, fileName);
  await fs.promises.writeFile(filePath, transformedBuffer);

  return {
    imageUrl: `${GENERATED_IMAGE_URL_PREFIX}/${fileName}`,
    imageSource: rankedCandidate.sourceUrl,
    imageQuery: rankedCandidate.query
  };
}

async function findAndCacheImageForEntry(entry, resultIndex = 0) {
  const rankedCandidates = await searchOpenverse(entry);
  if (!rankedCandidates.length) {
    throw new Error("No suitable image found");
  }

  const safeIndex = Math.max(0, resultIndex);
  const rankedCandidate = rankedCandidates[safeIndex % rankedCandidates.length];
  const cachedImage = await cacheImageLocally(entry, rankedCandidate);

  return {
    ...cachedImage,
    imageResultIndex: safeIndex % rankedCandidates.length
  };
}

function isGeneratedImageUrl(imageUrl) {
  if (typeof imageUrl !== "string") {
    return false;
  }

  if (imageUrl.startsWith(`${GENERATED_IMAGE_URL_PREFIX}/`)) {
    return true;
  }

  if (USE_BLOB_STORAGE) {
    return imageUrl.includes(`/${STORAGE_CONTAINER}/`);
  }

  return false;
}

async function removeCachedImage(imageUrl) {
  if (!isGeneratedImageUrl(imageUrl)) {
    return;
  }

  if (USE_BLOB_STORAGE && imageUrl.startsWith("http")) {
    const url = new URL(imageUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const containerIndex = pathParts.findIndex((part) => part === STORAGE_CONTAINER);
    if (containerIndex >= 0 && pathParts.length > containerIndex + 1) {
      const blobName = pathParts.slice(containerIndex + 1).join("/");
      const containerClient = await getContainerClient();
      await containerClient.deleteBlob(blobName, { deleteSnapshots: "include" }).catch((error) => {
        if (error.statusCode !== 404) {
          throw error;
        }
      });
    }
    return;
  }

  const filePath = path.join(GENERATED_IMAGE_DIR, imageUrl.replace(`${GENERATED_IMAGE_URL_PREFIX}/`, ""));
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function searchWebImages(query) {
  // DDG image search (unofficial) — no API key required
  const pageRes = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow"
    }
  );

  if (!pageRes.ok) {
    throw new Error(`Image search unavailable (${pageRes.status})`);
  }

  const html = await pageRes.text();
  const vqdMatch =
    html.match(/vqd=['"]([^'"]+)['"]/) ||
    html.match(/"vqd":"([^"]+)"/) ||
    html.match(/vqd=([a-zA-Z0-9_-]+)/);
  if (!vqdMatch) {
    throw new Error("Image search temporarily unavailable");
  }
  const vqd = vqdMatch[1];

  const imagesUrl = new URL("https://duckduckgo.com/i.js");
  imagesUrl.searchParams.set("q", query);
  imagesUrl.searchParams.set("vqd", vqd);
  imagesUrl.searchParams.set("p", "1");
  imagesUrl.searchParams.set("s", "0");
  imagesUrl.searchParams.set("l", "us-en");
  imagesUrl.searchParams.set("f", ",,,,,");

  const imgRes = await fetch(imagesUrl.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: "https://duckduckgo.com/",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  if (!imgRes.ok) {
    throw new Error(`Image search failed (${imgRes.status})`);
  }

  const data = await imgRes.json();
  return (data.results || [])
    .filter((r) => r.thumbnail || r.image)
    .slice(0, 24)
    .map((r) => ({
      title: r.title || "",
      thumbnailUrl: r.thumbnail || r.image || "",
      fetchUrl: r.image || r.thumbnail || "",
      sourceUrl: r.url || null
    }));
}

async function cacheSelectedImage(entry, { fetchUrl, thumbnailUrl, sourceUrl, query }) {
  return cacheImageLocally(entry, {
    fetchUrl,
    thumbnailUrl: thumbnailUrl || fetchUrl,
    sourceUrl: sourceUrl || null,
    query: query || ""
  });
}

module.exports = {
  findAndCacheImageForEntry,
  searchWebImages,
  cacheSelectedImage,
  isGeneratedImageUrl,
  removeCachedImage,
  GENERATED_IMAGE_DIR,
  GENERATED_IMAGE_URL_PREFIX
};