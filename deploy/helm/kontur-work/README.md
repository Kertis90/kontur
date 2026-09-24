# Контур Work в Kubernetes

Helm chart разворачивает web-приложение, фоновые worker-процессы и распределённый пул LiveKit SFU/TURN. MySQL, Redis и S3 намеренно не создаются внутри chart: для настоящей отказоустойчивости им нужны отдельные HA-кластеры, операторы или managed-сервисы. Один HA Redis используется очередью приложения и координацией media-узлов.

## Требования

- Kubernetes 1.27+ и Helm 3;
- Ingress Controller; для HPA также нужен Metrics Server;
- MySQL 8 с одним стабильным write endpoint;
- Redis с устойчивым primary endpoint;
- S3-совместимое объектное хранилище с заранее созданным приватным bucket;
- контейнерный registry, доступный из кластера;
- минимум три выделенных Linux media-узла с публично достижимыми адресами: serverless/private-only Kubernetes для self-hosted WebRTC не подходит без отдельного сетевого слоя;
- TLS-сертификаты для `projects`, `media` и `turn` доменов.

Рекомендуемая production-топология: не менее трёх app/worker-узлов в двух зонах, отдельный пул media-узлов с 16+ vCPU и 10 Гбит/с, внешний HA MySQL, HA Redis и многозонное S3-хранилище. Сам по себе запуск нескольких pod не устраняет единую точку отказа в зависимостях.

## Подготовка

Соберите и отправьте образ:

```bash
docker build -t registry.company.ru/platform/kontur-work:0.21.0 .
docker push registry.company.ru/platform/kontur-work:0.21.0
```

Создайте namespace и Secret. Он должен существовать до запуска Helm, потому что pre-install Job применяет миграции до старта приложения:

```bash
kubectl create namespace kontur-work
kubectl -n kontur-work create secret generic kontur-work-production \
  --from-literal=MYSQL_PASSWORD='replace-me' \
  --from-literal=REDIS_URL='rediss://user:password@redis.company.ru:6379' \
  --from-literal=AUTH_SECRET='replace-with-48-byte-secret' \
  --from-literal=APP_ENCRYPTION_KEY='replace-with-64-hex-characters' \
  --from-literal=S3_ACCESS_KEY='replace-me' \
  --from-literal=S3_SECRET_KEY='replace-me' \
  --from-literal=LIVEKIT_API_KEY='kontur-production-key' \
  --from-literal=LIVEKIT_API_SECRET='replace-with-at-least-32-random-characters' \
  --from-file=LIVEKIT_CONFIG=livekit-production.yaml \
  --from-file=EGRESS_CONFIG_BODY=egress-production.yaml \
  --from-literal=ADMIN_PASSWORD='replace-on-first-login'
```

Также перед созданием Secret скопируйте [egress-production.example.yaml](egress-production.example.yaml) как `egress-production.yaml`: ключи и Redis должны совпадать с LiveKit. Для внешнего WSS измените `ws_url` и отключите `insecure`.

Скопируйте [livekit-production.example.yaml](livekit-production.example.yaml) как `livekit-production.yaml` и замените Redis, домен и секрет. При `secrets.existingSecret` chart не может собрать конфигурацию из `values`, поэтому она хранится в Secret целиком. Сертификат TURN создаётся отдельно:

```bash
kubectl -n kontur-work create secret tls turn-company-ru-tls \
  --cert=turn.fullchain.pem --key=turn.private-key.pem
```

В production лучше создавать Secret через External Secrets Operator или Vault. Названия ключей фиксированы и показаны выше. `REDIS_URL`, ключи LiveKit и `LIVEKIT_CONFIG` находятся в Secret, чтобы пароли не попадали в ConfigMap.

Скопируйте [values-ha.example.yaml](values-ha.example.yaml) вне каталога chart, замените адреса, registry и домен. Для первой установки включите:

```yaml
admin:
  createOnInstall: true
  email: admin@company.ru
  name: Администратор
```

После создания владельца `createOnInstall` можно вернуть в `false`. Миграции идемпотентны и выполняются отдельным Helm hook перед каждой установкой и обновлением.

Заполните `livekit.publicUrl`, `signalHost`, Redis и TURN/TLS. Ingress публикует только HTTPS/WSS signal endpoint 7880. Media-трафик идёт прямо к host-network media pod: на узлах должны быть доступны 7881/TCP, 7882/UDP, 3478/UDP и 5349/TCP; `turn.tls.domain` должен вести на L4-балансировщик или адреса media-узлов. Один LiveKit pod размещается на одном узле благодаря обязательной anti-affinity.

Для голосовых комментариев включите `communications.speechToText.enabled`, задайте endpoint и храните `STT_API_KEY` в существующем Kubernetes Secret. Ingress обязан использовать TLS: PWA, MediaRecorder, камера и демонстрация экрана не работают на небезопасном origin.

Для телефонии включите `communications.telephony.enabled`. При управляемом chart Secret заполните параметры секции `communications.telephony`; при `secrets.existingSecret` положите `TELEPHONY_API_TOKEN` и `TELEPHONY_WEBHOOK_SECRET` в Secret, а URL, номер и timeout оставьте в values. Телефонный шлюз должен иметь HTTPS-доступ к `APP_URL/api/telephony/webhook`.

## Установка и обновление

