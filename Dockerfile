# Внешние источники задаются опционально. Без переопределения используются
# публичные адреса, поэтому обычная сборка работает как раньше.
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
ARG NODE_IMAGE=node:22-alpine
ARG NODEJS_DIST_URL=https://nodejs.org/dist

FROM ${NODE_IMAGE} AS dependencies
ARG NPM_REGISTRY
ARG NODEJS_DIST_URL
# npm берёт пакеты из реестра, а сборка нативных модулей — заголовки Node.js из disturl.
ENV npm_config_registry=${NPM_REGISTRY} npm_config_disturl=${NODEJS_DIST_URL}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runner
ARG ALPINE_MIRROR
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Заменяется только базовый адрес; версия выпуска и разделы main/community остаются из образа.
RUN sed -i "s#https\?://dl-cdn\.alpinelinux\.org/alpine#${ALPINE_MIRROR}#g" /etc/apk/repositories \
    && apk add --no-cache ffmpeg && addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
USER nextjs
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
