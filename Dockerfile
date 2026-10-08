FROM node:22-bookworm-slim AS build
WORKDIR /app/worker
COPY worker/package.json worker/package-lock.json ./
RUN npm ci
COPY worker/tsconfig.json ./tsconfig.json
COPY worker/src ./src
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends docker.io ca-certificates dumb-init && rm -rf /var/lib/apt/lists/*
WORKDIR /app/worker
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/worker/dist ./dist
RUN mkdir -p /opt/code-auction/worker-data && chown -R node:node /opt/code-auction/worker-data
ENV NODE_ENV=production WORKER_HEALTH_PORT=9091 WORKER_WORKSPACE_ROOT=/opt/code-auction/worker-data
EXPOSE 9091
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
