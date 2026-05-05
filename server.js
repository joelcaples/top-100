const path = require("path");
const express = require("express");
const { initializeDatabase, getTop100, deleteEntry, addEntry, updateEntry } = require("./services/top100Service");

const app = express();
const PORT = process.env.PORT || 3000;

initializeDatabase();

app.use(express.static(path.join(__dirname)));

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

app.delete("/api/entries/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const deleted = deleteEntry(id);
  if (!deleted) {
    return res.status(404).json({ error: "Entry not found" });
  }
  res.json({ ok: true, deleted: id });
});

app.patch("/api/entries/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, category } = req.body || {};
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }
  if (!name || !category || typeof name !== "string" || typeof category !== "string") {
    return res.status(400).json({ error: "name and category are required strings" });
  }
  const updated = updateEntry(id, name.trim().slice(0, 200), category.trim().slice(0, 80));
  if (!updated) {
    return res.status(404).json({ error: "Entry not found" });
  }
  res.json(updated);
});

app.listen(PORT, () => {
  console.log(`Top 100 service running at http://localhost:${PORT}`);
});
