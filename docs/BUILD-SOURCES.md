# Адреса для скачивания пакетов при сборке

Ваши зеркала задаются в `.env` рядом с `compose.yaml`. Существующие адреса
сохраняются; все параметры необязательны. После изменения пересоберите нужный образ.

| Источник | Переменные | По умолчанию |
| --- | --- | --- |
| apk / Alpine | `ALPINE_MIRROR` | `https://dl-cdn.alpinelinux.org/alpine` |
| apt / Debian | `DEBIAN_MIRROR`, `DEBIAN_SECURITY_MIRROR` | `http://deb.debian.org/debian`, `http://deb.debian.org/debian-security` |
| Модули Go | `GO_PROXY`, `GO_SUMDB` | `https://proxy.golang.org,direct`, `sum.golang.org` |
| Пакеты Node.js | `NPM_REGISTRY` | `https://registry.npmjs.org/` |
| Заголовки Node.js для сборки нативных модулей | `NODEJS_DIST_URL` | `https://nodejs.org/dist` |
| Базовый образ Node.js | `NODE_IMAGE` | `node:22-alpine` |
| Базовый образ сборщика Go | `GO_IMAGE` | `golang:1.24.13-bookworm` |
| Базовый образ хранилища | `DEBIAN_IMAGE` | `debian:bookworm-slim` |
| Архивы MinIO и клиента | `ARCHIVE_BASE` либо `MINIO_SOURCE_URL`, `MC_SOURCE_URL` | GitHub codeload |

Node.js устанавливается из базового образа; `NODEJS_DIST_URL` используется npm
при компиляции нативных модулей и не заменяет `NODE_IMAGE`. Для собственного
реестра сохраните совместимые семейства образов: Node на Alpine, Go и Debian
на Bookworm. Для готовых образов приложения используются `KONTUR_IMAGE`, а для
хранилища — `MINIO_IMAGE` и `MINIO_CLIENT_IMAGE`.

```dotenv
ALPINE_MIRROR=https://packages.example.org/alpine
DEBIAN_MIRROR=http://packages.example.org/debian
DEBIAN_SECURITY_MIRROR=http://packages.example.org/debian-security
GO_PROXY=https://packages.example.org/go
NPM_REGISTRY=https://packages.example.org/npm/
NODEJS_DIST_URL=https://packages.example.org/node/dist
NODE_IMAGE=registry.example.org/library/node:22-alpine
```

Это примеры адресов; замените их своими. Для изолированной сети не оставляйте
резервный `direct` в `GO_PROXY`, если обращения к внешним репозиториям запрещены.
Настройте доступный сервер контрольных сумм через `GO_SUMDB`.

```bash
docker compose build app worker
docker compose build minio minio-init
```

При прямом `docker build` параметры передаются через `--build-arg`; `.env`
автоматически читает Compose. Helm устанавливает готовый образ и не скачивает
пакеты: зеркала задаются на этапе сборки образа перед его публикацией в реестр.
При локальном запуске npm вне Docker используйте `npm ci --registry=АДРЕС`
и `npm_config_disturl` для заголовков Node.js.

Подписи apt, сертификаты HTTPS, lock-файл npm, `go.sum` и контрольные суммы
архивов сохраняются. Особенности Debian и архивов описаны в
[руководстве хранилища](../deploy/storage/README.md).
