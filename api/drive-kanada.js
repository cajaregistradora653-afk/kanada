// Lógica Drive->Kanada pura (sin Express, sin Firebase).
// MIRROR de la lógica pura de functions/index.js (misma convención de carpetas).
// Si cambias el parseo aquí, replica el cambio en functions/index.js y corre:
//   node tools/check-api-mirror.mjs
// Convención: CAT__SUB__REF-$PRECIO__TALLAS  ej: HOMBRE__Camisetas__S-CLEMONT-Negro-$110.000__M-L-XL
const { google } = require("googleapis");
const AdmZip = require("adm-zip");
const sharp = require("sharp");
const heicDecode = require("heic-decode");
const fs = require("fs");
const path = require("path");
// Disco persistente (sobrevive reinicios). En Docker es la capa escribible del contenedor.
const IMG_DISK_DIR = process.env.IMG_CACHE_DIR || path.join(__dirname, "cache-img");

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const CATMAP = { ACCESORIOS: "ACCESORIOS", AGROPECUARIOS: "AGROPECUARIO", AGROPECUARIO: "AGROPECUARIO", HOMBRE: "HOMBRE", MUJER: "MUJER", OFERTAS: "OFERTAS", PERFUMES: "PERFUMES", GENERAL: "GENERAL" };
const SIZE_TOK = /^(XXXL|XXL|XS|XL|L|M|S|UNICA)$/i;

let authClient = null;
function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY no configurados");
  if (!authClient) {
    authClient = new google.auth.JWT({ email, key: key.replace(/\\n/g, "\n"), scopes: SCOPES });
  }
  return authClient;
}
function getDrive() {
  return google.drive({ version: "v3", auth: getAuth() });
}
function isConfigured() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
}

