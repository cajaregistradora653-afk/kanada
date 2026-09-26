FROM nginx:alpine
# Sitio 100% estatico: sin build, sin dependencias
WORKDIR /usr/share/nginx/html
COPY index.html styles.css app.js products.json products.js ./
COPY assets ./assets
COPY logo-kanada.png hero-bg.jpg hero.mp4 hero-poster.jpg hot-sale.jpg cat-agropecuario.jpg cat-hombre.jpg cat-mujer.jpg cat-accesorios.jpg ./
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
