# syntax=docker/dockerfile:1.7
# Собирает прежние версии из официальных исходников, проверяя архивы до распаковки.
#
# Все внешние источники задаются опционально и по умолчанию указывают на публичные
# адреса. Для закрытого контура достаточно переопределить их через build args.
ARG ARCHIVE_BASE=https://codeload.github.com
ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security
ARG GO_PROXY=https://proxy.golang.org,direct
ARG GO_SUMDB=sum.golang.org
ARG GO_IMAGE=golang:1.24.13-bookworm
ARG DEBIAN_IMAGE=debian:bookworm-slim
ARG MINIO_SOURCE_URL=${ARCHIVE_BASE}/minio/minio/tar.gz/07c3a429bfed433e49018cb0f78a52145d4bedeb
ARG MC_SOURCE_URL=${ARCHIVE_BASE}/minio/mc/tar.gz/7394ce0dd2a80935aded936b09fa12cbb3cb8096
# Контрольные суммы относятся к содержимому архивов, а не к адресу: зеркало должно
# отдавать те же байты. Меняйте их только вместе с проверкой архива вручную.
ARG MINIO_SOURCE_SHA256=sha256:8819e3e7817e46b7b3798f8f200ead208562e571563c2e040352378031abe9f2
ARG MC_SOURCE_SHA256=sha256:95cd293c7119f16921a6dc515a1fb74a2227f19fd994b9c8b770a154e802ac44

FROM ${GO_IMAGE} AS server-build
ARG MINIO_SOURCE_URL
ARG MINIO_SOURCE_SHA256
ARG GO_PROXY
ARG GO_SUMDB
ADD --checksum=${MINIO_SOURCE_SHA256} ${MINIO_SOURCE_URL} /tmp/source.tar.gz
RUN mkdir /src && tar -xzf /tmp/source.tar.gz -C /src --strip-components=1
WORKDIR /src
# Модули проверяются по go.sum из самих исходников, поэтому GO_SUMDB=off безопасен,
# если внутренний прокси не проксирует sum.golang.org.
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY=${GO_PROXY} GOSUMDB=${GO_SUMDB}
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w -X github.com/minio/minio/cmd.Version=2025-09-07T16:13:09Z -X github.com/minio/minio/cmd.ReleaseTag=RELEASE.2025-09-07T16-13-09Z -X github.com/minio/minio/cmd.CommitID=07c3a429bfed433e49018cb0f78a52145d4bedeb -X github.com/minio/minio/cmd.ShortCommitID=07c3a429bfed4" -o /out/minio .

# Клиент нужен только для создания приватного бакета в standalone-поставке.
FROM ${GO_IMAGE} AS client-build
ARG MC_SOURCE_URL
ARG MC_SOURCE_SHA256
ARG GO_PROXY
ARG GO_SUMDB
ADD --checksum=${MC_SOURCE_SHA256} ${MC_SOURCE_URL} /tmp/source.tar.gz
RUN mkdir /src && tar -xzf /tmp/source.tar.gz -C /src --strip-components=1
WORKDIR /src
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY=${GO_PROXY} GOSUMDB=${GO_SUMDB}
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w -X github.com/minio/mc/cmd.Version=2025-08-13T08:35:41Z -X github.com/minio/mc/cmd.ReleaseTag=RELEASE.2025-08-13T08-35-41Z -X github.com/minio/mc/cmd.CommitID=7394ce0dd2a80935aded936b09fa12cbb3cb8096 -X github.com/minio/mc/cmd.ShortCommitID=7394ce0dd2a8" -o /out/mc .

# Добавляет сертификаты для внешнего S3 и curl для проверки состояния сервера.
FROM ${DEBIAN_IMAGE} AS runtime
ARG DEBIAN_MIRROR
ARG DEBIAN_SECURITY_MIRROR
# Образ использует формат deb822 (/etc/apt/sources.list.d/debian.sources), файл
# переписывается целиком. Подпись остаётся дебиановской: зеркало должно быть
# точной копией репозитория. Предпочитайте http — CA-сертификаты появляются
# только после установки ca-certificates ниже.
RUN printf '%s\n' \
      'Types: deb' \
      "URIs: ${DEBIAN_MIRROR}" \
      'Suites: bookworm bookworm-updates' \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      '' \
      'Types: deb' \
      "URIs: ${DEBIAN_SECURITY_MIRROR}" \
      'Suites: bookworm-security' \
      'Components: main' \
      'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
      > /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

FROM runtime AS server
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="07c3a429bfed433e49018cb0f78a52145d4bedeb" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY --from=server-build /out/minio /usr/local/bin/minio
COPY --from=server-build /src/LICENSE /usr/share/licenses/minio/LICENSE
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]

FROM runtime AS client
LABEL org.opencontainers.image.source="https://github.com/minio/mc" \
      org.opencontainers.image.revision="7394ce0dd2a80935aded936b09fa12cbb3cb8096" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY --from=client-build /out/mc /usr/local/bin/mc
COPY --from=client-build /src/LICENSE /usr/share/licenses/mc/LICENSE
ENTRYPOINT ["mc"]