function parsePriceStr(s) {
  if (!s) return null;
  // Quita duplicados tipo $110(1).000 ANTES de extraer (igual que build-catalog.mjs)
  const m = String(s).replace(/\([^)]*\)/g, "").match(/\$([\d.]+)/);
  if (!m) return null;
  const d = m[1].replace(/\./g, "");
  return /^\d+$/.test(d) ? parseInt(d, 10) : null;
}
function cleanRef(s) {
  return String(s || "")
    .replace(/\$[\d().]+\s*(-\d+u)?\s*$/i, "")
    .replace(/\(\d+\)/g, "")
    .replace(/-\d+u$/i, "")
    .replace(/[_-]+$/g, "").trim() || "Producto";
}
function parseSizes(s) {
  if (!s) return null;
  const parts = String(s).split(/[-,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (!parts.length || !parts.every((p) => SIZE_TOK.test(p))) return null;
  return parts;
}
function parseFolderName(name) {
  const segs = String(name || "").split("__").map((x) => x.trim()).filter(Boolean);
  let cat = "GENERAL", sub = "GENERAL", refPart = name, sizePart = null;
  if (segs.length >= 4) {
    cat = segs[0]; sub = segs[1]; refPart = segs.slice(2, -1).join("__");
    sizePart = parseSizes(segs[segs.length - 1]) ? segs[segs.length - 1] : null;
    if (!sizePart) refPart = segs.slice(2).join("__");
  } else if (segs.length === 3) {
    if (parseSizes(segs[2])) { cat = segs[0]; sub = "GENERAL"; refPart = segs[1]; sizePart = segs[2]; }
    else { cat = segs[0]; sub = segs[1]; refPart = segs[2]; }
  } else if (segs.length === 2) {
    const up = segs[0].toUpperCase();
    if (CATMAP[up] || segs[0].trim().toLowerCase() === "ver ofertas") { cat = segs[0]; sub = "GENERAL"; refPart = segs[1]; }
    else if (parseSizes(segs[1])) { cat = "GENERAL"; sub = segs[0]; refPart = segs[0]; sizePart = segs[1]; }
    else { cat = "GENERAL"; sub = segs[0]; refPart = segs[1]; }
  }
  const price = parsePriceStr(refPart);
  const sizes = parseSizes(sizePart) || ["UNICA"];
  const ref = cleanRef(refPart);
  const catN = (String(cat).trim().toLowerCase() === "ver ofertas" ? "OFERTAS"
    : (CATMAP[String(cat).toUpperCase()] || String(cat).toUpperCase())).slice(0, 30);
  const subN = String(sub).replace(/_+$/g, "").trim() || "GENERAL";
  return { cat: catN, sub: subN, ref, price, sizes };
}

function parseDocxMeta(buffer) {
  try {
    const zip = new AdmZip(buffer);
    const xml = zip.readAsText("word/document.xml", "utf8");
    const paras = [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)]
      .map((m) => m[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    const get = (re) => paras.find((x) => re.test(x)) || null;
    const val = (re) => { const p = get(re); return p ? p.replace(re, "$1").trim() : null; };
    let price = null;
    const pp = get(/^PRECIO:/i);
    if (pp) {
      const m = pp.match(/PRECIO:\s*\$?(?:COP)?\s*\$?\s*([\d().]+)/i);
      if (m) { const d = m[1].replace(/\([^)]*\)/g, "").replace(/\./g, ""); if (/^\d+$/.test(d)) price = parseInt(d, 10); }
    }
    const di = paras.findIndex((x) => /^DESCRIPCI[OÓ]N:/i.test(x));
    const ti = paras.findIndex((x) => /^DETALLES DEL PRODUCTO:/i.test(x));
    const META_RE = /^(PRECIO|TALLA|STOCK|CAT|SUB|CATEGOR[ÍI]A|MODELO):/i;
    let desc = null;
    if (di !== -1) {
      const end = ti !== -1 ? ti : paras.length;
      // Fuera líneas de metadatos aunque vengan dentro del rango DESCRIPCION:
      // solo texto comercial; la ficha técnica vive en sus campos.
      desc = paras.slice(di, end).filter((x) => !META_RE.test(x))
        .join(" ").replace(/^DESCRIPCI[OÓ]N:\s*/i, "").trim().slice(0, 2000) || null;
    }
    const details = ti !== -1 ? paras.slice(ti + 1).filter((x) => !/^(PRECIO|TALLA|STOCK|CAT|SUB|CATEGOR[ÍI]A|MODELO):/i.test(x)).slice(0, 20) : [];
    const tallaRaw = val(/^TALLA:\s*(.+)$/i);
    const stockRaw = val(/^STOCK:\s*(.+)$/i);
    const catRaw = val(/^(?:CAT|CATEGOR[ÍI]A):\s*(.+)$/i);
    const subRaw = val(/^SUB:\s*(.+)$/i);
    const { sizes: tallaSizes, stockBySize } = parseTalla(tallaRaw);
    const model = parseModel(paras.join("\n"));
    if (desc && model) {
      // Si la frase del modelo también está en la descripción, quitarla de ahí:
      // se muestra una sola vez, en su línea dedicada.
      desc = desc.replace(/[^.]*?modelo[^.]*?talla\s+[A-Za-z]{1,4}[^.]*?mide\s+[\d.,]+\s*m[^.]*\./gi, " ").replace(/\s+/g, " ").trim() || null;
    }
    return {
      price, desc, details,
      sizes: tallaSizes, stockBySize, model,
      stock: stockRaw && /^\d+$/.test(stockRaw) ? parseInt(stockRaw, 10) : null,
      cat: catRaw ? catRaw.toUpperCase().slice(0, 30) : null,
      sub: subRaw || null,
    };
  } catch { return {}; }
}
// TALLA:1XS,1S,1M,2L,1XL -> número antes = unidades (0 o ausente = sin stock).
// Sin ese formato, legacy: tallas simples, todas disponibles.
function parseTalla(raw) {
  if (!raw) return { sizes: null, stockBySize: null };
  // Separadores: coma, punto, punto-coma, guion, espacio (el cliente mezcla: "1XS.2S.2M,2L,1XL")
  const toks = String(raw).split(/[-,.;\s]+/).map((x) => x.trim()).filter(Boolean);
  if (tocks(toks)) {
    const stockBySize = {};
    for (const t of toks) {
      const m = t.match(/^(\d+)([A-Za-z]+)$/);
      stockBySize[m[2].toUpperCase()] = parseInt(m[1], 10);
    }
    return { sizes: Object.entries(stockBySize).filter(([, n]) => n > 0).map(([s]) => s), stockBySize };
  }
  return { sizes: parseSizes(raw.replace(/,/g, "-")) || [raw.toUpperCase()], stockBySize: null };
}
function tocks(toks) { return toks.length > 0 && toks.every((t) => /^(\d+)([A-Za-z]+)$/.test(t)); }
// Modelo: "MODELO: S, 1.87" o frase "El modelo utiliza talla S y mide 1.87 m."
function parseModel(text) {
  const t = String(text || " ");
  let m = t.match(/^[ \t]*MODELO:[ \t]*(?:talla[ \t]*)?([A-Za-z]{1,4})?[,]?\s*(?:mide[ \t]*)?([\d.,]+)?[ \t]*m?[ \t]*$/im);
  if (m && (m[1] || m[2])) return { size: (m[1] || "").toUpperCase() || null, height: (m[2] || "").replace(",", ".") || null };
  m = t.match(/modelo[^.\n]*?talla\s+([A-Za-z]{1,4})[^.\n]*?mide\s+([\d.,]+)\s*m/i);
  if (m) return { size: m[1].toUpperCase(), height: m[2].replace(",", ".") };
  m = t.match(/modelo[^.\n]*?talla\s+([A-Za-z]{1,4})/i);
  if (m) return { size: m[1].toUpperCase(), height: null };
  m = t.match(/modelo[^.\n]*?mide\s+([\d.,]+)\s*m/i);
  if (m) return { size: null, height: m[1].replace(",", ".") };
  return null;
}

async function listProductFolders() {
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!root) throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID no configurado");
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${root}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)", orderBy: "name", pageSize: 200,
  });
  return (res.data.files || []).map((f) => ({ id: f.id, name: f.name }));
}

