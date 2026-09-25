# Выбор MySQL или PostgreSQL

Начиная с 0.22 один образ приложения поддерживает **MySQL 8.4** и
**PostgreSQL 18 с ICU**. База выбирается для всей установки переменной `DB_ENGINE`.
По умолчанию используется `mysql`; для PostgreSQL — `postgres`. Приложение,
оба worker и миграции должны подключаться к одной базе.

Переключение настройки не переносит существующие записи. PostgreSQL-профиль
предназначен для новой установки. Для переноса рабочей MySQL нужен отдельный
согласованный план с резервной копией и сверкой данных. Обе базы могут храниться
в разных томах, но приложение работает только с выбранной.

## Новая установка в Docker

Скопируйте `.env.example` в `.env` и заполните общие параметры безопасности,
хранилища и владельца по [README](../README.md). Нужен Docker Compose с поддержкой
`!reset` (v2.24.4+).

Для **MySQL** оставьте `DB_ENGINE=mysql`, задайте `MYSQL_PASSWORD` и
`MYSQL_ROOT_PASSWORD`, выполните:

```bash
docker compose up -d --build --wait
```

Для **PostgreSQL** задайте `DB_ENGINE=postgres`, `POSTGRES_PASSWORD` и отдельный
`POSTGRES_ADMIN_PASSWORD`. Затем выполните:

```bash
docker compose -f compose.yaml -f compose.postgres.yaml up -d --build --wait
docker compose -f compose.yaml -f compose.postgres.yaml ps -a
```

Используется отдельный том `postgres_data`. MySQL в этом профиле не запускается.
Порт PostgreSQL наружу не публикуется. Сервис `postgres` использует пароль
администратора только для начальной подготовки; приложение получает отдельного
пользователя без прав администратора сервера. Не задавайте `POSTGRES_USER=postgres`.
Смена паролей в `.env` не изменяет пароли уже созданных пользователей БД.

Для последующих команд `logs`, `stop`, `build`, `pull`, `up` также указывайте оба
Compose-файла. Остановка сохраняет данные:

```bash
docker compose -f compose.yaml -f compose.postgres.yaml stop
```

## Разработка на компьютере

Используйте `.env.development.example` с `DB_ENGINE=postgres`. Запуск инфраструктуры:

```bash
docker compose -p kontur-dev -f compose.yaml -f compose.postgres.yaml -f compose.dev.yaml -f compose.postgres.dev.yaml up -d postgres redis minio minio-init livekit
node --env-file=.env scripts/migrate.mjs
node --env-file=.env scripts/seed.mjs
npm run dev
```

`POSTGRES_HOST=127.0.0.1`, порт `5432`. Приложение и worker запускаются на хосте.
Для новой установки seed создаёт владельца и демонстрационный проект; повторный
seed не предназначен для сброса пароля. Рабочую базу для тестов не используйте.

## Внешняя база и Kubernetes

Настройки PostgreSQL:

| Параметр | Значение по умолчанию / назначение |
| --- | --- |
| `DB_ENGINE` | `mysql` или `postgres` |
| `POSTGRES_HOST`, `POSTGRES_PORT` | `127.0.0.1`, `5432`; Compose подставляет внутренний адрес |
| `POSTGRES_DATABASE`, `POSTGRES_USER` | `kontur_work`, `kontur` |
| `POSTGRES_PASSWORD` | Пароль приложения; не берётся из настроек MySQL |
| `POSTGRES_POOL_SIZE` | `12` подключений на процесс |
| `POSTGRES_CONNECT_TIMEOUT` | `10000` мс |
| `POSTGRES_SSL` | `false`; для внешней БД включите TLS |
| `POSTGRES_SSL_REJECT_UNAUTHORIZED` | `true`; проверка сертификата сервера |
| `POSTGRES_SSL_CA` | Сертификат центра доверия; переводы строк можно записать как `\n` |
| `POSTGRES_ADMIN_PASSWORD` | Только первоначальный запуск PostgreSQL-контейнера |

В Helm задайте `database.engine: postgres`, адрес и порт `5432`; пример —
[`values-postgres.example.yaml`](../deploy/helm/kontur-work/values-postgres.example.yaml).
При использовании внешнего Secret нужен ключ `POSTGRES_PASSWORD`. Helm саму БД
не создаёт. Пользователю миграций нужны права создания объектов в `public` и
владение объектами приложения; права суперпользователя не требуются.

