FROM node:20-alpine
WORKDIR /srv/api
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY server.js drive-kanada.js ./
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
