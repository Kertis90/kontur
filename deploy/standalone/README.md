# Standalone-развёртывание в Docker

Этот профиль запускает Контур Work, worker, recording-worker, MySQL 8.4, Redis, MinIO, LiveKit Egress и LiveKit SFU со встроенным TURN на одном сервере через Docker Compose. Опциональный профиль `gateway` добавляет Caddy с автоматическим HTTPS для приложения и signal endpoint LiveKit. Отказ хоста остановит всю платформу, поэтому для мероприятия примерно на 1000 человек используйте Kubernetes-профиль либо отдельный заранее протестированный media-сервер.

## Требования и запуск

- Linux x86_64/arm64;
- Docker Engine 24+ и Docker Compose v2;
- для приложения без записи — от 4 vCPU, 8 ГБ RAM и отдельный SSD volume;
- для записи дополнительно выделите Egress 4 vCPU / 4 ГБ RAM и recording-worker временный диск от 24 ГБ (по умолчанию до 20 ГБ на исходное видео);
- для выделенного media-хоста — compute-optimized CPU, 16+ vCPU и 10 Гбит/с, с обязательным нагрузочным тестом.

Из корня репозитория:

```bash
cp .env.example .env
openssl rand -base64 48
openssl rand -hex 32
openssl rand -base64 36
```

Запишите результаты в `AUTH_SECRET`, `APP_ENCRYPTION_KEY` и `LIVEKIT_API_SECRET`, замените все пароли в `.env`, затем выполните:

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:3000/api/health
```

Сервис `migrate` один раз применяет схему MySQL и создаёт первого владельца до запуска app и worker. Повторный запуск безопасен.

## Запуск готового образа

Укажите в `.env`:

```dotenv
KONTUR_IMAGE=registry.company.ru/platform/kontur-work:0.21.0
```

После этого:

```bash
docker compose pull app worker recording-worker migrate egress
docker compose up -d --no-build
```

## Обновление

Сначала сделайте резервную копию, затем измените tag `KONTUR_IMAGE` и выполните:

```bash
docker compose pull app worker recording-worker migrate egress
docker compose up -d --no-build --wait
docker compose ps
```

При локальной сборке вместо этого используйте `docker compose up -d --build --wait`.

## Хранение и доступ

Данные находятся в именованных volumes `mysql_data`, `redis_data` и `minio_data`. Наружу опубликованы web-порт 3000, LiveKit signal 7880/TCP, ICE 7881/TCP и 7882/UDP, TURN 3478/UDP и консоль MinIO 9001. Метрики LiveKit 6789 доступны только на loopback. В production закройте консоль MinIO firewall.

Не удаляйте volumes командой `docker compose down -v`, если требуется сохранить данные.

## HTTPS, конференции, PWA и расшифровка

Для локальной проверки используется `LIVEKIT_WS_URL=ws://localhost:7880`. Для production создайте DNS-записи `APP_DOMAIN` и `LIVEKIT_DOMAIN` на сервер, задайте `APP_URL=https://...`, `LIVEKIT_WS_URL=wss://...`, включите `LIVEKIT_USE_EXTERNAL_IP=true` и запустите Caddy:

```bash
docker compose --profile gateway up -d --build
```

Разрешите на внешнем firewall 80/TCP и 443/TCP+UDP для Caddy, 7881/TCP, 7882/UDP и 3478/UDP для WebRTC/TURN. Signal-порт 7880 можно закрыть от интернета после проверки `wss://LIVEKIT_DOMAIN`; Caddy обращается к нему внутри Compose-сети. TURN/TLS на 5349 в standalone-профиле не включён: если UDP 3478 блокируется корпоративной сетью, используйте Kubernetes-профиль с TURN/TLS либо вынесенный TLS TURN.

Интерфейс не просит заранее указывать число участников и не задаёт `maxParticipants` для комнаты LiveKit. Для встречи примерно на 1000 зрителей используйте вебинар с небольшим числом докладчиков. Одна комната LiveKit обслуживается одним media-узлом, поэтому standalone нельзя считать гарантированно готовым к 1000 подключениям без репетиции и load test.

Для голосовой расшифровки укажите `STT_API_URL`, при необходимости `STT_API_KEY`, а также модель и язык. Эти параметры получает worker; расшифрованный текст сохраняется в MySQL и повторно не тарифицируется.

Для телефонии задайте `TELEPHONY_API_URL`, `TELEPHONY_API_TOKEN`, `TELEPHONY_WEBHOOK_SECRET` и `TELEPHONY_FROM_NUMBER`. Контур Work обращается к HTTP-шлюзу телефонии, поэтому подключение к Asterisk, FreeSWITCH или облачной АТС выполняется небольшим адаптером по контракту из `docs/API.md`. Callback должен быть доступен шлюзу по `APP_URL/api/telephony/webhook`.

## Резервное копирование

Для согласованного MySQL-дампа:

```bash
mkdir -p backups
docker compose exec -T mysql sh -c \
  'exec mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  > backups/kontur-$(date +%F-%H%M).sql
```

Также включите volumes MinIO и Redis в резервное копирование хоста. Восстановление сначала проверяйте на отдельном сервере. MySQL и вложения должны восстанавливаться из одной согласованной точки времени.

## Переход в Kubernetes

Docker и Helm используют один контейнерный образ и одинаковые переменные окружения. Для перехода перенесите MySQL в HA-кластер, скопируйте MinIO bucket в S3, подготовьте HA Redis и установите chart из `deploy/helm/kontur-work`.

## Опциональная запись встреч и ИИ

Egress и recording-worker входят в Compose. Задайте `LIVEKIT_EGRESS_IMAGE` (для production — закреплённый digest). `RECORDING_ENABLED=false` запрещает новые записи; по умолчанию запись разрешена, но запускается только по кнопке пользователем с соответствующим правом. S3 задаётся общими `S3_ENDPOINT`, `S3_BUCKET`, ключами и `S3_FORCE_PATH_STYLE`. Для внешнего S3 создайте приватный bucket заранее.

Для одной одновременно записываемой комнаты предусмотрен один Egress; несколько комнат требуют масштабирования и дополнительных ресурсов. ИИ и распознавание настраиваются в **Администрирование → Искусственный интеллект**. [Руководство](../../docs/AI-RECORDINGS-ACCESS.md).
