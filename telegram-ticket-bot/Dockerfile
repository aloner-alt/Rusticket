FROM node:24-bookworm-slim
WORKDIR /app
COPY index.mjs ./index.mjs
COPY form.mjs ./form.mjs
USER node
CMD ["node", "index.mjs"]
