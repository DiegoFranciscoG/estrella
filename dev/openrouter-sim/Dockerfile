# Local stand-in for OpenRouter (development and end-to-end tests only; it is not OpenRouter).
# One file and no dependencies, so there is nothing to build and a single stage is enough.
FROM node:26.12.1-alpine
WORKDIR /app
COPY server.mjs ./
USER node
EXPOSE 8091
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8091/health || exit 1
CMD ["node", "server.mjs"]
