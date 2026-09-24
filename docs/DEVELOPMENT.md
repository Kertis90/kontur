# Разработка в VS Code

## Автоматическая проверка поставки 0.19.0

GitHub Actions выполняет серверные тесты, quality, сборку Node.js 22,
проверки MySQL и браузера. Локальный одноразовый стенд имеет собственное
имя `kontur-browser-check`, порты 13316/13379/13900/13300 и временные данные.
Он не использует рабочие реквизиты из `.env`.

```bash
docker compose -f deploy/tests/browser.compose.yaml --profile files up -d --wait
npm run test:browser:setup
npm run test:jira:mysql
npm run test:backup:mysql
npm run build
npx playwright install chromium
npm run test:browser
```

По умолчанию браузерный тест запускает сервер разработки. Для проверки готовой
сборки задайте `BROWSER_PRODUCTION=1` (PowerShell: `$env:BROWSER_PRODUCTION='1'`).
Отчёт и снимки находятся в `playwright-report` и `test-results`, они исключены
из Git. Проверка Jira подменяет только ответы внешнего сервера; MySQL, S3,
создание задач, конфликты, аудит и фоновые проходы выполняются реально.
Проверка копии сверяет строки, контрольные суммы таблиц и определения триггеров.

После завершения удалите только этот одноразовый стенд:

```bash
docker compose -f deploy/tests/browser.compose.yaml --profile files down
```

Никогда не подставляйте рабочие реквизиты в эти тестовые скрипты. Контейнеры
используют временные файловые системы; их остановка удаляет тестовые данные.

## Основная среда разработки

Команды выполняются в терминале **из корня репозитория**, где находятся
`package.json` и `compose.yaml`. Нужны Node.js 22.13+, npm, Git и Docker Compose v2.
`npm ci` использует комплектный `package-lock.json`; не начинайте перенос
с обновления всех зависимостей. Node 22 указан в `.nvmrc` и `.node-version`.

## Локальный сервер и инфраструктура в Docker

Этот профиль запускает Next.js и worker на компьютере разработчика,
а MySQL, Redis, MinIO и LiveKit — в Docker с отдельными томами `kontur-dev`.
Для записи встреч используйте полный Compose-профиль ниже.

1. Установите зависимости и создайте локальное окружение.

```bash
npm ci
```

Linux/macOS/WSL:

```bash
cp .env.development.example .env
```

PowerShell:

```powershell
Copy-Item .env.development.example .env
```

Если `.env` уже существует, сохраните его и перенесите нужные значения вручную.
Не копируйте тестовые настройки поверх конфигурации действующей установки.
Профиль использует `.env`; уберите конфликтующие значения из локальных
`.env.local`/`.env.development.local` и окружения терминала: Next.js умеет читать
их, а команды Node ниже явно читают только `.env`.

2. В `.env` замените все `replace-…`: пароли MySQL, MinIO, администратора,
   `AUTH_SECRET`, `APP_ENCRYPTION_KEY`, `LIVEKIT_API_SECRET`. Укажите свой
   `ADMIN_EMAIL`. Генератор случайной hex-строки (работает и в PowerShell):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Запускайте команду отдельно для каждого секрета. `APP_ENCRYPTION_KEY` должен
содержать 64 hex-символа. Сохраните значения приватно: они не включаются в Git.

3. Поднимите только инфраструктуру:

```bash
docker compose -p kontur-dev -f compose.yaml -f compose.dev.yaml up -d mysql redis minio minio-init livekit
docker compose -p kontur-dev -f compose.yaml -f compose.dev.yaml ps -a
```

Дождитесь `healthy` у MySQL/Redis/MinIO и `Exited (0)` у `minio-init`.
В dev-профиле порты БД и хранилища опубликованы только на `127.0.0.1`:
MySQL `3306`, Redis `6379`, S3 `9000`; консоль MinIO — `9001`.
Не запускайте `app`, `worker`, `migrate` или `egress` этой командой без списка
сервисов: профиль рассчитан на приложение **на хосте**, а не в Docker-сети.
При конфликте портов остановите конфликтующий локальный сервис или согласованно
поменяйте порты override и `.env`.

4. Примените миграции, затем создайте первоначальную учётную запись:

```bash
node --env-file=.env scripts/migrate.mjs --status
node --env-file=.env scripts/migrate.mjs
node --env-file=.env scripts/seed.mjs
```

Остановитесь при ошибке любой команды. Скрипты Node сами `.env` не загружают,
поэтому здесь необходим `--env-file`. `npm run db:migrate`/`db:seed` без этого
флага подходят, когда переменные уже переданы процессу извне (например, Docker).
Seed создаёт demo-проект NOVA и владельца. Для существующего email он
восстанавливает роль/статус, но **не меняет старый пароль**.

5. В двух терминалах запустите сервер и worker:

```bash
npm run dev -- --hostname 127.0.0.1
```

```bash
node --env-file=.env scripts/worker.mjs
```

