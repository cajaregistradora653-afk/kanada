// Kanada premium — catálogo 100% en vivo desde Drive (/api/products).
const WA = "https://wa.me/573227436671";
const PAGE = 24;
// Variantes responsive: la API sirve ?w=400 (tarjetas) y ?w=200 (miniaturas)
// desde el thumbnail de Drive; el zoom usa la original. Solo aplica a /api/.
const apiSized = (u, w) => (String(u || "").startsWith("/api/") ? `${u}&w=${w}` : u);
let PRODUCTS = [];
let CATALOG_MAX = 500000;
let deck = []; // orden aleatorio vigente de la categoría seleccionada
function rebuildDeck() {
  const l = PRODUCTS.filter((p) => state.cat === "TODOS" || p.cat === state.cat);
  const rand = (n) => {
    if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.getRandomValues)
      return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % n;
    return Math.floor(Math.random() * n);
  };
  for (let i = l.length - 1; i > 0; i--) {
    const r = rand(i + 1);
    const t = l[i]; l[i] = l[r]; l[r] = t;
  }
  deck = l;
}
let state = { cat: "TODOS", sub: "TODAS", max: 500000, stock: false, size: "Todas", sort: "default", q: "", page: 1 };
let cart = [];
try { cart = JSON.parse(localStorage.getItem("kanada_cart") || "[]"); } catch { cart = []; }

const grid = document.getElementById("productsGrid"), best = document.getElementById("bestGrid");
const fmt = (n) => "$ " + n.toLocaleString("es-CO");
const priceHTML = (p) => p.priceOk ? `${fmt(p.price)}` : `<small style="color:var(--accent)">Consultar precio</small>`;