// ---- Estructura anidada (igual que fotos/ antes): CAT/SUB/... ----
// Una carpeta es producto si tiene fotos directas; si solo tiene subcarpetas,
// se recorre heredando CAT/SUB/TALLA del nombre de cada nivel.
function catNorm(name) {
  const first = String(name || "").split("__")[0].trim();
  if (first.toLowerCase() === "ver ofertas") return "OFERTAS";
  return CATMAP[first.toUpperCase()] || null;
}
function subNorm(name) {
  return String(name || "").replace(/_+$/g, "").trim() || "GENERAL";
}
function sizeLike(name) {
  const t = String(name || "").trim();
  if (SIZE_TOK.test(t)) return t.toUpperCase();
  const m = t.match(/^talla\s+(.+)$/i);
  if (m) return m[1].trim().toUpperCase();
  if (/^\d+$/.test(t)) return t; // ej 40 (calzado)
  return null;
}
function tallaFromName(fname) {
  const m = String(fname).match(/_talla\s?([A-Za-z0-9]+)/i);
  return m ? m[1].toUpperCase() : null;
}
// Orden numérico natural: 1,2,...,10 (Drive ordena "10" antes que "2").
// La foto 1 es SIEMPRE la portada del catálogo; el resto sigue la numeración.
function natName(s) {
  return String(s || "").split(/(\d+)/).map((t) => (/^\d+$/.test(t) ? [1, parseInt(t, 10)] : [0, t.toLowerCase()]));
}
function natCmp(a, b) {
  const A = natName(typeof a === "string" ? a : a.name), B = natName(typeof b === "string" ? b : b.name);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || [0, ""], y = B[i] || [0, ""];
    if (x[0] !== y[0]) return x[0] - y[0];
    if (x[1] < y[1]) return -1;
    if (x[1] > y[1]) return 1;
  }
  return 0;
}
function mkProduct({ ref, price, desc, details, cat, sub, sizes, images, stock, stockBySize, model, src }) {
  const name = String(ref).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  // Sin STOCK: explícito, el stock global = suma de tallas (filtros "con stock" reales)
  const units = stockBySize ? Object.values(stockBySize).reduce((a, n) => a + (n || 0), 0) : null;
  return {
    id: 0, ref, name,
    price: price ?? 0, priceOk: price !== null && price !== undefined,
    desc: desc || null, details: details || [],
    cat, sub, size: sizes, sizes,
    stockBySize: stockBySize || null, model: model || null,
    img: images[0], images,
    tag: cat === "OFERTAS" ? "HOT" : null,
    stock: stock ?? units ?? 99,
    src,
  };
}
async function readDocxMeta(drive, fileId) {
  try {
    const bin = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    return parseDocxMeta(Buffer.from(bin.data)) || {};
  } catch { return {}; }
}
async function collect(drive, folderId, folderName, depth, ctx, out) {
  const [imgRes, docxRes, kidRes] = await Promise.all([
    drive.files.list({ q: `'${folderId}' in parents and (mimeType contains 'image/') and trashed = false`, fields: "files(id, name, thumbnailLink)", orderBy: "name", pageSize: 100 }),
    drive.files.list({ q: `'${folderId}' in parents and mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' and trashed = false`, fields: "files(id, name)", pageSize: 1 }),
    drive.files.list({ q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, fields: "files(id, name)", orderBy: "name", pageSize: 100 }),
  ]);
  const imgs = (imgRes.data.files || []).filter((f) => f.id).sort(natCmp);
  for (const f of imgs) if (f.thumbnailLink) thumbMap.set(f.id, f.thumbnailLink);
  const kids = (kidRes.data.files || []).filter((f) => f.id);
  const docx = (docxRes.data.files || [])[0];
  const meta = docx ? await readDocxMeta(drive, docx.id) : {};
  const src = `drive/${folderId}`;

  if (imgs.length && (depth === 0 || kids.length === 0)) {
    if (depth === 0 && kids.length === 0) {
      // Carpeta-producto plana clásica: CAT__SUB__REF-$PRECIO__TALLAS, todas las fotos = 1 producto
      const base = parseFolderName(folderName);
      out.push(mkProduct({
        ref: base.ref, price: meta.price ?? base.price,
        desc: meta.desc, details: meta.details,
        cat: meta.cat || base.cat, sub: meta.sub || base.sub,
        sizes: meta.sizes || base.sizes,
        images: imgs.map((f) => `/api/drive-image?fileId=${f.id}`),
        stock: meta.stock, stockBySize: meta.stockBySize || null, model: meta.model || null, src,
      }));
    } else if (depth > 0 && imgs.every((f) => /^\d+\.\w+$/.test(f.name))) {
      // Galería: la carpeta entera es 1 producto (nombre = carpeta padre).
      // La talla puede venir de la carpeta actual (Boxers_/L/1.webp) o heredada.
      // La SUB también puede venir de la carpeta actual (PERFUMES/Hombre_/...) si no se heredó.
      const { price } = priceOf(folderName, []);
      const lvlSize = sizeLike(folderName) || ctx.size;
      out.push(mkProduct({
        ref: cleanRef(folderName), price: meta.price ?? price,
        desc: meta.desc, details: meta.details,
        cat: meta.cat || ctx.cat, sub: meta.sub || ctx.sub,
        sizes: meta.sizes || (lvlSize ? [lvlSize] : ["UNICA"]),
        images: imgs.map((f) => `/api/drive-image?fileId=${f.id}`),
        stock: meta.stock, stockBySize: meta.stockBySize || null, model: meta.model || null, src,
      }));
    } else if (depth > 0) {
      // Nivel SUB con varios productos: 1 archivo = 1 producto (igual que build-catalog.mjs)
      const lvlSize = sizeLike(folderName) || ctx.size;
      const lvlSub = meta.sub || (ctx.sub && ctx.sub !== "GENERAL" ? ctx.sub : (sizeLike(folderName) ? "GENERAL" : subNorm(folderName)));
      for (const f of imgs) {
        const { price } = priceOf(f.name, []);
        out.push(mkProduct({
          ref: cleanRef(f.name), price: meta.price ?? price,
          desc: meta.desc, details: meta.details,
          cat: meta.cat || ctx.cat, sub: lvlSub,
          sizes: meta.sizes || [lvlSize || tallaFromName(f.name) || "UNICA"],
          images: [`/api/drive-image?fileId=${f.id}`],
          stock: meta.stock, stockBySize: meta.stockBySize || null, model: meta.model || null, src,
        }));
      }
    } else {
      // depth 0 con fotos Y subcarpetas: producto de sus fotos + recorre hijos
      const base = parseFolderName(folderName);
      out.push(mkProduct({
        ref: base.ref, price: meta.price ?? base.price,
        desc: meta.desc, details: meta.details,
        cat: meta.cat || base.cat, sub: meta.sub || base.sub,
        sizes: meta.sizes || base.sizes,
        images: imgs.map((g) => `/api/drive-image?fileId=${g.id}`),
        stock: meta.stock, stockBySize: meta.stockBySize || null, model: meta.model || null, src,
      }));
    }
  }
  if (kids.length) {
    // Contexto para los hijos según el nivel actual
    let childCtx;
    if (depth === 0) childCtx = { ...ctx, cat: catNorm(folderName) || ctx.cat };
    else {
      const s = sizeLike(folderName);
      childCtx = s ? { ...ctx, size: s } : { ...ctx, sub: subNorm(folderName) };
    }
    await Promise.all(kids.map((k) => collect(drive, k.id, k.name, depth + 1, childCtx, out)));
  }
}
// priceOf/cleanRef locales para carpetas anidadas (misma regla que prepare-drive-upload)
function priceOf(s) {
  const m = String(s || "").replace(/\([^)]*\)/g, "").match(/\$([\d.]+)/);
  if (!m) return { price: null };
  const d = m[1].replace(/\./g, "");
  return /^\d+$/.test(d) ? { price: parseInt(d, 10) } : { price: null };
}

