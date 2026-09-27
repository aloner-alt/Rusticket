FROM node:22-bookworm-slim

WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY src ./src
RUN mkdir -p /app/.data && chown node:node /app/.data

USER node
CMD ["node", "src/index.cjs"]