function filtered() {
  const q = state.q.trim().toLowerCase();
  let l = deck.filter((p) =>
    (state.sub === "TODAS" || p.sub === state.sub) &&
    (p.priceOk ? p.price <= state.max : true) &&
    (!q || (p.name + " " + p.ref + " " + p.sub).toLowerCase().includes(q)));
  if (state.stock) l = l.filter((p) => p.stock > 0);
  if (state.size !== "Todas") l = l.filter((p) => p.sizes.includes(state.size));
  if (state.sort === "precio_asc") l = [...l].sort((a, b) => (a.priceOk ? a.price : Infinity) - (b.priceOk ? b.price : Infinity));
  if (state.sort === "precio_desc") l = [...l].sort((a, b) => (b.priceOk ? b.price : -1) - (a.priceOk ? a.price : -1));
  return l;
}
function card(p) {
  // Hover: crossfade a la foto 2 (CSS .pimg). Con 1 sola foto, alt = main.
  const hover2 = (p.images && p.images[1]) || p.img;
  return `<div class="card rv in" onclick="openProduct(${p.id})"><div class="pimg"><img class="main" src="${apiSized(p.img, 400)}" loading="lazy" alt="${p.name}"/>` +
    `<img class="alt" src="${apiSized(hover2, 400)}" loading="lazy" alt=""/>` +
    `${p.tag ? `<span class="tag${p.priceOk ? "" : " sale"}">${p.tag}</span>` : `<span style="display:none"></span>`}` +
    (isAgotado(p)
      ? `<button class="quick" disabled>Agotado</button></div>`
      : `<button class="quick" onclick="event.stopPropagation();addToCart(${p.id})">Añadir al carrito +</button></div>`) +
    `<div class="pbody"><div class="pcat">${p.cat} · ${p.sub}</div><div class="pname">${p.name}</div>` +
    `<div class="sizes">${p.sizes.map((s) => `<span>${s}</span>`).join("")}</div>` +
    `<div class="price">${priceHTML(p)}</div></div></div>`;
}
function render() {
  const l = filtered();
  document.getElementById("prodCount").textContent = l.length + " productos";
  document.getElementById("productsTitle").textContent = state.cat === "TODOS" ? "Todos los productos" : state.cat;
  const shown = l.slice(0, state.page * PAGE);
  grid.innerHTML = shown.map(card).join("") ||
    `<div style="grid-column:1/-1;text-align:center;color:#999;padding:2rem">Sin productos con esos filtros<br/><br/>` +
    `<button class="btn btn-dark" onclick="clearFilters()">Limpiar filtros</button></div>`;
  if (l.length > shown.length) {
    grid.innerHTML += `<div style="grid-column:1/-1;text-align:center;padding:1rem">` +
      `<button class="btn btn-dark" onclick="moreProducts()">Ver más (${l.length - shown.length} restantes)</button></div>`;
  }
}
function moreProducts() { state.page++; render(); }
function save() { localStorage.setItem("kanada_cart", JSON.stringify(cart)); renderCart(); }
const csize = (c) => c.size || (PRODUCTS.find((x) => x.id === c.id)?.sizes || ["UNICA"])[0];
const isAgotado = (p) => !!(p && p.stockBySize && !(p.sizes && p.sizes.length));
function addToCart(id, qty = 1, size = null) {
  const p = PRODUCTS.find((x) => x.id === id); if (!p) return;
  if (isAgotado(p) && !size) return; // sin tallas disponibles: solo desde el modal
  const s = size || (p.sizes && p.sizes[0]) || "UNICA";
  const e = cart.find((x) => x.id === id && csize(x) === s);
  e ? e.qty += qty : cart.push({ id, qty, size: s });
  save(); openDrawer();
}
function chQty(id, size, d) {
  const it = cart.find((x) => x.id === id && csize(x) === size); if (!it) return;
  it.qty += d;
  if (it.qty <= 0) cart = cart.filter((x) => !(x.id === id && csize(x) === size));
  save();
}
function rm(id, size) { cart = cart.filter((x) => !(x.id === id && csize(x) === size)); save(); }
// Sanea items guardados con tallas que ya no existen (ej. formato viejo "1XS,2S…"
// de antes del parser de stock, o productos agotados). Se corre al cargar el catálogo.
function sanitizeCart() {
  const before = cart.length;
  cart = cart.filter((c) => {
    const p = PRODUCTS.find((x) => x.id === c.id);
    if (!p || !p.img) return false;
    const sz = c.size || (p.sizes && p.sizes[0]);
    if (!sz) return !isAgotado(p);
    return p.sizes && p.sizes.includes(sz);
  });
  if (cart.length !== before) save();
}
function renderCart() {
  const b = document.getElementById("drawerBody"), f = document.getElementById("drawerFoot");
  const n = cart.reduce((a, c) => a + c.qty, 0);
  document.getElementById("cartCount").textContent = n;
  document.getElementById("drawerCount").textContent = `Mi carrito (${n})`;
  if (!cart.length) {
    b.innerHTML = `<p style="text-align:center;color:#999">Tu carrito está vacío<br/><br/><a href="#productos" onclick="closeDrawer()">Continuar comprando</a></p>`;
    f.innerHTML = ""; return;
  }
  b.innerHTML = cart.map((c) => {
    const p = PRODUCTS.find((x) => x.id === c.id); if (!p) return "";
    const s = csize(c);
    return `<div class="ci"><img src="${apiSized(p.img, 200)}" alt=""/>` +
      `<div class="ci-info"><b>${p.name}</b>` +
      `<small>${p.priceOk ? fmt(p.price) : "A convenir"} · talla ${esc(s)}</small>` +
      `<div class="ci-row"><span class="qty"><button onclick="chQty(${c.id},'${escA(s)}',-1)" aria-label="Quitar uno">−</button><b>${c.qty}</b><button onclick="chQty(${c.id},'${escA(s)}',1)" aria-label="Agregar uno">+</button></span>` +
      `<button class="rm" onclick="rm(${c.id},'${escA(s)}')">✕ Quitar</button></div></div></div>`;
  }).join("");
  const t = cart.reduce((a, c) => { const p = PRODUCTS.find((x) => x.id === c.id); return p && p.priceOk ? a + p.price * c.qty : a; }, 0);
  const pending = cart.some((c) => { const p = PRODUCTS.find((x) => x.id === c.id); return p && !p.priceOk; });
  const msg = encodeURIComponent("Hola Kanada! Quiero pedir:\n" + cart.map((c) => {
    const p = PRODUCTS.find((x) => x.id === c.id);
    return `• ${p.name} x${c.qty} (${csize(c)}) - ${p.priceOk ? fmt(p.price * c.qty) : "a convenir"}`;
  }).join("\n") + `\nTotal: ${fmt(t)}${pending ? " (+ a convenir)" : ""}`);
  f.innerHTML = `<div style="display:flex;justify-content:space-between;font-weight:700"><span>Total</span><span>${fmt(t)}${pending ? "*" : ""}</span></div>` +
    (pending ? `<small style="color:#999">* Más productos a convenir por WhatsApp</small>` : "") +
    `<a class="btn btn-dark" style="text-align:center" target="_blank" href="${WA}?text=${msg}">Pedir por WhatsApp</a>` +
    `<button class="btn btn-line" onclick="cart=[];save()">Vaciar</button>`;
}