PostgreSQL 18 нужен в том числе для поиска `LIKE` с сопоставлением строк без
учёта регистра и диакритики. Схема создаёт собственное ICU-сопоставление
`kontur_text`. Установка с PostgreSQL без ICU не поддерживается.

## Миграции и целостность

`npm run db:migrate` и `npm run db:status` выбирают схему по `DB_ENGINE`.
Из командной строки Node передавайте окружение через `node --env-file=.env`.

- MySQL: прежние миграции `scripts/migrations/001`–`043` сохранены без изменений.
- PostgreSQL: отдельные `scripts/migrations-postgres/001_initial.sql` и
  `002_events.sql`; 184 прикладные таблицы и два служебных журнала.
- Сохраняются уникальные ключи, внешние связи, ограничения, история этапов,
  отзыв сессий и API-токенов. Даты читаются как строки UTC, JSON — как объекты.
- Миграции PostgreSQL выполняются по одному файлу в транзакции с общей
  блокировкой. Ошибка откатывает изменения файла; код ошибки остаётся в журнале.
  Повтор разрешён с той же контрольной суммой. Выпущенные файлы менять нельзя.
- Новый SQL проверяйте на обеих БД. Общий слой поддерживает используемые
  приложением конструкции; это не универсальный преобразователь чужого SQL.
  Ключи вставок описаны в `src/lib/postgres-tables.js` и обновляются вместе со схемой.

## Резервное копирование PostgreSQL

Задайте отдельный `BACKUP_ENCRYPTION_KEY` (64 шестнадцатеричных символа).
Скрипт создаёт согласованный `pg_dump`, сжимает и шифрует его; формат копии
содержит тип БД. Пример из окружения PostgreSQL:

```bash
node --env-file=.env scripts/backup.mjs backup --compose --output backups/kontur.kbk
node --env-file=.env scripts/backup.mjs verify --input backups/kontur.kbk
```

Каталог `backups` предварительно создайте. Для прямого подключения установите
клиенты PostgreSQL 18 и уберите `--compose`. При TLS задайте
`POSTGRES_SSLMODE=verify-full` и путь `POSTGRES_SSL_ROOT_CERT` к CA-файлу.

Восстановление допускается только в отдельный сервер и пустую базу с именем
`kontur_restore_*`. Создайте стенд `deploy/compose.restore.postgres.yaml`,
задайте `RESTORE_POSTGRES_PASSWORD`, `RESTORE_POSTGRES_USER` и имя БД:

```bash
docker compose -f deploy/compose.restore.postgres.yaml up -d
node --env-file=.env scripts/backup.mjs restore --compose --isolated --input backups/kontur.kbk --database kontur_restore_drill
```

Для прямого подключения дополнительно укажите `RESTORE_POSTGRES_HOST`,
`RESTORE_POSTGRES_PORT` и при необходимости параметры TLS с префиксом `RESTORE_`.
Проверка целостности копии завершается до запуска SQL. Восстановление выполняется
в одной транзакции. Копии MySQL нельзя восстановить в PostgreSQL этим способом.
`--pitr` относится к MySQL; восстановление PostgreSQL на момент времени требует
отдельного архивирования WAL. В Helm CronJob автоматически выбирает клиент нужной БД.

## Проверки на одноразовом стенде

```bash
docker compose -f deploy/tests/browser.compose.yaml --profile files --profile postgres up -d --build --wait
```

Установите `TEST_DB_ENGINE=postgres` (в PowerShell: `$env:TEST_DB_ENGINE='postgres'`),
затем `npm run test:browser:setup`, `npm run test:integration`, `npm run test:browser`.
Для MySQL укажите `TEST_DB_ENGINE=mysql`. Стенд использует фиксированные тестовые
реквизиты и порты 13316/13318, не читает рабочие пароли. Хранилище файлов и браузер
подготовьте по [руководству разработчика](DEVELOPMENT.md).

Сверка резервной копии запускается после сценариев, без параллельной записи в БД.
CI выполняет оба варианта. Живой сервер, внешняя модель и медиаканал требуют
отдельной проверки в среде развёртывания.
