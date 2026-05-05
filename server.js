const path = require("path");
const express = require("express");
const {
  initializeDatabase,
  getTop100,
  deleteEntry,
  addEntry,
  updateEntry,
  getEntry,
  markEntryImageLoading,
  setEntryImageReady,
  setEntryImageError
} = require("./services/top100Service");
const {
  findAndCacheImageForEntry,
  removeCachedImage,
  GENERATED_IMAGE_DIR
} = require("./services/imageLookupService");

const app = express();
const PORT = process.env.PORT || 3000;
const pendingImageLookups = new Map();

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

function startImageLookup(entryId) {
  if (pendingImageLookups.has(entryId)) {
    return pendingImageLookups.get(entryId);
  }

  const lookupPromise = (async () => {
    try {
      const entry = getEntry(entryId);
      if (!entry) {
        return;
      }

      const previousImageUrl = entry.imageUrl;
      const image = await findAndCacheImageForEntry(entry, getRequestedImageIndex(entry));
      setEntryImageReady(
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
      setEntryImageError(entryId, error.message);
    } finally {
      pendingImageLookups.delete(entryId);
    }
  })();

  pendingImageLookups.set(entryId, lookupPromise);
  return lookupPromise;
}

initializeDatabase();

app.use(express.static(path.join(__dirname)));
app.use("/generated-images", express.static(GENERATED_IMAGE_DIR));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/top-100", (req, res) => {
  const { size } = req.query;
  const payload = getTop100(size);
  res.json(payload);
});

app.use(express.json());

app.post("/api/entries", (req, res) => {
  const { name, category } = req.body || {};
  if (!name || !category || typeof name !== "string" || typeof category !== "string") {
    return res.status(400).json({ error: "name and category are required strings" });
  }
  const entry = addEntry(name.trim().slice(0, 200), category.trim().slice(0, 80));
  res.status(201).json(entry);
});

app.delete("/api/entries/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const existingEntry = getEntry(id);
  const deleted = deleteEntry(id);
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
  const existingEntry = getEntry(id);
  const updated = updateEntry(id, name.trim().slice(0, 200), category.trim().slice(0, 80));
  if (!updated) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (existingEntry?.imageUrl) {
    await removeCachedImage(existingEntry.imageUrl);
  }

  res.json(updated);
});

app.get("/api/entries/:id/image", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const entry = getEntry(id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  sendImagePayload(res, entry);
});

app.post("/api/entries/:id/image", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const entry = getEntry(id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (entry.imageStatus === "ready" && entry.imageUrl) {
    return sendImagePayload(res, entry);
  }

  if (entry.imageStatus !== "loading") {
    markEntryImageLoading(id, getRequestedImageIndex(entry));
  }

  startImageLookup(id);
  const loadingEntry = getEntry(id);
  return sendImagePayload(res, loadingEntry, 202);
});

app.post("/api/entries/:id/image/refresh", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const entry = getEntry(id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (entry.imageStatus === "loading") {
    return sendImagePayload(res, entry, 202);
  }

  markEntryImageLoading(id, getRequestedImageIndex(entry, true));
  startImageLookup(id);
  const loadingEntry = getEntry(id);
  return sendImagePayload(res, loadingEntry, 202);
});

app.listen(PORT, () => {
  console.log(`Top 100 service running at http://localhost:${PORT}`);
});
