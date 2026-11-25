# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATABASE_FILE=/data/abyssal.db CLIENT_DIR=/app/client
COPY package.json package-lock.json* ./
RUN (npm ci --omit=dev || npm install --omit=dev) && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/client/index.html /app/client/styles.css /app/client/config.js ./client/
COPY --from=build /app/client/dist ./client/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "--no-warnings=ExperimentalWarning", "dist/server.js"]