// Cache del crawl (TTL 60 s): evita rastrear ~300 carpetas en cada visita.
// Sin esto, visitantes simultáneos agotan la cuota de Drive API (rateLimit).
const PROD_TTL = 60 * 1000;
let prodCache = { at: 0, data: null };
async function fetchAllProducts() {
  if (prodCache.data && Date.now() - prodCache.at < PROD_TTL) return prodCache.data;
  const folders = await listProductFolders();
  const out = [];
  const base = { cat: "GENERAL", sub: "GENERAL", size: null };
  await Promise.all(folders.map((f) => collect(getDrive(), f.id, f.name, 0, base, out)));
  out.sort((a, b) => a.cat.localeCompare(b.cat) || a.sub.localeCompare(b.sub) || a.name.localeCompare(b.name));
  out.forEach((p, k) => (p.id = k + 1));
  prodCache = { at: Date.now(), data: out };
  return out;
}

async function heicToJpeg(buffer) {
  const resizeJpeg = (input, raw) =>
    sharp(input, raw ? { raw } : undefined).rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 }).toBuffer();
  try {
    return await resizeJpeg(buffer);
  } catch (e) {
    console.error("sharp HEIC directo falló, usando heic-decode:", (e.message || "").split("\n")[0]);
    const { width, height, data } = await heicDecode({ buffer });
    const px = width * height;
    const channels = data.length / px === 4 ? 4 : 3;
    return await resizeJpeg(Buffer.from(data), { width, height, channels });
  }
}
// ---- Imágenes: variantes por tamaño + thumbnails de Drive + cache disco ----
// ?w=400 (tarjetas) y ?w=200 (miniaturas) salen del thumbnail de Drive
// (JPEG pequeño, sin descargar el original ni decodificar HEIC). El zoom (full)
// usa el original + conversión HEIC si toca.
const thumbMap = new Map(); // fileId -> thumbnailLink (se llena en cada crawl)
const imgCache = new Map(); // "fileId|w" -> { buffer, contentType, exp } (L1 memoria)
const IMG_TTL = 24 * 3600 * 1000;
function clampW(w) {
  const n = parseInt(w, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(1600, Math.max(100, n));
}
function memGet(k) {
  const hit = imgCache.get(k);
  if (hit && hit.exp > Date.now()) { imgCache.delete(k); imgCache.set(k, hit); return hit; }
  return null;
}
function memPut(k, v) {
  imgCache.delete(k);
  imgCache.set(k, v);
  while (imgCache.size > 500) imgCache.delete(imgCache.keys().next().value);
}
function diskPaths(fileId, w) {
  const key = `${fileId}_w${w || "full"}`.replace(/[^A-Za-z0-9_-]/g, "");
  return { bin: path.join(IMG_DISK_DIR, key + ".bin"), meta: path.join(IMG_DISK_DIR, key + ".json") };
}
async function diskGet(fileId, w) {
  try {
    const { bin, meta } = diskPaths(fileId, w);
    const st = await fs.promises.stat(bin);
    if (Date.now() - st.mtimeMs > IMG_TTL) return null;
    const [buffer, m] = await Promise.all([fs.promises.readFile(bin), fs.promises.readFile(meta, "utf8")]);
    return { buffer, contentType: JSON.parse(m).contentType };
  } catch { return null; }
}
function diskPut(fileId, w, buffer, contentType) {
  (async () => {
    try {
      await fs.promises.mkdir(IMG_DISK_DIR, { recursive: true });
      const { bin, meta } = diskPaths(fileId, w);
      await Promise.all([fs.promises.writeFile(bin, buffer), fs.promises.writeFile(meta, JSON.stringify({ contentType }))]);
    } catch (e) { console.error("disk cache write falló:", e.message); }
  })();
}
function isHeic(buf, reported) {
  if (/heic|heif/i.test(reported || "")) return true;
  return buf.length > 12 && buf.toString("ascii", 4, 8) === "ftyp"; // sniff ftyp box
}
async function accessToken() {
  const t = await getAuth().getAccessToken();
  return typeof t === "string" ? t : t.token;
}
async function fetchThumbBuffer(fileId) {
  let link = thumbMap.get(fileId);
  if (!link) {
    try {
      const m = await getDrive().files.get({ fileId, fields: "thumbnailLink" });
      link = m.data.thumbnailLink;
      if (link) thumbMap.set(fileId, link);
    } catch { return null; }
  }
  if (!link) return null;
  try {
    const sized = /=s\d+(-c)?$/.test(link) ? link.replace(/=s\d+(-c)?$/, "=w800") : link;
    const r = await fetch(sized, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 4096 ? buf : null;
  } catch { return null; }
}
async function fetchImageBuffer(fileId, wOpt) {
  const w = clampW(wOpt);
  const key = `${fileId}|${w || "full"}`;
  const hit = memGet(key);
  if (hit) return { buffer: hit.buffer, contentType: hit.contentType };
  const disk = await diskGet(fileId, w);
  if (disk) { memPut(key, { ...disk, exp: Date.now() + IMG_TTL }); return disk; }
  let buffer, contentType;
  if (w) {
    const tb = await fetchThumbBuffer(fileId);
    if (tb) {
      buffer = await sharp(tb).rotate().resize({ width: w, height: w, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      contentType = "image/jpeg";
    }
  }
  if (!buffer) {
    const drive = getDrive();
    const r = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
    buffer = Buffer.from(r.data);
    contentType = r.headers["content-type"] || "image/jpeg";
    if (isHeic(buffer, contentType)) {
      buffer = await heicToJpeg(buffer);
      contentType = "image/jpeg";
    } else if (w) {
      buffer = await sharp(buffer).rotate().resize({ width: w, height: w, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      contentType = "image/jpeg";
    }
  }
  memPut(key, { buffer, contentType, exp: Date.now() + IMG_TTL });
  diskPut(fileId, w, buffer, contentType);
  return { buffer, contentType };
}

module.exports = { isConfigured, parseFolderName, parsePriceStr, cleanRef, parseSizes, parseDocxMeta, fetchAllProducts, fetchImageBuffer, natCmp, parseTalla, parseModel };