function resetPage() { state.page = 1; }
function clearFilters() {
  state = { cat: "TODOS", sub: "TODAS", max: CATALOG_MAX, stock: false, size: "Todas", sort: "default", q: "", page: 1 };
  rebuildDeck();
  document.getElementById("maxPrice").value = CATALOG_MAX;
  document.getElementById("maxPriceLabel").textContent = fmt(CATALOG_MAX);
  document.getElementById("onlyStock").checked = false;
  document.getElementById("sizeFilter").value = "Todas";
  document.getElementById("sortFilter").value = "default";
  document.getElementById("searchInput").value = "";
  fillSubs();
  syncCatActive(); closeMenus();
  render();
}
function syncCatActive() {
  // Los items del dropdown usan data-sub: no interfieren aquí.
  document.querySelectorAll("[data-cat]").forEach((y) =>
    y.classList.toggle("active", y.dataset.cat === state.cat));
}
function applyCat(cat, sub) {
  state.cat = cat; state.sub = sub || "TODAS";
  rebuildDeck();
  const subSel = document.getElementById("subFilter");
  if (subSel) {
    fillSubs();
    if (state.sub !== "TODAS" && [...subSel.options].some((o) => o.value === state.sub)) subSel.value = state.sub;
  }
  syncCatActive(); closeMenus();
  resetPage(); render();
  document.getElementById("productos").scrollIntoView({ behavior: "smooth" });
}
document.querySelectorAll("[data-cat]").forEach((x) => x.addEventListener("click", () => applyCat(x.dataset.cat, "TODAS")));

