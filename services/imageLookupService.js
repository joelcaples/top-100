const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const GENERATED_IMAGE_DIR = path.join(__dirname, "..", "data", "generated-images");
const GENERATED_IMAGE_URL_PREFIX = "/generated-images";
const OPENVERSE_API_URL = "https://api.openverse.org/v1/images/";
const IMAGE_PAGE_SIZE = 16;
const OUTPUT_WIDTH = 640;
const OUTPUT_HEIGHT = 480;
const CATEGORY_QUERY_HINTS = {
  music: ["band", "musician", "logo", "album cover"],
  movies: ["film", "poster", "still"],
  sports: ["athlete", "team", "action"],
  gaming: ["game", "character", "art"]
};

const GENERIC_STOCK_TERMS = /(stock|vector|illustration|clipart|template|background)/;

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
          "User-Agent": "top-100-app/1.0"
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
      "User-Agent": "top-100-app/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Image download failed with status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function cacheImageLocally(entry, rankedCandidate) {
  await ensureGeneratedImageDir();

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
  const filePath = path.join(GENERATED_IMAGE_DIR, fileName);

  await sharp(imageBuffer)
    .rotate()
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
      fit: "cover",
      position: "attention"
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(filePath);

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
  return typeof imageUrl === "string" && imageUrl.startsWith(`${GENERATED_IMAGE_URL_PREFIX}/`);
}

async function removeCachedImage(imageUrl) {
  if (!isGeneratedImageUrl(imageUrl)) {
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

module.exports = {
  findAndCacheImageForEntry,
  isGeneratedImageUrl,
  removeCachedImage,
  GENERATED_IMAGE_DIR,
  GENERATED_IMAGE_URL_PREFIX
};