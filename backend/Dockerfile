# MandiMitra API + worker image. Build from the repository root:
#   docker build -f backend/Dockerfile -t mandimitra-api .
# Same image, three commands:
#   API:        (default)                 node dist/server.js
#   Worker:     node --enable-source-maps dist/worker.js
#   Migrations: docker build --target migrate …  then run it once per release, before the new API starts.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY database/package.json database/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace @mandimitra/backend --workspace @mandimitra/database --workspace @mandimitra/shared --include-workspace-root
COPY packages/shared packages/shared
COPY database database
COPY backend backend
RUN npm run generate -w @mandimitra/database && npm run build -w @mandimitra/backend

# One-shot migration runner (has the Prisma CLI).
FROM build AS migrate
WORKDIR /app/database
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-bookworm-slim AS runtime
# Chromium + Noto fonts (Devanagari) for patti / statement / receipt PDFs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-noto-ui-core ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PDF_BROWSER_PATH=/usr/bin/chromium \
    TZ=Asia/Kolkata
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY database/package.json database/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace @mandimitra/backend --workspace @mandimitra/database --workspace @mandimitra/shared --include-workspace-root \
 && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
USER node
WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server.js"]
