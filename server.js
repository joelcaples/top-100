const path = require("path");
const express = require("express");
const { getTop100 } = require("./services/top100Service");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/top-100", (req, res) => {
  const { size } = req.query;
  const payload = getTop100(size);
  res.json(payload);
});

app.listen(PORT, () => {
  console.log(`Top 100 service running at http://localhost:${PORT}`);
});
