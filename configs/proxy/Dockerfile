FROM node:22-slim

WORKDIR /app

# Copy the built packages
COPY packages/manifest/dist ./packages/manifest/dist
COPY packages/manifest/package.json ./packages/manifest/
COPY packages/proxy/dist ./packages/proxy/dist
COPY packages/proxy/public ./packages/proxy/public
COPY packages/proxy/package.json ./packages/proxy/
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile --prod

EXPOSE 8080

CMD ["node", "packages/proxy/dist/index.js"]
