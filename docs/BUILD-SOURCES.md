# Репозитории, прокси и закрытый реестр

Ваши зеркала задаются в `.env` рядом с `compose.yaml`. Существующие адреса
сохраняются; все параметры необязательны. После изменения пересоберите нужный образ.
Можно одновременно использовать внутренние репозитории и HTTP/HTTPS-прокси.
Для Kubernetes применяется та же сборка, после чего готовые образы загружаются
в доступный кластеру реестр.

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
| Обработчик Dockerfile хранилища | `BUILDKIT_SYNTAX` | `docker/dockerfile:1.7` |

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

## HTTP/HTTPS-прокси вместе с зеркалами

Пример дополнения своего `.env` (адреса вымышленные):

```dotenv
HTTP_PROXY=http://proxy.company.ru:3128
HTTPS_PROXY=http://proxy.company.ru:3128
NO_PROXY=localhost,127.0.0.1,nexus.company.ru,registry.company.ru
NPM_REGISTRY=https://nexus.company.ru/repository/npm-proxy/
ALPINE_MIRROR=https://nexus.company.ru/repository/alpine
DEBIAN_MIRROR=http://nexus.company.ru/repository/debian
DEBIAN_SECURITY_MIRROR=http://nexus.company.ru/repository/debian-security
GO_PROXY=https://nexus.company.ru/repository/go-proxy
NODEJS_DIST_URL=https://nexus.company.ru/repository/nodejs-dist
```

`HTTPS_PROXY` часто имеет адрес с `http://`: HTTPS-соединение проходит через
туннель CONNECT. `NO_PROXY` перечисляет узлы, доступные напрямую; уберите из него
внутренний репозиторий, если к нему тоже нужно обращаться через прокси.
Не указывайте здесь адрес контейнера `localhost`, если прокси работает на другом
компьютере. `ALL_PROXY` передаётся дополнительно для клиентов, которые его поддерживают;
основные параметры для пакетов — `HTTP_PROXY` и `HTTPS_PROXY`.

Compose передаёт эти четыре значения всем стадиям сборки приложения и хранилища.
Неуказанные значения сохраняют настройки Docker-клиента. При изменении маршрута
проверяйте загрузку с `docker compose build --no-cache app minio minio-init`:
иначе ранее собранные слои могут скрыть отсутствие сетевого доступа.