// ===== menú desplegable por subcategorías (foto 2 del diseño: hover PC, toque móvil) =====
// Mapa cat -> subs únicas, construido con los datos de Drive (dinámico: nuevas
// subcarpetas aparecen solas). Solo para categorías que ya tienen botón.
function catSubs() {
  const m = new Map();
  for (const p of PRODUCTS) {
    if (!m.has(p.cat)) m.set(p.cat, new Set());
    if (p.sub && p.sub !== "GENERAL") m.get(p.cat).add(p.sub);
  }
  return m;
}
function closeMenus() {
  document.querySelectorAll(".dropdown.show").forEach((d) => d.classList.remove("show"));
  const ms = document.getElementById("mobileSubs");
  if (ms) { ms.classList.remove("show"); ms.innerHTML = ""; }
  document.querySelectorAll("#mobileCats [data-cat]").forEach((b) => b.classList.remove("open"));
}
const escA = (s) => esc(s).replace(/"/g, "&quot;");
function subItemHTML(cat, sub, all) {
  return `<button data-pcat="${escA(cat)}" data-sub="${escA(sub)}" class="${all ? "all" : ""}">${all ? "Ver todo" : esc(sub)}</button>`;
}
function buildCatMenu() {
  const map = catSubs();
  // --- Desktop: panel hover junto a cada botón del nav ---
  document.querySelectorAll("#navLinks [data-cat]").forEach((btn) => {
    const cat = btn.dataset.cat;
    if (cat === "TODOS" || btn.parentElement.classList.contains("nav-item")) return;
    const subs = [...(map.get(cat) || [])].sort((a, b) => a.localeCompare(b, "es"));
    const wrap = document.createElement("span");
    wrap.className = "nav-item";
    btn.replaceWith(wrap);
    wrap.appendChild(btn);
    if (!subs.length) return;
    btn.insertAdjacentHTML("afterend",
      `<span class="caret" aria-hidden="true">▾</span><div class="dropdown" role="menu">` +
      subItemHTML(cat, "TODAS", true) + subs.map((s) => subItemHTML(cat, s, false)).join("") + `</div>`);
    wrap.querySelectorAll("[data-sub]").forEach((it) => it.addEventListener("click", (e) => {
      e.stopPropagation();
      applyCat(it.dataset.pcat, it.dataset.sub);
    }));
  });
  // --- Móvil: acordeón bajo la fila (se inyecta solo) ---
  let ms = document.getElementById("mobileSubs");
  if (!ms) {
    ms = document.createElement("div");
    ms.className = "msubs";
    ms.id = "mobileSubs";
    document.getElementById("mobileCats").after(ms);
  }
  document.querySelectorAll("#mobileCats [data-cat]").forEach((btn) => {
    const cat = btn.dataset.cat;
    const subs = cat === "TODOS" ? [] : [...(map.get(cat) || [])].sort((a, b) => a.localeCompare(b, "es"));
    const fresh = btn.cloneNode(true); // suelta el listener genérico data-cat
    btn.replaceWith(fresh);
    if (!subs.length) {
      fresh.addEventListener("click", () => applyCat(cat, "TODAS"));
      return;
    }
    fresh.insertAdjacentHTML("afterbegin", `<span class="mcaret">▾ </span>`);
    fresh.addEventListener("click", () => {
      const wasOpen = fresh.classList.contains("open");
      closeMenus();
      if (wasOpen) { applyCat(cat, "TODAS"); return; } // segundo toque = filtrar categoría
      fresh.classList.add("open");
      ms.innerHTML = `<div class="msub-title">${esc(fresh.textContent.replace("▾", "").trim())}</div>` +
        subItemHTML(cat, "TODAS", true) + subs.map((s) => subItemHTML(cat, s, false)).join("");
      ms.classList.add("show");
      ms.querySelectorAll("[data-sub]").forEach((it) => it.addEventListener("click", () => applyCat(it.dataset.pcat, it.dataset.sub)));
    });
  });
}
document.getElementById("maxPrice").addEventListener("input", (e) => {
  state.max = +e.target.value;
  document.getElementById("maxPriceLabel").textContent = fmt(state.max);
  resetPage(); render();
});
document.getElementById("onlyStock").addEventListener("change", (e) => { state.stock = e.target.checked; resetPage(); render(); });
document.getElementById("sizeFilter").addEventListener("change", (e) => { state.size = e.target.value; resetPage(); render(); });
document.getElementById("sortFilter").addEventListener("change", (e) => { state.sort = e.target.value; resetPage(); render(); });
document.getElementById("subFilter").addEventListener("change", (e) => { state.sub = e.target.value; resetPage(); render(); });
document.getElementById("searchInput").addEventListener("input", (e) => { state.q = e.target.value; resetPage(); render(); });
document.getElementById("clearFilters").onclick = clearFilters;

const dr = document.getElementById("drawer"), ov = document.getElementById("overlay");
function openDrawer() { dr.classList.add("open"); ov.classList.add("show"); }
function closeDrawer() { dr.classList.remove("open"); ov.classList.remove("show"); }
document.getElementById("openCart").onclick = openDrawer;
document.getElementById("closeCart").onclick = closeDrawer;
ov.onclick = closeDrawer;

// ===== modal producto =====
let pCur = null, pQty = 1, pSize = null, pGal = [];
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dirOf = (s) => String(s || "").split("/").slice(0, -1).join("/");
function siblings(p) {
  // Drive en vivo: la galería es SOLO p.images (1 o N fotos de su carpeta).
  // El fallback dirOf() es solo para catálogo estático legacy: en Drive todos los
  // src comparten "drive/" y generaría una galería fantasma de cientos de fotos.
  if (String(p.src || "").startsWith("drive/")) return (p.images && p.images.length ? p.images : [p.img]).map((u) => ({ img: u }));
  if (p.images && p.images.length > 1) return p.images.map((u) => ({ img: u }));
  const d = dirOf(p.src);
  const sibs = PRODUCTS.filter((x) => dirOf(x.src) === d)
    .sort((a, b) => String(a.img).localeCompare(String(b.img)));
  return [p, ...sibs.filter((x) => x.id !== p.id)];
}
function openProduct(id) {
  try {
    const p = PRODUCTS.find((x) => x.id === id); if (!p) return;
    pCur = p; pQty = 1;
    pCur.sizes = (p.sizes && p.sizes.length ? p.sizes : ["UNICA"]);
    pCur.images = (p.images && p.images.length ? p.images : (p.img ? [p.img] : []));
    pSize = pCur.sizes[0];
    pGal = siblings(pCur);
    document.getElementById("pCat").textContent = (p.cat || "") + " · " + (p.sub || "");
    document.getElementById("pName").textContent = p.name || "Producto";
    document.getElementById("pRef").textContent = "Ref: " + (p.ref || "");
    document.getElementById("pModel").innerHTML = modelLine(p.model);
    document.getElementById("pPrice").innerHTML = p.priceOk ? fmt(p.price) : `<small style="color:var(--accent)">Consultar precio</small>`;
    document.getElementById("pQtyV").textContent = "1";
    renderPSize(); setPMain(pCur.images[0] || "", 0); renderPThumbs();
    document.getElementById("pDesc").innerHTML = p.desc
      ? `<p>${esc(p.desc)}</p>` + (p.details && p.details.length ? `<ul>${p.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "")
      : "";
    const rel = PRODUCTS.filter((x) => x.sub === p.sub && x.id !== p.id).slice(0, 4);
    document.getElementById("pRel").innerHTML = rel.map((r) =>
      `<button class="rel-it" onclick="openProduct(${r.id})"><img src="${apiSized(r.img, 200)}" loading="lazy" alt=""/><span>${esc((r.name || "").slice(0, 26))}</span></button>`).join("");
    updatePWa();
    document.getElementById("pOverlay").classList.add("show");
    document.body.style.overflow = "hidden";
  } catch (e) {
    console.error("openProduct falló:", e);
    document.getElementById("pDesc").innerHTML =
      `<p style="color:#999">No se pudo cargar este producto. Cierra y reintenta.</p>`;
    document.getElementById("pOverlay").classList.add("show");
    document.body.style.overflow = "hidden";
  }
}
function closeProduct() {
  document.getElementById("pOverlay").classList.remove("show");
  document.body.style.overflow = "";
  pCur = null;
}
function setPMain(src, idx) {
  const zw = document.getElementById("pZoom");
  zw.classList.remove("zooming");
  document.getElementById("pMain").style.transformOrigin = "center";
  document.getElementById("pMain").src = src;
  document.querySelectorAll("#pThumbs img").forEach((im, k) => im.classList.toggle("sel", k === idx));
}
// lupa: el zoom sigue al mouse dentro de la foto
(function initZoom() {
  const zw = document.getElementById("pZoom");
  const img = document.getElementById("pMain");
  if (!zw || !img) return;
  zw.addEventListener("mousemove", (e) => {
    const r = zw.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    img.style.transformOrigin = `${x.toFixed(1)}% ${y.toFixed(1)}%`;
  });
  zw.addEventListener("mouseenter", () => zw.classList.add("zooming"));
  zw.addEventListener("mouseleave", () => {
    zw.classList.remove("zooming");
    img.style.transformOrigin = "center";
  });
})();
function renderPThumbs() {
  document.getElementById("pThumbs").innerHTML = pGal.map((g, k) =>
    `<img src="${apiSized(g.img, 200)}" loading="lazy" alt="" class="${k === 0 ? "sel" : ""}" onclick="setPMain('${g.img}',${k})"/>`).join("");
}
// Corrida de tallas estilo referencia: con stockBySize se muestra XS–XXL y las
// agotadas (0 o ausentes) van tachadas sin click. Sin stockBySize, legacy.
const SIZE_RUN = ["XS", "S", "M", "L", "XL", "XXL"];
function modelLine(mod) {
  if (!mod || (!mod.size && !mod.height)) return "";
  if (mod.size && mod.height) return `El modelo utiliza talla ${esc(mod.size)} y mide ${esc(mod.height)} m.`;
  if (mod.size) return `El modelo utiliza talla ${esc(mod.size)}.`;
  return `El modelo mide ${esc(mod.height)} m.`;
}
const jsEsc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
function renderPSize() {
  const el = document.getElementById("pSizes");
  const sbs = pCur.stockBySize;
  if (sbs) {
    el.innerHTML = SIZE_RUN.map((s) => {
      const n = sbs[s];
      const out = n === undefined || n <= 0;
      return `<span class="${s === pSize && !out ? "sel" : ""}${out ? " out" : ""}"` +
        (out ? ` title="Agotada"` : ` onclick="pickPSize('${jsEsc(s)}')"`) + `>${s}</span>`;
    }).join("");
  } else {
    el.innerHTML = pCur.sizes.map((s) =>
      `<span class="${s === pSize ? "sel" : ""}" onclick="pickPSize('${jsEsc(s)}')">${s}</span>`).join("");
  }
  const add = document.getElementById("pAdd");
  const ok = pCur.sizes.length > 0;
  add.disabled = !ok;
  add.textContent = ok ? "Añadir al carrito" : "Agotado";
}
function pickPSize(s) { pSize = s; renderPSize(); updatePWa(); }
function updatePWa() {
  if (!pCur) return;
  const m = encodeURIComponent(`Hola Kanada! Me interesa:\n• ${pCur.name} (${pSize || "única"}) x${pQty} - ${pCur.priceOk ? fmt(pCur.price * pQty) : "a convenir"}`);
  document.getElementById("pWa").href = `${WA}?text=${m}`;
}
document.getElementById("pClose").onclick = closeProduct;
document.getElementById("pOverlay").onclick = (e) => { if (e.target.id === "pOverlay") closeProduct(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeProduct(); closeDrawer(); closeMenus(); } });
document.getElementById("pMinus").onclick = () => { pQty = Math.max(1, pQty - 1); document.getElementById("pQtyV").textContent = pQty; updatePWa(); };
document.getElementById("pPlus").onclick = () => { pQty = Math.min(99, pQty + 1); document.getElementById("pQtyV").textContent = pQty; updatePWa(); };
document.getElementById("pAdd").onclick = () => { if (pCur) { addToCart(pCur.id, pQty, pSize); closeProduct(); } };

addEventListener("scroll", () => document.getElementById("siteHeader").classList.toggle("scrolled", scrollY > 10));
const mt = document.getElementById("mtrack"); mt.innerHTML = mt.innerHTML.repeat(10);
const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: .12 });
document.querySelectorAll(".rv").forEach((el) => io.observe(el));


const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];
function fillSizes() {
  const set = new Set(); PRODUCTS.forEach((p) => p.sizes.forEach((s) => set.add(s)));
  const arr = [...set].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a), ib = SIZE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1; if (ib === -1) return -1;
    return ia - ib;
  });
  const sel = document.getElementById("sizeFilter");
  sel.innerHTML = `<option>Todas</option>` + arr.map((s) => `<option>${s}</option>`).join("");
}
function fillSubs() {
  const sel = document.getElementById("subFilter");
  const subs = [...new Set(PRODUCTS.filter((p) => state.cat === "TODOS" || p.cat === state.cat).map((p) => p.sub))].sort();
  sel.innerHTML = `<option value="TODAS">Todas</option>` + subs.map((s) => `<option>${s}</option>`).join("");
  sel.value = "TODAS";
}

function boot(data) {
  PRODUCTS = data;
  const priced = PRODUCTS.filter((p) => p.priceOk).map((p) => p.price);
  const max = priced.length ? Math.max(...priced) : 500000;
  state.max = Math.ceil(max / 50000) * 50000;
  CATALOG_MAX = state.max;
  const slider = document.getElementById("maxPrice");
  slider.max = state.max; slider.value = state.max;
  document.getElementById("maxPriceLabel").textContent = fmt(state.max);
  fillSizes(); fillSubs();
  sanitizeCart(); // descarta items con tallas inválidas del localStorage viejo
  buildCatMenu(); // desplegables por subcategoría (dinámicos desde Drive)
  rebuildDeck(); // mezcla inicial para que cada visita muestre otro orden
  const hot = PRODUCTS.filter((p) => p.tag === "HOT");
  best.innerHTML = (hot.length ? hot : PRODUCTS.filter((p) => p.cat === "HOMBRE").slice(0, 4)).slice(0, 4).map(card).join("");
  render(); renderCart();
}
// Tienda 100% Drive: solo /api/products. Sin catálogo estático (ver respaldo ZIP).
// Si la API falla o Drive está vacío, se muestra estado controlado en vez de fallback.
function showCatalogError(msg) {
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:#999;padding:2rem">${msg}<br/><br/>` +
    `<button class="btn btn-dark" onclick="location.reload()">Reintentar</button></div>`;
  document.getElementById("prodCount").textContent = "0 productos";
}
fetch("/api/products").then((r) => { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
  .then((d) => {
    if (!Array.isArray(d)) throw new Error("respuesta inválida");
    if (!d.length) { boot([]); showCatalogError("Aún no hay productos publicados en Drive."); return; }
    boot(d);
  })
  .catch(() => showCatalogError("Catálogo Drive no disponible en este momento."));
renderCart();
