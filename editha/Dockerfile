ARG BUILD_FROM=ghcr.io/home-assistant/base:3.22

# Compilazione: produce solo JavaScript, uguale su ogni architettura. Né il server
# né l'interfaccia hanno dipendenze native: il bundler è esbuild in WebAssembly
# (vedi ENG-7 e FEP #17).
FROM ${BUILD_FROM} AS server
RUN apk add --no-cache nodejs npm
WORKDIR /build
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build \
    && npm prune --omit=dev --no-audit --no-fund

FROM ${BUILD_FROM} AS web
RUN apk add --no-cache nodejs npm
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/build.mjs ./
# La versione dell'add-on, mostrata nella finestra "Informazioni".
COPY config.yaml ./
COPY web/public ./public
COPY web/src ./src
RUN npm run build

FROM ${BUILD_FROM}
# git: GIT-1…6, repository locale in /config (solo comandi locali).
RUN apk add --no-cache nodejs git
WORKDIR /app
COPY --from=server /build/package.json ./
COPY --from=server /build/node_modules ./node_modules
COPY --from=server /build/dist ./dist
COPY --from=web /build/dist ./web

ENV NODE_ENV=production
CMD ["node", "/app/dist/main.js"]

ARG BUILD_VERSION
LABEL \
    io.hass.name="Editha" \
    io.hass.description="Smart file editor for Home Assistant" \
    io.hass.type="addon" \
    io.hass.version="${BUILD_VERSION}" \
    org.opencontainers.image.licenses="MIT"