Используются встроенные [параметры прокси BuildKit](https://docs.docker.com/build/building/variables/#proxy-arguments).
Они не объявлены через `ARG`/`ENV` в Dockerfile и не добавляются в окружение
приложения или историю образа. `.env`, вывод `docker compose config` и журналы
сборки с адресами своего прокси храните локально. Адреса зеркал не должны содержать
логины и токены: обычные аргументы сборки не являются хранилищем секретов.
Если репозиторий требует отдельную авторизацию, настройте её на сборщике через
[BuildKit secrets](https://docs.docker.com/build/building/secrets/); текущие примеры
предполагают доступ к зеркалам без отдельного токена.

## Все образы из своего реестра

| Компонент Compose | Параметр | Прежний образ по умолчанию |
| --- | --- | --- |
| Приложение, фоновые процессы, миграции | `KONTUR_IMAGE` | `kontur-work:local` |
| MySQL, в том числе проверка восстановления | `MYSQL_IMAGE` | `mysql:8.4` |
| PostgreSQL, в том числе проверка восстановления | `POSTGRES_IMAGE` | `postgres:18-bookworm` |
| Redis | `REDIS_IMAGE` | `redis:7.4-alpine` |
| MinIO | `MINIO_IMAGE` | `kontur-minio:2025-09-07` |
| Клиент MinIO | `MINIO_CLIENT_IMAGE` | `kontur-minio-client:2025-08-13` |
| LiveKit | `LIVEKIT_IMAGE` | `livekit/livekit-server:v1.13.6` |
| Запись встреч | `LIVEKIT_EGRESS_IMAGE` | `livekit/egress:latest` |
| HTTPS-шлюз | `GATEWAY_IMAGE` | `caddy:2.10-alpine` |

Скопируйте совместимые образы в свой реестр, затем задайте их полные имена в `.env`.
Для записи встреч перед рабочим запуском закрепите проверенный digest вместо
`latest`. Также нужны перечисленные выше `NODE_IMAGE`, `GO_IMAGE`, `DEBIAN_IMAGE`
и копия `docker/dockerfile:1.7` в `BUILDKIT_SYNTAX` для сборки хранилища.
Последний параметр заменяет внешний [обработчик Dockerfile](https://docs.docker.com/build/buildkit/frontend/).

```bash
docker login registry.company.ru
# KONTUR_IMAGE, MINIO_IMAGE, MINIO_CLIENT_IMAGE уже заданы в локальном .env.
docker compose build app minio minio-init
docker compose push app minio minio-init
```

На сервере с подготовленными образами используйте `docker compose pull`, затем
`docker compose up -d --no-build --wait`. Для PostgreSQL в обе команды добавьте
`-f compose.yaml -f compose.postgres.yaml`; для шлюза — `--profile gateway`.
Эти команды установки запускают обычную миграцию: перед обновлением сохраните
резервную копию, как описано в [обновлении БД](DATABASE-UPGRADES.md).

## Прокси Docker и сборщика

Аргументы сборки действуют на команды установки пакетов. Получение базовых
образов и архивов через `ADD` выполняет сам сборщик. Для этого у Docker Engine
и отдельно запущенного BuildKit должен быть свой сетевой доступ.
Это отдельная [настройка Docker Engine](https://docs.docker.com/engine/daemon/proxy/);
в Docker Desktop используйте настройки **Proxies**, а не `daemon.json`.

Для Linux Docker Engine пример дополнения существующего `/etc/docker/daemon.json`:

```json
{
  "proxies": {
    "http-proxy": "http://proxy.company.ru:3128",
    "https-proxy": "http://proxy.company.ru:3128",
    "no-proxy": "localhost,127.0.0.1,registry.company.ru,nexus.company.ru"
  }
}
```

Объедините секцию с действующим файлом, сохранив остальные настройки. Применение
и перезапуск службы планирует администратор сервера. Для отдельного buildx-сборщика
с драйвером `docker-container` задайте окружение через
[`--driver-opt env.HTTP_PROXY=…`, `env.HTTPS_PROXY=…`, `env.NO_PROXY=…`](https://docs.docker.com/build/builders/drivers/docker-container/).
Сам образ BuildKit тоже должен быть доступен; его можно заменить параметром драйвера
`image`. Эти настройки не меняются автоматически при установке Контура.

При своём центре сертификации добавьте доверие отдельно на сервере, у сборщика
и в базовых образах. Для Node.js используйте совместимый базовый образ с нужным CA
и настройкой `NODE_EXTRA_CA_CERTS`; для apt/apk — системное хранилище сертификатов.
Не отключайте проверку HTTPS или подписи пакетов для обхода ошибки сертификата.

## Kubernetes

Chart запускает готовые образы. Пакеты npm/apk/apt/Go устанавливаются до Helm,
поэтому отдельные адреса пакетных репозиториев в `values.yaml` не нужны.
Пример [values-private.example.yaml](../deploy/helm/kontur-work/values-private.example.yaml)
переопределяет образы приложения, LiveKit, записи встреч и клиентов обеих БД
для резервирования. Внешние БД, Redis, S3 и их операторы настраиваются отдельно.

Создайте Secret `kontur-registry` **в namespace установки** через своё хранилище
секретов либо из защищённого Docker config в формате `kubernetes.io/dockerconfigjson`.
Он должен существовать до установки, чтобы образ миграции тоже мог загрузиться.
Общий `imagePullSecrets` применяется ко всем pod, включая фоновые процессы,
LiveKit, запись, резервирование и `helm test`.
[Порядок Kubernetes](https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/).

```bash
# Сначала скопируйте пример вне chart и замените адреса в values-private.yaml.
helm lint deploy/helm/kontur-work --strict \
  -f values-production.yaml -f values-private.yaml
helm upgrade --install kontur-work deploy/helm/kontur-work \
  --namespace kontur-work -f values-production.yaml -f values-private.yaml \
  --atomic --wait --timeout 15m
```

Образы скачивает служба контейнеров на узлах (обычно containerd/CRI-O), поэтому
настройте прокси и доверие к реестру на **каждом узле**, включая узлы LiveKit.
Добавление `HTTP_PROXY` в pod приложения не исправит `ImagePullBackOff`.
Для службы, которой нужен HTTP-прокси, администратор задаёт соответствующие
`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` в её окружении по правилам своего дистрибутива.
Исключения должны учитывать адрес API Kubernetes, внутренний реестр, домены и
диапазоны сети кластера. Сам chart не меняет настройки узлов.

Проверка своей сети: сборка без кэша, загрузка образа из реестра на каждом типе
узлов, успешная миграция, запуск приложения, пробная запись встречи и резервная
копия. Тестовая проверка поставки не заменяет эту проверку корпоративных адресов,
авторизации и сертификатов.
