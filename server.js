const path = require("path");
const express = require("express");
const { initializeDatabase, getTop100, deleteEntry } = require("./services/top100Service");

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

app.listen(PORT, () => {
  console.log(`Top 100 service running at http://localhost:${PORT}`);
});
