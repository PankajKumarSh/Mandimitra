# MandiMitra web (Next.js standalone). Build from the repository root:
#   docker build -f frontend/Dockerfile --build-arg API_ORIGIN=http://api:4000 --build-arg APP_URL=https://app.example.in -t mandimitra-web .
# API_ORIGIN and APP_URL are read at BUILD time (Next bakes rewrites and headers into the build).

FROM node:24-bookworm-slim AS build
ARG API_ORIGIN=http://api:4000
ARG APP_URL=
ENV API_ORIGIN=$API_ORIGIN APP_URL=$APP_URL NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY database/package.json database/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace @mandimitra/frontend --workspace @mandimitra/shared --include-workspace-root
COPY packages/shared packages/shared
COPY frontend frontend
RUN npm run build -w @mandimitra/frontend

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./frontend/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "frontend/server.js"]
