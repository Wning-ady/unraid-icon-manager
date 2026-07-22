FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.server.json tsconfig.client.json vite.config.ts eslint.config.js ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libvirt-clients && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /config /unraid/templates-user
EXPOSE 8787
VOLUME ["/config"]
CMD ["node", "dist/server/server.js"]
