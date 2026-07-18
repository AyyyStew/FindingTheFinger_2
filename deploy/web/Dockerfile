FROM node:22-alpine AS build

WORKDIR /app/webapp/frontend

COPY webapp/frontend/package.json webapp/frontend/package-lock.json ./
RUN npm ci

COPY webapp/frontend ./

ARG VITE_STATIC_BASE_URL=/static
ENV VITE_STATIC_BASE_URL=${VITE_STATIC_BASE_URL}

RUN npm run build

FROM caddy:2.10-alpine

COPY deploy/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/webapp/frontend/dist /srv

EXPOSE 80 443
