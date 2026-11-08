# Build
FROM node:26.12.1-alpine AS build
WORKDIR /src
ARG VITE_APPS_ORIGIN
ENV VITE_APPS_ORIGIN=${VITE_APPS_ORIGIN}
# Local stack only: where its test emails can be read (docker-compose.yml). Empty in production.
ARG VITE_DEV_MAILBOX
ENV VITE_DEV_MAILBOX=${VITE_DEV_MAILBOX}
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Serve: unprivileged nginx with strict headers. Port 8080 is the panel, 8081 the programs site.
FROM nginxinc/nginx-unprivileged:1.30.6-alpine
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