Откройте [http://localhost:3000](http://localhost:3000) и войдите с данными
`ADMIN_EMAIL` / `ADMIN_PASSWORD` свежей установки. Next.js сам читает `.env`.
Для проверки LiveKit на Linux сервер должен быть доступен контейнеру: запустите
dev без `--hostname 127.0.0.1` (или с `--hostname 0.0.0.0`) и разрешите локальной
Docker-сети webhook-порт 3000. LiveKit отправляет webhook через
`host.docker.internal`, заданный в dev override. Не открывайте dev-сервер в Интернет.

Остановка: `Ctrl+C` в терминалах, затем:

```bash
docker compose -p kontur-dev -f compose.yaml -f compose.dev.yaml stop
```

Тома и история сохраняются. Не используйте `down -v` для остановки своей БД.

## Задачи и отладка VS Code

В **Terminal → Run Task** доступны:

- установка зависимостей, запуск/остановка dev-инфраструктуры;
- просмотр статуса БД, применение миграций, seed (только по явному запуску);
- dev-сервер, worker, все тесты, quality и production build.

Все задачи используют `${workspaceFolder}`. Задачи Node для БД/worker
подхватывают `.env`; Next.js делает это сам. Никакая задача не запускает
миграции автоматически при открытии папки.

В **Run and Debug** есть `Контур: Next.js` и `Контур: worker`, а также совместный
запуск. Сначала выполните инфраструктуру и миграции. Не запускайте одновременно
один и тот же сервер через задачу и отладчик. Breakpoints сервера и worker
поддерживаются встроенным JavaScript debugger; frontend смотрите в DevTools.

## Проверки

```bash
npm test
npm run quality
npm run build
git diff --check
```

Отдельные сценарии:

```bash
node --experimental-vm-modules --test scripts/chat-rooms.test.mjs
node --experimental-vm-modules --test scripts/agent-workbench.test.mjs
node --experimental-vm-modules --test scripts/agent-graph.test.mjs scripts/plans.test.mjs
```

Для проверки интерфейса и планирования на отдельной MySQL:

```bash
docker compose -f deploy/tests/browser.compose.yaml up -d --wait
npm run test:browser:setup
npm run test:plans:mysql
npm run test:jira:mysql
npm run test:backup:mysql
npm run build
npx playwright install chromium
npm run test:browser
docker compose -f deploy/tests/browser.compose.yaml down
```

Стенд использует только явно заданные тестовые реквизиты и одноразовые данные.
Подготовка добавляет выключенный профиль ИИ с адресом `.invalid` для проверки
сохранения схемы: внешняя модель не вызывается. Браузер проверяет компьютер
и телефон: конструктор, сохранение ветвей, чат, план → доска → рабочий эпик,
обычные задачи, комнаты и права Jira. MySQL-проверка дополнительно проверяет
доступ к черновикам, цели, версии, параллельное начало работы, архив и восстановление.

Модульные/поведенческие тесты не требуют живой БД. Для проверки реального
MySQL используйте **изолированные** профили с одноразовыми tmpfs-данными:

```bash
docker compose -f deploy/tests/expansion.compose.yaml up --build --abort-on-container-exit --exit-code-from expansion-test
docker compose -f deploy/tests/mysql-recovery.compose.yaml up --build --abort-on-container-exit --exit-code-from recovery-test
```

Первый применяет весь имеющийся набор миграций и проверяет bootstrap, второй
проверяет восстановление миграции с триггерами. После проверки:

```bash
docker compose -f deploy/tests/expansion.compose.yaml down
docker compose -f deploy/tests/mysql-recovery.compose.yaml down
```

Далее нужен ручной smoke-test списка из `HANDOFF.md`. `npm run build` не
проверяет доступность MySQL, внешнего ИИ или работоспособность медиасервера.
Полифилл `scripts/sandbox-memory-polyfill.cjs` относится только к ограниченной
среде ChatGPT Work и не нужен на обычном компьютере или в Docker.

## Полный Compose: конференции, запись и фоновые процессы

Для полной проверки используйте **отдельную папку/копию** с `.env`, созданным
из `.env.example` (внутренние имена `mysql`, `redis`, `minio`). Остановите dev-
инфраструктуру, чтобы освободить порты LiveKit/MinIO. Настройте секреты и выполните:

```bash
docker compose -p kontur-full up -d --build
docker compose -p kontur-full ps -a
docker compose -p kontur-full logs --tail=100 migrate app worker recording-worker
```

Полный профиль включает мигратор, app, worker, recording-worker и Egress;
Dockerfile содержит FFmpeg. У него отдельные тома `kontur-full`. Для нового
профиля генерируйте свои секреты; для продолжения прежнего стенда используйте
его прежнее имя Compose project, тома и секреты, иначе получите другую БД.

| Возможность | Что дополнительно настроить |
| --- | --- |
| ИИ, оценки и агенты | Подключение endpoint/модели в администрировании, права и бюджет, worker |
| Расшифровка голоса/записей | `STT_API_URL`, модель и при необходимости ключ, recording-worker для записей |
| Запись MP4 | `RECORDING_ENABLED=true`, LiveKit Egress, приватный S3 |
| Браузерный push | `npm run push:keys`, VAPID-значения в `.env`, `WEB_PUSH_ENABLED=true`, worker, разрешение браузера |
| LDAP/OIDC/SMTP | Корпоративные настройки в администрировании, доступность серверов |
| Телефония | Совместимый шлюз и `TELEPHONY_*`; контракт в `API.md` |

Секреты подключений, заведённых в UI, хранятся в БД зашифрованными; сохраняйте
`APP_ENCRYPTION_KEY` вместе с резервными копиями конфигурации. Камера/микрофон,
экран и PWA требуют secure context: localhost или HTTPS. Проверка с телефона
по обычному HTTP на IP компьютера не равна проверке HTTPS-поставки.

Kubernetes, TLS, media-порты, лимиты и нагрузка: `deploy/helm/kontur-work/README.md`,
`deploy/standalone/README.md`, `deploy/LARGE_MEETINGS.md`. Весь этот проект
использует Node.js и TCP MySQL; статический хостинг не заменяет серверную поставку.
