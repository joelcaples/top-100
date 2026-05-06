const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const {
  initializeDatabase,
  getListflair,
  deleteEntry,
  addEntry,
  updateEntry,
  getEntry,
  markEntryImageLoading,
  setEntryImageReady,
  setEntryImageError,
  reorderEntries
} = require("./services/listflairService");
const {
  findAndCacheImageForEntry,
  searchWebImages,
  cacheSelectedImage,
  removeCachedImage,
  GENERATED_IMAGE_DIR
} = require("./services/imageLookupService");

const app = express();
const PORT = process.env.PORT || 3000;
const INDEX_HTML_PATH = path.join(__dirname, "index.html");
const pendingImageLookups = new Map();
const USE_AZURE_SQL = Boolean(process.env.AZURE_SQL_CONNECTION_STRING);
const USE_BLOB_STORAGE = Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING);
const STORAGE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER || "generated-images";
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL;
const LOCAL_DEV_USER_KEY = process.env.LOCAL_DEV_USER_KEY || "local-dev";

app.set("trust proxy", true);

function sendImagePayload(res, entry, statusCode = 200) {
  res.status(statusCode).json({
    id: entry.id,
    status: entry.imageStatus,
    imageUrl: entry.imageUrl,
    imageSource: entry.imageSource,
    error: entry.imageError,
    imageQuery: entry.imageQuery
  });
}

function getRequestedImageIndex(entry, forceRefresh = false) {
  const currentIndex = Number.isInteger(entry.imageResultIndex)
    ? entry.imageResultIndex
    : Number(entry.imageResultIndex || 0);

  return forceRefresh ? Math.max(0, currentIndex + 1) : Math.max(0, currentIndex);
}

function startImageLookup(ownerKey, entryId) {
  const lookupKey = `${ownerKey}:${entryId}`;
  if (pendingImageLookups.has(lookupKey)) {
    return pendingImageLookups.get(lookupKey);
  }

  const lookupPromise = (async () => {
    try {
      const entry = await getEntry(ownerKey, entryId);
      if (!entry) {
        return;
      }

      const previousImageUrl = entry.imageUrl;
      const image = await findAndCacheImageForEntry(entry, getRequestedImageIndex(entry));
      await setEntryImageReady(
        ownerKey,
        entryId,
        image.imageUrl,
        image.imageSource,
        image.imageQuery,
        image.imageResultIndex
      );

      if (previousImageUrl && previousImageUrl !== image.imageUrl) {
        await removeCachedImage(previousImageUrl);
      }
    } catch (error) {
      await setEntryImageError(ownerKey, entryId, error.message);
    } finally {
      pendingImageLookups.delete(lookupKey);
    }
  })();

  pendingImageLookups.set(lookupKey, lookupPromise);
  return lookupPromise;
}

function getSiteOrigin(req) {
  if (PUBLIC_SITE_URL) {
    return PUBLIC_SITE_URL.replace(/\/$/, "");
  }

  return `${req.protocol}://${req.get("host")}`;
}

function decodeClientPrincipalHeader(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.trim()) {
    return null;
  }

  try {
    const decoded = Buffer.from(headerValue, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch (_error) {
    return null;
  }
}

function getClaimValue(claims = [], claimType) {
  const match = claims.find((claim) => claim.typ === claimType);
  return typeof match?.val === "string" ? match.val : "";
}

function buildUserContext(req) {
  const principal = decodeClientPrincipalHeader(req.get("x-ms-client-principal"));
  const claims = Array.isArray(principal?.claims) ? principal.claims : [];
  const provider = req.get("x-ms-client-principal-idp") || principal?.auth_typ || "local";
  const principalId =
    req.get("x-ms-client-principal-id") ||
    principal?.userId ||
    getClaimValue(claims, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ||
    getClaimValue(claims, "sub") ||
    "";

  const displayName =
    req.get("x-ms-client-principal-name") ||
    principal?.userDetails ||
    getClaimValue(claims, "name") ||
    getClaimValue(claims, "preferred_username") ||
    "";

  const hasAuthenticatedIdentity = Boolean(principalId);
  if (!hasAuthenticatedIdentity) {
    return {
      key: LOCAL_DEV_USER_KEY,
      isAuthenticated: false,
      displayName: "Local User"
    };
  }

  const ownerKey = `${provider}:${principalId}`.slice(0, 200);
  return {
    key: ownerKey,
    isAuthenticated: true,
    displayName: displayName || "Signed-in User"
  };
}

async function sendIndexHtml(req, res, next) {
  try {
    const template = await fs.readFile(INDEX_HTML_PATH, "utf8");
    const siteOrigin = getSiteOrigin(req);
    const html = template.replace(/__SITE_ORIGIN__/g, siteOrigin);
    res.type("html").send(html);
  } catch (error) {
    next(error);
  }
}

app.get(["/", "/index.html"], sendIndexHtml);
app.use(express.static(path.join(__dirname), { index: false }));
app.use("/generated-images", express.static(GENERATED_IMAGE_DIR));
app.use((req, _res, next) => {
  req.userContext = buildUserContext(req);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({
    isAuthenticated: req.userContext.isAuthenticated,
    displayName: req.userContext.displayName
  });
});

app.get("/api/listflair", async (req, res) => {
  const { size } = req.query;
  const payload = await getListflair(req.userContext.key, size);
  res.json(payload);
});

app.use(express.json());

app.post("/api/entries", async (req, res) => {
  const { name, category } = req.body || {};
  if (!name || !category || typeof name !== "string" || typeof category !== "string") {
    return res.status(400).json({ error: "name and category are required strings" });
  }
  const entry = await addEntry(req.userContext.key, name.trim().slice(0, 200), category.trim().slice(0, 80));
  res.status(201).json(entry);
});

app.patch("/api/entries/reorder", async (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: "orderedIds must be a non-empty array" });
  }

  const successful = await reorderEntries(req.userContext.key, orderedIds);
  if (!successful) {
    return res.status(400).json({ error: "Invalid reorder payload" });
  }

  return res.json({ ok: true });
});

