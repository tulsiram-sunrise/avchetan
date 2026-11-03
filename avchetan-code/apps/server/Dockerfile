# Avchetan server. Build from avchetan-code/:
#   docker build -f apps/server/Dockerfile -t avchetan-server .
# Runs on Postgres (DB_DRIVER=postgres, DATABASE_URL) or on PGlite in /data (DB_DRIVER=pglite).

FROM node:24.22.1-slim AS build
WORKDIR /repo
RUN corepack enable
# Manifests first, so the install layer is reused until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tooling/tsconfig.base.json tooling/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/sync/package.json packages/sync/
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
# No scripts: the root `prepare` installs git hooks, and esbuild's binary arrives as a package.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @avchetan/server...
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/sync packages/sync
COPY packages/core packages/core
COPY apps/server apps/server
RUN pnpm --filter @avchetan/server build \
  && mkdir -p /out/node_modules/@electric-sql \
  && cp apps/server/dist/server.mjs apps/server/dist/server.mjs.map /out/ \
  && cp -rL apps/server/node_modules/@electric-sql/pglite apps/server/node_modules/@electric-sql/pglite-pgvector /out/node_modules/@electric-sql/

FROM node:24.22.1-slim
ENV NODE_ENV=production \
  PGLITE_DATA_DIR=/data \
  BACKUP_DIR=/backups \
  PORT=8787 \
  BIND_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /out ./
RUN mkdir /data /backups && chown node:node /data /backups
VOLUME ["/data", "/backups"]
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--enable-source-maps", "server.mjs"]
