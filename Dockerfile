FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev=false
COPY worker ./worker
RUN npm run worker:build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends docker.io ca-certificates dumb-init && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/worker/dist ./worker/dist
RUN mkdir -p /opt/code-auction/worker-data && chown -R node:node /opt/code-auction/worker-data
ENV NODE_ENV=production WORKER_HEALTH_PORT=9091 WORKER_WORKSPACE_ROOT=/opt/code-auction/worker-data
EXPOSE 9091
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "worker/dist/index.js"]
