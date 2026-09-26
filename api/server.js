// Kanada API Drive portable (VPS/Docker). Misma API que la Function de Firebase:
//   GET /api/products            -> JSON productos desde Drive (cache 60s)
//   GET /api/drive-image?fileId= -> proxy binario (cache 24h)
//   GET /api/health              -> estado
// Env: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_DRIVE_ROOT_FOLDER_ID, PORT(3000)
require("dotenv").config(); // local: lee api-server/.env (en Docker/Firebase viene por env)
const express = require("express");
const core = require("./drive-kanada");

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => { res.set("Access-Control-Allow-Origin", "*"); next(); });

app.get(["/api/products", "/products"], async (req, res) => {
  if (!core.isConfigured()) {
    res.status(503).json({ error: "drive_not_configured", hint: "Configura GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY / GOOGLE_DRIVE_ROOT_FOLDER_ID" });
    return;
  }
  try {
    const products = await core.fetchAllProducts();
    res.set("Cache-Control", "public, max-age=60");
    res.json(products);
  } catch (e) {
    console.error("products error:", e && e.message);
    res.status(500).json({ error: "drive_fetch_failed" });
  }
});

app.get(["/api/drive-image", "/drive-image"], async (req, res) => {
  const fileId = req.query.fileId;
  if (!fileId) { res.status(400).json({ error: "fileId requerido" }); return; }
  try {
    const { buffer, contentType } = await core.fetchImageBuffer(fileId, req.query.w);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400, immutable");
    res.send(buffer);
  } catch (e) {
    console.error("image error:", e && e.message);
    res.status(404).json({ error: "image_not_found" });
  }
});

app.get(["/api/health", "/health", "/api", "/"], (req, res) => {
  res.json({ ok: true, configured: core.isConfigured(), endpoints: ["GET /api/products", "GET /api/drive-image?fileId="] });
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, () => console.log(`kanada-api escuchando en :${PORT} (configured=${core.isConfigured()})`));