```bash
helm lint deploy/helm/kontur-work -f values-production.yaml
helm upgrade --install kontur-work deploy/helm/kontur-work \
  --namespace kontur-work \
  --create-namespace \
  --values values-production.yaml \
  --atomic --wait --timeout 15m
```

Проверка:

```bash
kubectl -n kontur-work get pods,deploy,hpa,pdb,ingress
kubectl -n kontur-work rollout status deployment/kontur-work-app
kubectl -n kontur-work rollout status deployment/kontur-work-livekit
helm -n kontur-work test kontur-work --logs
curl -fsS https://projects.company.ru/api/health
```

При обновлении используйте новый неизменяемый tag образа. Если pre-upgrade миграция завершится с ошибкой, Helm не начнёт rollout приложения. Диагностика:

```bash
kubectl -n kontur-work get jobs
kubectl -n kontur-work logs job/kontur-work-migrate
helm -n kontur-work history kontur-work
```

## Что обеспечивает chart

- несколько реплик app и worker;
- rolling update без плановой потери web-реплик;
- readiness, liveness и startup probes;
- HPA для app и worker;
- LiveKit SFU в трёх и более репликах, host networking и Redis-координация;
- встроенный TURN/UDP и TURN/TLS с сертификатом из Kubernetes Secret;
- отдельные HPA и PDB для media pool, 5-часовое окно graceful drain;
- PodDisruptionBudget;
- распределение pod по узлам и, в HA-примере, по зонам;
- app и worker запускаются от непривилегированного пользователя с read-only root filesystem;
- отдельные Egress pod с Chrome sandbox и capability SYS_ADMIN;
- отдельные recording-worker с ffmpeg и временным диском для расшифровок;
- ConfigMap, Secret или подключение существующего Secret;
- Ingress/TLS и опциональный NetworkPolicy;
- автоматический rollout при изменении ConfigMap или управляемого chart Secret.

HPA media pool увеличивает число одновременно обслуживаемых комнат, но не переносит и не делит уже созданную комнату: вся большая встреча должна помещаться на одном узле. Для аудитории около 1000 используйте режим **Вебинар** с небольшим числом докладчиков; 1000 одновременно публикующих камер не поддерживаются как целевой профиль. До мероприятия выполните `lk load-test` на production URL, проверьте UDP, ICE/TCP и TURN/TLS из корпоративной и мобильной сетей, а также наблюдайте CPU, packet loss и пропускную способность узла.

Пулы MySQL, лимиты соединений и worker concurrency нужно согласовать с ёмкостью внешних сервисов.

При обновлении Secret, созданного вне chart, выполните `kubectl -n kontur-work rollout restart deployment/kontur-work-app deployment/kontur-work-worker deployment/kontur-work-recording-worker deployment/kontur-work-livekit deployment/kontur-work-egress` или используйте контроллер автоматического перезапуска Secret. Chart не может вычислить checksum содержимого внешнего Secret.

## TLS MySQL

Для managed MySQL включите `database.ssl.enabled`. Если сертификат сервера подписан частным CA, поместите PEM в `database.ssl.ca` многострочным YAML-значением. Не отключайте `rejectUnauthorized` в production.

## Резервное копирование и восстановление

Helm chart не создаёт backup-задачи для внешних сервисов. Настройте независимо:

- point-in-time recovery и проверяемые дампы MySQL;
- versioning/lifecycle и репликацию S3 bucket;
- резервирование Redis, если недопустима потеря отложенных заданий;
- экспорт production values без секретов и политику восстановления Secret.

Регулярно проверяйте восстановление в отдельном namespace. Rollback Helm не откатывает схему MySQL: миграции должны оставаться обратно совместимыми минимум на один релиз.

## Записи и ИИ

`recordings.enabled=true` добавляет Egress. Перед production закрепите `recordings.egress.image` по проверенному digest. Планируйте `recordings.egress.replicas` по числу одновременно записываемых комнат, по 4 CPU / 4 GiB на экземпляр, отдельно от media pool. Для временных файлов recording-worker предусмотрено 24 GiB при concurrency=1. Права и endpoints ИИ/STT настраиваются в интерфейсе после установки: [подробное руководство](../../../docs/AI-RECORDINGS-ACCESS.md).

Обновляйте Egress вне активных записей: его длительный graceful drain может превышать 15-минутный Helm timeout. Перед плановыми работами остановите записи и дождитесь сохранения S3. Потеря узла посреди записи не обеспечивает её бесшовного восстановления.

## Мониторинг и резервирование (0.14.0)

monitoring.enabled добавляет ServiceMonitor для существующего Prometheus Operator. Укажите tokenSecret (ключ token), labels селектора Prometheus и monitoring.namespaceSelector при включённой NetworkPolicy. Токену нужны operations:read и operations.view.

backup.enabled добавляет CronJob MySQL → AES-256-GCM → отдельный S3 bucket. Настройте backup.secretName/bucket/schedule/workSize, отдельные реквизиты резервирования и CA MySQL. Резервирование S3-файлов и проверка восстановления на отдельном стенде выполняются отдельно. Компоненты выключены по умолчанию.

Полное руководство: [OPERATIONS.md](../../../docs/OPERATIONS.md). Нагрузочные сценарии: [scripts/load](../../../scripts/load/README.md).
