# Kanada Tienda — Despliegue en VPS

Repo deployable (raíz). Tienda 100% Drive en vivo: `app.js` pide solo a `/api/products`.
Sin `.env` válido la tienda queda vacía (no hay fallback estático).
No requiere Node en el servidor salvo Docker.

## Contenido
| Archivo | Qué es |
|---|---|
| `index.html`, `styles.css`, `app.js` | La tienda |
| `products.json` | Placeholder (`[]`): el catálogo real viene de Drive vía `/api/products` |
| `api/` | API Drive en vivo (`server.js`, `drive-kanada.js`) |
| `assets/` | Fotos optimizadas (~34MB) |
| `Dockerfile`, `docker-compose.yml`, `nginx.conf` | Despliegue con Docker |
| `logo-kanada.png`, `hero-bg.jpg`, `cat-*.jpg` | Imágenes de portada/categorías |

## Opción A — Docker (recomendada, 3 comandos)
```bash
cd /ruta/a/kanada
cp .env.example .env   # pega los 3 valores del service-account (ver API Drive abajo)
docker compose up -d --build
# Abrir http://IP-del-VPS:8080
```

## API Drive en vivo (contenedor `api`)
Subir una carpeta a Drive = nuevo producto en la tienda, sin rebuild.
Convención de carpetas:
`CAT__SUB__REF-$PRECIO__TALLAS` (ej: `HOMBRE__Camisetas__S-CLEMONT-Negro-$110.000__M-L-XL`),
fotos dentro + `ficha.docx` opcional (`PRECIO:/CAT:/SUB:/TALLA:/STOCK:/DESCRIPCION:/DETALLES DEL PRODUCTO:`).

1. Service-account: crea `kanada-sync`, key JSON,
   comparte la carpeta `KANADA-TIENDA` con su email como **Lector**.
2. En el VPS, junto al `docker-compose.yml`, crea `.env` desde `.env.example` con:
   `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
3. `docker compose up -d --build`
4. Verifica: `http://IP-del-VPS:8080/api/health` → `{"ok":true,"configured":true,...}`
   y `http://IP-del-VPS:8080/api/products` → JSON. La tienda es 100% Drive:
   si la API responde 503 (sin `.env` válido), el catálogo sale vacío.
5. Borrar una carpeta en Drive la saca de la tienda en ≤60s (cache).

## Opción B — Nginx nativo (Ubuntu)
```bash
sudo apt install -y nginx
sudo mkdir -p /var/www/kanada && sudo cp -r * /var/www/kanada/
sudo cp nginx.conf /etc/nginx/sites-available/kanada
# editar server_name con el dominio, luego:
sudo ln -s /etc/nginx/sites-available/kanada /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
HTTPS cuando haya dominio: `sudo certbot --nginx -d tudominio.com`.

## Opción C — Panel (aaPanel / Hestia / cPanel)
Subir el contenido de esta carpeta al `public_html` o sitio correspondiente. Sin pasos extra.

## Actualizar productos/precios
1. Sube/renombra carpetas en Drive con el formato `CAT__SUB__REF-$PRECIO__TALLAS`.
2. Visible en la tienda en ≤60s (cache), sin rebuild ni re-deploy.

## Notas
- Productos sin precio en el nombre muestran **"Consultar precio"** y se piden por WhatsApp (`wa.me/573227436671`, configurable en `app.js` → `WA`).
- El carrito se guarda en el navegador del cliente (localStorage).
- `index.html` y `products.json` no se cachean; las fotos sí (30 días, nombres con hash único).