app.delete("/api/entries/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const existingEntry = await getEntry(req.userContext.key, id);
  const deleted = await deleteEntry(req.userContext.key, id);
  if (!deleted) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (existingEntry?.imageUrl) {
    await removeCachedImage(existingEntry.imageUrl);
  }

  res.json({ ok: true, deleted: id });
});

app.patch("/api/entries/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, category } = req.body || {};
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }
  if (!name || !category || typeof name !== "string" || typeof category !== "string") {
    return res.status(400).json({ error: "name and category are required strings" });
  }
  const existingEntry = await getEntry(req.userContext.key, id);
  const updated = await updateEntry(req.userContext.key, id, name.trim().slice(0, 200), category.trim().slice(0, 80));
  if (!updated) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (existingEntry?.imageUrl) {
    await removeCachedImage(existingEntry.imageUrl);
  }

  res.json(updated);
});

app.get("/api/entries/:id/image/search", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
  if (!q) {
    return res.status(400).json({ error: "q is required" });
  }

  const entry = await getEntry(req.userContext.key, id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  const results = await searchWebImages(q);
  res.json({ results });
});

app.get("/api/entries/:id/image", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const entry = await getEntry(req.userContext.key, id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  sendImagePayload(res, entry);
});

app.post("/api/entries/:id/image", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const entry = await getEntry(req.userContext.key, id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (entry.imageStatus === "ready" && entry.imageUrl) {
    return sendImagePayload(res, entry);
  }

  if (entry.imageStatus !== "loading") {
    await markEntryImageLoading(req.userContext.key, id, getRequestedImageIndex(entry));
  }

  startImageLookup(req.userContext.key, id);
  const loadingEntry = await getEntry(req.userContext.key, id);
  return sendImagePayload(res, loadingEntry, 202);
});

app.post("/api/entries/:id/image/refresh", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const entry = await getEntry(req.userContext.key, id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (entry.imageStatus === "loading") {
    return sendImagePayload(res, entry, 202);
  }

  await markEntryImageLoading(req.userContext.key, id, getRequestedImageIndex(entry, true));
  startImageLookup(req.userContext.key, id);
  const loadingEntry = await getEntry(req.userContext.key, id);
  return sendImagePayload(res, loadingEntry, 202);
});

app.post("/api/entries/:id/image/pick", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const { fetchUrl, thumbnailUrl, sourceUrl, query } = req.body || {};
  if (!fetchUrl || typeof fetchUrl !== "string") {
    return res.status(400).json({ error: "fetchUrl is required" });
  }
  if (!fetchUrl.startsWith("https://")) {
    return res.status(400).json({ error: "fetchUrl must use https" });
  }

  const entry = await getEntry(req.userContext.key, id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  const previousImageUrl = entry.imageUrl;
  try {
    const cached = await cacheSelectedImage(entry, {
      fetchUrl,
      thumbnailUrl: typeof thumbnailUrl === "string" ? thumbnailUrl : fetchUrl,
      sourceUrl: typeof sourceUrl === "string" ? sourceUrl : null,
      query: typeof query === "string" ? query.slice(0, 500) : ""
    });

    await setEntryImageReady(req.userContext.key, id, cached.imageUrl, cached.imageSource, cached.imageQuery, 0);

    if (previousImageUrl && previousImageUrl !== cached.imageUrl) {
      await removeCachedImage(previousImageUrl);
    }

    const updatedEntry = await getEntry(req.userContext.key, id);
    return sendImagePayload(res, updatedEntry);
  } catch (error) {
    await setEntryImageError(req.userContext.key, id, error.message);
    return res.status(500).json({ error: "Could not cache the selected image" });
  }
});

async function startServer() {
  await initializeDatabase();

  const databaseMode = USE_AZURE_SQL ? "Azure SQL" : "SQLite (local)";
  const imageCacheMode = USE_BLOB_STORAGE
    ? `Azure Blob (${STORAGE_CONTAINER})`
    : "Local filesystem (data/generated-images)";

  console.log(`[startup] Database mode: ${databaseMode}`);
  console.log(`[startup] Image cache mode: ${imageCacheMode}`);

  app.listen(PORT, () => {
    console.log(`ListFlair service running at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
