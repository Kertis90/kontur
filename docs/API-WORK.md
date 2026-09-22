# API рабочих инструментов — 0.14.0

Все пути дополняют [основной справочник](API.md). Персональный токен действует только в пределах своих scopes, политики пользователя и функциональных прав. Методы с пометкой «сессия браузера» токены не принимают. ID и даты замените данными своей установки.

## Тестирование

### Кейсы, планы и прогоны

`GET /api/work/quality`

Авторизация: scope `quality:read`. Права: `qa.view или qa.manage или qa.execute`.

До 1000 кейсов, 200 планов и 200 прогонов проекта.

- `project_id` (обязательно); пример: `1`

### Тест-кейс

`GET /api/work/quality/cases/{id}`

Авторизация: scope `quality:read`. Права: `qa.view или qa.manage или qa.execute`.

Карточка с актуальной revision.

### Создать: Тест-кейс

`POST /api/work/quality/cases`

Авторизация: scope `quality:write`. Права: `qa.manage`.

Связанные задачи, кейсы и релиз должны принадлежать проекту.

```json
{
  "project_id": 1,
  "title": "Вход сотрудника",
  "preconditions": "Есть активная учётная запись",
  "steps": [
    {
      "action": "Войти с верным паролем",
      "expected": "Открыта главная страница"
    }
  ],
  "priority": "high",
  "automation_key": "AuthTest.login",
  "task_ids": [
    42
  ],
  "archived": false
}
```

### Сохранить: Тест-кейс

`PUT /api/work/quality/cases/{id}`

Авторизация: scope `quality:write`. Права: `qa.manage`.

Полное представление и revision. 409 при изменении версии. Кейсы архивируются через archived.

```json
{
  "project_id": 1,
  "title": "Вход сотрудника",
  "preconditions": "Есть активная учётная запись",
  "steps": [
    {
      "action": "Войти с верным паролем",
      "expected": "Открыта главная страница"
    }
  ],
  "priority": "high",
  "automation_key": "AuthTest.login",
  "task_ids": [
    42
  ],
  "archived": false,
  "revision": 1
}
```

### План тестирования

`GET /api/work/quality/plans/{id}`

Авторизация: scope `quality:read`. Права: `qa.view или qa.manage или qa.execute`.

Карточка с актуальной revision.

### Создать: План тестирования

`POST /api/work/quality/plans`

Авторизация: scope `quality:write`. Права: `qa.manage`.

Связанные задачи, кейсы и релиз должны принадлежать проекту.

```json
{
  "project_id": 1,
  "title": "Регрессия релиза",
  "release_id": 1,
  "case_ids": [
    1,
    2
  ]
}
```

### Сохранить: План тестирования

`PUT /api/work/quality/plans/{id}`

Авторизация: scope `quality:write`. Права: `qa.manage`.

Полное представление и revision. 409 при изменении версии. Кейсы архивируются через archived.

```json
{
  "project_id": 1,
  "title": "Регрессия релиза",
  "release_id": 1,
  "case_ids": [
    1,
    2
  ],
  "revision": 1
}
```

### Начать прогон

`POST /api/work/quality/runs`

Авторизация: scope `quality:write`. Права: `qa.execute`.

Сохраняет снимки кейсов и релиза плана; дальнейшие правки не меняют историю.

```json
{
  "plan_id": 1,
  "title": "Регрессия сборки 2026.09"
}
```

### Прогон и история проверок

`GET /api/work/quality/runs/{runId}`

Авторизация: scope `quality:read`. Права: `qa.view или qa.manage или qa.execute`.

Снимки шагов, текущие результаты и последние 500 изменений.

### Результаты ручных и автоматических тестов

`POST /api/work/quality/runs/{runId}/results`

Авторизация: scope `quality:write`. Права: `qa.execute`.

Атомарный пакет до 500 результатов. request_id UUID повторяется с тем же телом, включая revision; иное тело с тем же UUID — 409. Записываемые результаты: passed, failed, blocked, skipped; untested — исходное состояние.

```json
{
  "request_id": "ae70668b-5135-49f5-b6bf-537311583c6b",
  "results": [
    {
      "case_id": 1,
      "revision": 1,
      "result": "passed",
      "notes": "Проверено",
      "defect_task_id": null
    }
  ]
}
```

### Создать дефект из проверки

`POST /api/work/quality/runs/{runId}/defect`

Авторизация: scope `quality:write + tasks:write`. Права: `qa.execute + task.create`.

Создаёт задачу и связывает её с кейсом. Повтор возвращает существующий дефект.

```json
{
  "case_id": 1,
  "revision": 1,
  "description": "После входа появляется пустая страница"
}
```

### Завершить прогон

`POST /api/work/quality/runs/{runId}/complete`

Авторизация: scope `quality:write`. Права: `qa.execute`.

Требует результата у каждого кейса. Завершённый прогон нельзя менять.

```json
{}
```

## Цели и OKR

### Цели проекта

`GET /api/work/objectives`

Авторизация: scope `objectives:read`. Права: `okr.view или okr.manage или okr.update`.

Взвешенный прогресс, ключевые результаты и связанные задачи.

- `project_id` (обязательно); пример: `1`

### Создать цель

`POST /api/work/objectives`

Авторизация: scope `objectives:write`. Права: `okr.manage`.

Владелец должен иметь доступ к проекту.

```json
{
  "project_id": 1,
  "title": "Ускорить выпуск продукта",
  "description": "Сократить время подготовки",
  "owner_id": 2,
  "due_date": "2026-12-31",
  "archived": false
}
```

### Изменить или архивировать цель

`PUT /api/work/objectives/{objectiveId}`

Авторизация: scope `objectives:write`. Права: `okr.manage`.

Полная карточка и актуальная revision.

```json
{
  "project_id": 1,
  "title": "Ускорить выпуск продукта",
  "description": "Сократить время подготовки",
  "owner_id": 2,
  "due_date": "2026-12-31",
  "archived": false,
  "revision": 1
}
```

### Добавить ключевой результат

`POST /api/work/objectives/{objectiveId}/results`

Авторизация: scope `objectives:write`. Права: `okr.manage`.

До 50 результатов цели. mode=tasks вычисляет процент завершённых связанных задач этого проекта; manual — числовой показатель.

```json
{
  "title": "Срок подготовки, дни",
  "mode": "manual",
  "unit": "дней",
  "start_value": 14,
  "target_value": 7,
  "weight": 1,
  "task_ids": []
}
```

### Настроить ключевой результат

`PUT /api/work/objectives/{objectiveId}/results/{resultId}`

Авторизация: scope `objectives:write`. Права: `okr.manage`.

Режим после создания неизменяем. Веса, цель и связи можно менять.

```json
{
  "revision": 1,
  "data": {
    "title": "Срок подготовки, дни",
    "mode": "manual",
    "unit": "дней",
    "start_value": 14,
    "target_value": 7,
    "weight": 1,
    "task_ids": []
  }
}
```

### История обновлений результата

`GET /api/work/objectives/{objectiveId}/results/{resultId}/checkins`

Авторизация: scope `objectives:read`. Права: `okr.view или okr.manage или okr.update`.

Последние 200 обновлений.

### Обновить числовой результат

`POST /api/work/objectives/{objectiveId}/results/{resultId}/checkins`

Авторизация: scope `objectives:write`. Права: `okr.update`.

Только manual. Пояснение обязательно. confidence: on_track, at_risk, off_track.

```json
{
  "revision": 1,
  "value": 10,
  "confidence": "on_track",
  "note": "Замер по последним релизам"
}
```

## ИИ

### Настройки поиска по смыслу

`GET /api/work/semantic/settings`

Авторизация: сессия браузера. Права: `ai.configure`.

Модель embeddings и безопасный список профилей. API-токены не принимаются.

### Настроить модель embeddings

`PUT /api/work/semantic/settings`

Авторизация: сессия браузера. Права: `ai.configure`.

HTTPS /embeddings выбранного включённого профиля ИИ. Изменение создаёт новое пространство индекса; нужен повторный запуск.

```json
{
  "revision": 0,
  "enabled": true,
  "profile_id": "fbf36e39-b1a2-4f0e-9225-da2569b188ad",
  "model": "МОДЕЛЬ_EMBEDDINGS"
}
```

### Семантический поиск

`POST /api/work/semantic/search`

Авторизация: scope `semantic:read + scopes выбранных источников`. Права: `ai.search`.

kinds: task, knowledge, recording. Дополнительно tasks:read, knowledge:read, conference:read соответственно. Приближённый LSH-отбор до 1000 фрагментов и cosine ranking до 15 материалов. Проверяет актуальные ACL и хеш текста.

```json
{
  "query": "Что решили про авторизацию?",
  "kinds": [
    "task",
    "knowledge",
    "recording"
  ]
}
```

### Мои задания индексации

`GET /api/work/semantic/jobs`

Авторизация: scope `semantic:read`. Права: `semantic.index`.

Последние 50 заданий, прогресс и безопасный код ошибки.

### Обновить индекс доступных материалов

`POST /api/work/semantic/jobs`

Авторизация: scope `semantic:write + tasks:read + knowledge:read + conference:read`. Права: `semantic.index`.

Один активный проход пространства. До 128000 символов материала. Повтор пропускает неизменённое; embeddings учитываются в бюджете ИИ.

```json
{}
```

### Продолжить или остановить индексацию

`POST /api/work/semantic/jobs/{jobId}`

Авторизация: scope `semantic:write`. Права: `semantic.index`.

action: resume/cancel. После смены настроек создайте новое задание. Права и scope проверяются фоновым обработчиком.

```json
{
  "action": "resume"
}
```

### Помощник по качеству задачи

`POST /api/work/task-ai`

Авторизация: scope `ai:write + tasks:read`. Права: `ai.project.analyze + project.browse`.

mode: acceptance, duplicates, contradictions. Сохранённая версия обязательна. Только название и описание; дополнительные атрибуты не передаются. Сравниваются до 25 задач из последних 500 изменённых внутри проекта. Проверка точных цитат и повторная проверка версий/прав; результат ничего не меняет.

```json
{
  "task_id": 42,
  "version_number": 3,
  "mode": "acceptance"
}
```

### Учёт токенов ИИ за месяц

`GET /api/work/ai-usage`

Авторизация: scope `ai:read`.

По умолчанию только собственный расход. scope=workspace требует ai.configure. Содержит людей, модели, сценарии, точный usage и число запросов с сохранённым резервом. Настройка лимитов находится в /api/admin/ai.

- `scope`; пример: `self`

### Вопрос по доступным материалам

`POST /api/work/ai-search`

Авторизация: scope `ai:write + tasks:read + knowledge:read + conference:read`. Права: `ai.search`.

ИИ помогает найти ключевые слова и формирует ответ со ссылками на доступные задачи, статьи и расшифровки. Права проверяются перед поиском и после генерации. Ответы не кэшируются; учитываются квоты ИИ.

```json
{
  "question": "Какие решения приняты по запуску NOVA?"
}
```

## Интеграции

### Личные подключения синхронизации

`GET /api/work/sync`

Авторизация: scope `sync:read`. Права: `calendar.connect или integration.manage + project.admin`.

CalDAV и GitLab. Реквизиты не возвращаются.

### Подключить календарь или GitLab

`POST /api/work/sync`

Авторизация: scope `sync:write`. Права: `calendar.connect или integration.manage + project.admin`.

Для GitLab: kind=gitlab, project_id, credentials.url/token, config.remote_project_id/open_stage_id/closed_stage_id/users (ID GitLab → ID пользователя Контура).

```json
{
  "kind": "caldav",
  "name": "Рабочий календарь",
  "project_id": null,
  "enabled": false,
  "credentials": {
    "url": "https://calendar.example.ru/calendars/me/work/",
    "username": "user",
    "password": "ПАРОЛЬ_ПРИЛОЖЕНИЯ"
  },
  "config": {
    "users": {}
  }
}
```

### Сохранить синхронизацию

`PUT /api/work/sync/{connectionId}`

Авторизация: scope `sync:write`. Права: `Права соответствующего подключения`.

Полные настройки и revision; без credentials секреты сохраняются. kind и project_id неизменяемы.

```json
{
  "kind": "caldav",
  "name": "Рабочий календарь",
  "project_id": null,
  "enabled": false,
  "config": {
    "users": {}
  },
  "revision": 1
}
```

### Удалить подключение синхронизации

`DELETE /api/work/sync/{connectionId}`

Авторизация: scope `sync:write`. Права: `Права соответствующего подключения`.

Удаляет подключения и связи, сохраняет локальные и внешние объекты.

```json
{
  "revision": 1
}
```

### Поставить обмен в очередь

`POST /api/work/sync/{connectionId}/run`

Авторизация: scope `sync:write`. Права: `Права соответствующего подключения`.

Только включённое подключение; 409, если выполняется обмен.

```json
{
  "revision": 1
}
```

### Журнал обмена

`GET /api/work/sync/{connectionId}/log`

Авторизация: scope `sync:read`. Права: `Права соответствующего подключения`.

Последние 100 операций и коды ошибок.

### Встречи для подключения к календарю

`GET /api/work/sync-meetings`

Авторизация: scope `sync:read`. Права: `calendar.connect`.

До 500 запланированных собственных или приглашённых встреч с действующими правами.

### Сопоставления и конфликты

`GET /api/work/sync/{connectionId}/bindings`

Авторизация: scope `sync:read`. Права: `Права соответствующего подключения`.

Доступные исходные объекты, обе версии конфликта и conflict_hash.

### Связать встречу или задачу

`POST /api/work/sync/{connectionId}/bindings`

Авторизация: scope `sync:write`. Права: `Права соответствующего подключения`.

entity_id: встреча для CalDAV либо задача для GitLab. external_key нужен только GitLab: IID существующего issue.

```json
{
  "entity_id": 42,
  "external_key": "17"
}
```

### Убрать сопоставление

`DELETE /api/work/sync/{connectionId}/bindings/{bindingId}`

Авторизация: scope `sync:write`. Права: `Права соответствующего подключения`.

Дождитесь завершения текущего обмена. Сам объект сохраняется.

### Разрешить конфликт версий

`POST /api/work/sync/{connectionId}/bindings/{bindingId}/resolve`

Авторизация: scope `sync:write`. Права: `Права соответствующего подключения`.

choice: local/remote. Перед выполнением повторно сверяются обе версии.

```json
{
  "revision": 2,
  "choice": "local",
  "conflict_hash": "0000000000000000000000000000000000000000000000000000000000000000"
}
```

### Состояние доставки интеграции

`GET /api/work/integrations/{connectionId}/health`

Авторизация: scope `integrations:read`. Права: `integration.logs`.

Последняя успешная/ошибочная доставка и сводка за 24 часа.

### История настроек интеграции

`GET /api/work/integrations/{connectionId}/history`

Авторизация: scope `integrations:read`. Права: `integration.logs`.

Последние 100 записей аудита без секретов.

### Каталог и подключения

`GET /api/work/integrations`

Авторизация: scope `integrations:read`. Права: `integration.view или integration.manage + project.browse`.

Только активные доступные проекты. Секретные URL и токены не возвращаются. До 200 подключений на пространство.

### Создать подключение

`POST /api/work/integrations`

Авторизация: scope `integrations:write`. Права: `integration.manage + project.admin`.

Telegram, Mattermost, Slack или подписанный webhook. Провайдер и проект впоследствии неизменяемы. credentials зашифрованы, настройки включаются явно.

```json
{
  "name": "Команда разработки",
  "provider": "telegram",
  "project_id": 1,
  "enabled": false,
  "event_types": [
    "task.created",
    "task.updated"
  ],
  "config": {
    "chat_id": "-1001234567890"
  },
  "credentials": {
    "token": "ТОКЕН_ОТ_BOTFATHER"
  }
}
```

### Сохранить настройки подключения

`PUT /api/work/integrations/{connectionId}`

Авторизация: scope `integrations:write`. Права: `integration.manage + project.admin`.

Полная конфигурация и актуальный version_number. Отсутствие credentials сохраняет секреты. Изменение отменяет очередь прежней версии. Ответ 409 при конфликте версий.

```json
{
  "version_number": 1,
  "name": "Команда разработки",
  "provider": "telegram",
  "project_id": 1,
  "enabled": true,
  "event_types": [
    "task.created",
    "comment.created"
  ],
  "config": {
    "chat_id": "-1001234567890"
  }
}
```

### Включить или приостановить

`PATCH /api/work/integrations/{connectionId}`

Авторизация: scope `integrations:write`. Права: `integration.manage + project.admin`.

Меняет enabled, увеличивает версию и отменяет ещё не отправленные сообщения. Последний редактор становится исполнителем подключения.

```json
{
  "version_number": 1,
  "enabled": false
}
```

### Удалить подключение

`DELETE /api/work/integrations/{connectionId}`

Авторизация: scope `integrations:write`. Права: `integration.manage + project.admin`.

Удаляет реквизиты и журнал доставки, отменяет очередь. Уже отправленное сообщение остаётся у получателя.

```json
{
  "version_number": 1
}
```

### Отправить тестовое сообщение

`POST /api/work/integrations/{connectionId}/test`

Авторизация: scope `integrations:send`. Права: `integration.test + (integration.view или integration.manage) + project.browse`.

Реальная отправка фиксированного текста без задач. Возвращает 202 и id доставки. Подключение должно быть включено. Не чаще одного теста за 30 секунд; version_number защищает от отправки изменившемуся получателю.

```json
{
  "version_number": 1
}
```

### Журнал доставки

`GET /api/work/integrations/{connectionId}/deliveries`

Авторизация: scope `integrations:read`. Права: `integration.logs + (integration.view или integration.manage) + project.browse`.

По 50 записей с has_more, HTTP-статусом, кодом ошибки и числом попыток. Содержимое сообщений и ответов внешнего сервиса не раскрывается.

- `status`; пример: `failed` — pending, running, delivered, failed, cancelled; необязательно
- `offset`; пример: `0` — Смещение 0–100000

### Повторить ошибочную доставку

`POST /api/work/integrations/{connectionId}/deliveries/{deliveryId}/retry`

Авторизация: scope `integrations:send`. Права: `integration.test + integration.logs + (integration.view или integration.manage) + project.admin`.

Только failed, спустя 30 секунд после ошибки и для той же версии включённого подключения. Идентификатор и содержимое события сохраняются. Счётчик попыток не сбрасывается.

```json
{}
```

## SLA

### Уведомления правила SLA

`GET /api/work/sla/notifications/{policyId}`

Авторизация: сессия браузера. Права: `sla.manage`.

Предупреждение, нарушение и адресаты эскалации.

### Настроить эскалации SLA

`PUT /api/work/sla/notifications/{policyId}`

Авторизация: сессия браузера. Права: `sla.manage`.

escalation_minutes — рабочие минуты после нарушения. Паузы и бизнес-календарь учитываются. revision=0 при первом сохранении.

```json
{
  "revision": 0,
  "enabled": true,
  "notify_assignee": true,
  "warning": true,
  "breached": true,
  "escalation_minutes": 60,
  "escalation_user_ids": [
    2
  ]
}
```

### История расчёта SLA

`GET /api/work/sla/tasks/{taskId}`

Авторизация: scope `tasks:read`. Права: `project.browse`.

Таймеры, интервалы, фазы, циклы, рабочие минуты и версии правил. История до миграции помечается приблизительной.

### GET рабочего календаря

`GET /api/work/sla/calendars`

Авторизация: сессия браузера. Права: `sla.manage`.

Требуется sla.manage. PATCH проверяет revision. DELETE запрещён, если календарь используется правилом.

### POST рабочего календаря

`POST /api/work/sla/calendars`

Авторизация: сессия браузера. Права: `sla.manage`.

Требуется sla.manage. PATCH проверяет revision. DELETE запрещён, если календарь используется правилом.

```json
{
  "name": "Рабочая неделя",
  "timezone": "Europe/Moscow",
  "weekly": {
    "1": [
      [
        540,
        780
      ],
      [
        840,
        1080
      ]
    ],
    "2": [
      [
        540,
        1080
      ]
    ],
    "3": [
      [
        540,
        1080
      ]
    ],
    "4": [
      [
        540,
        1080
      ]
    ],
    "5": [
      [
        540,
        1080
      ]
    ]
  },
  "holidays": [
    "2026-12-31"
  ]
}
```

### PATCH рабочего календаря

`PATCH /api/work/sla/calendars/{calendarId}`

Авторизация: сессия браузера. Права: `sla.manage`.

Требуется sla.manage. PATCH проверяет revision. DELETE запрещён, если календарь используется правилом.

```json
{
  "name": "Рабочая неделя",
  "timezone": "Europe/Moscow",
  "weekly": {
    "1": [
      [
        540,
        780
      ],
      [
        840,
        1080
      ]
    ],
    "2": [
      [
        540,
        1080
      ]
    ],
    "3": [
      [
        540,
        1080
      ]
    ],
    "4": [
      [
        540,
        1080
      ]
    ],
    "5": [
      [
        540,
        1080
      ]
    ]
  },
  "holidays": [
    "2026-12-31"
  ],
  "revision": 1
}
```

### DELETE рабочего календаря

`DELETE /api/work/sla/calendars/{calendarId}`

Авторизация: сессия браузера. Права: `sla.manage`.

Требуется sla.manage. PATCH проверяет revision. DELETE запрещён, если календарь используется правилом.

## Инструменты данных

### Мои сохранённые импорты Jira

`GET /api/work/jira-imports`

Авторизация: scope `imports:read`. Права: `import.manage`.

Последние 100 пакетов с действующим доступом к проекту.

### Проверить и сохранить пакет Jira

`POST /api/work/jira-imports`

Авторизация: scope `imports:write`. Права: `import.manage + task.create`.

До 2,5 МБ / 500 задач. При ошибках вернётся id:null и сопоставления этапов. При успехе сохраняется preview с хешем. Файлы загружаются отдельно; URL вложений Jira сервер не скачивает.

```json
{
  "project_id": 1,
  "text": "{\"issues\":[{\"key\":\"OLD-1\",\"fields\":{\"summary\":\"Подготовить релиз\",\"status\":{\"name\":\"To Do\"}}}]}",
  "stages": {
    "To Do": 1
  },
  "include_attachments": true
}
```

### Прогресс, вложения и отчёт сверки

`GET /api/work/jira-imports/{jobId}`

Авторизация: scope `imports:read`. Права: `import.manage + project.browse`.

Созданные и пропущенные задачи, неразрешённые связи и предупреждения.

### Загрузить файл экспорта

`PUT /api/work/jira-imports/{jobId}/files/{fileId}`

Авторизация: scope `imports:write`. Права: `import.manage + task.create + attachment.manage`.

Исходные байты application/octet-stream, до MAX_ATTACHMENT_BYTES. Размер должен совпасть с манифестом. Сервер считает SHA-256; одинаковый повтор безопасен.

Тело запроса: исходные байты файла, Content-Type: application/octet-stream. В curl используйте `--data-binary "@file.bin"`.

### Запустить, продолжить или остановить импорт

`POST /api/work/jira-imports/{jobId}`

Авторизация: scope `imports:write`. Права: `import.manage + task.create`.

action=start требует preview_hash и все выбранные файлы; resume продолжает с сохранённой позиции; cancel сохраняет прогресс. revision обязателен.

```json
{
  "action": "start",
  "revision": 1,
  "preview_hash": "0000000000000000000000000000000000000000000000000000000000000000"
}
```

### Импортированная история задачи

`GET /api/work/jira-imports/task/{taskId}`

Авторизация: scope `tasks:read`. Права: `project.browse`.

Исходные авторы и даты явно отделены от действий пользователей Контура. Пакеты по 100 записей.

- `after`; пример: `0`

### Массово изменить задачи

`POST /api/work/bulk`

Авторизация: scope `tasks:write`. Права: `task.edit; task.assign по изменению`.

До 100 задач с версиями. Одна транзакция: конфликт любой задачи отменяет весь пакет. patch: title, description, priority, assignee_id, stage_id, start_date, due_date, estimate_minutes, progress, custom_values. Проверяются права, поля и согласования каждой задачи.

```json
{
  "tasks": [
    {
      "id": 42,
      "version_number": 3
    }
  ],
  "patch": {
    "priority": "high"
  }
}
```

### Проверить импорт

`POST /api/work/imports/preview`

Авторизация: scope `tasks:write`. Права: `import.manage + task.create; task.assign по данным`.

CSV с запятой или Jira JSON issues. До 1000 строк и 2,5 МБ. mapping сопоставляет поля, stages — названия этапов и ID. Ответ preview содержит ошибки, предупреждения, повторы и preview_hash. Confirm требует этот hash и создаёт все корректные строки одной транзакцией; повторы внешних ключей пропускаются.

```json
{
  "project_id": 1,
  "source": "csv",
  "text": "Key,Summary,Status\nOLD-1,Подготовить план,В работе",
  "mapping": {
    "key": "Key",
    "title": "Summary",
    "status": "Status"
  },
  "stages": {
    "В работе": 2
  }
}
```

### Подтвердить импорт

`POST /api/work/imports/confirm`

Авторизация: scope `tasks:write`. Права: `import.manage + task.create; task.assign по данным`.

CSV с запятой или Jira JSON issues. До 1000 строк и 2,5 МБ. mapping сопоставляет поля, stages — названия этапов и ID. Ответ preview содержит ошибки, предупреждения, повторы и preview_hash. Confirm требует этот hash и создаёт все корректные строки одной транзакцией; повторы внешних ключей пропускаются.

```json
{
  "project_id": 1,
  "source": "csv",
  "text": "Key,Summary,Status\nOLD-1,Подготовить план,В работе",
  "mapping": {
    "key": "Key",
    "title": "Summary",
    "status": "Status"
  },
  "stages": {
    "В работе": 2
  },
  "preview_hash": "0000000000000000000000000000000000000000000000000000000000000000"
}
```

### Подключения GitHub и GitLab

`GET /api/work/development/{projectId}`

Авторизация: scope `projects:read`. Права: `project.browse`.

Доступные подключения без секретов.

### Подключить репозиторий

`POST /api/work/development/{projectId}`

Авторизация: scope `projects:write`. Права: `project.admin`.

Возвращает webhook_path и секрет, который показывается один раз. В репозитории включите push, pull/merge request, workflow/pipeline события.

```json
{
  "provider": "github",
  "name": "Основной код",
  "repository_url": "https://github.com/company/project"
}
```

### Включить или отключить webhook

`PATCH /api/work/development/{projectId}/{connectionId}`

Авторизация: scope `projects:write`. Права: `project.admin`.

Отключённое подключение перестаёт принимать события.

```json
{
  "enabled": false
}
```

### Разработка по задаче

`GET /api/work/development/task/{taskId}`

Авторизация: scope `projects:read`. Права: `project.browse`.

Связанные коммиты, ветки, pull/merge requests и сборки.

### Описание релиза

`GET /api/work/development/{projectId}/release-notes`

Авторизация: scope `projects:read`. Права: `project.browse`.

Подготавливает редактируемый текст по задачам выбранного релиза.

- `release_id` (обязательно); пример: `1`

## Эксплуатация

### Состояние платформы

`GET /api/work/operations`

Авторизация: scope `operations:read`. Права: `operations.view`.

Проверки MySQL/Redis/S3, присутствие обработчиков и очередь пространства. Не является тестом медиаканала или восстановления.

### Метрики Prometheus

`GET /api/work/operations/metrics`

Авторизация: scope `operations:read`. Права: `operations.view`.

Стабильные метки без персональных данных. При сборе с нескольких реплик агрегируйте max/min, не суммируйте общие очереди.

## Конференции

### Сохранённые субтитры

`GET /api/work/conference-captions/{conferenceId}`

Авторизация: scope `conference:read`.

Последние 200 фрагментов, либо следующие 200 после after (sequence_number). Последовательность назначается при завершении распознавания, поэтому поздние ответы не теряются. Начните с after=0 для всей истории.

- `after`; пример: `0`
- `join_code`

### Разрешить субтитры встречи

`PATCH /api/work/conference-captions/{conferenceId}`

Авторизация: scope `conference:write`.

Только организатор или conference.manage; дополнительно сервис включает администратор. Это не включает чужие микрофоны.

- `join_code`

```json
{
  "enabled": true
}
```

### Распознать фрагмент своего микрофона

`POST /api/work/conference-captions/{conferenceId}/chunks`

Авторизация: scope `conference:write + ai:write`. Права: `conference.caption`.

Участник с conference.caption, допущенный во встречу и к публикации аудио. client_id UUID; audio_base64 — полный самостоятельный файл до 1 МБ, 0,15–12 секунд. Текст сохраняется один раз; повтор UUID с другим содержимым — 409. Лимиты пользователя, пространства, частоты и нагрузки проверяются до отправки провайдеру.

- `join_code`

```json
{
  "client_id": "37030f88-64f6-4bfa-bd36-04a286773bf0",
  "mime_type": "audio/webm;codecs=opus",
  "audio_base64": "BASE64_ПОЛНОГО_АУДИОФАЙЛА"
}
```

### Опросы и собственный голос

`GET /api/work/conference-tools/{conferenceId}/polls`

Авторизация: scope `conference:read`.

Результаты скрыты до закрытия, если results_visible=false. Модератор видит результаты всегда.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

### Создать опрос

`POST /api/work/conference-tools/{conferenceId}/polls`

Авторизация: scope `conference:write`.

Только модератор; 2–10 различных вариантов.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

```json
{
  "question": "Какой вариант выбираем?",
  "options": [
    "Первый",
    "Второй"
  ],
  "results_visible": false
}
```

### Закрыть или открыть опрос

`PATCH /api/work/conference-tools/{conferenceId}/polls/{pollId}`

Авторизация: scope `conference:write`.

Только модератор; revision защищает от перезаписи.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

```json
{
  "closed": true,
  "revision": 1
}
```

### Проголосовать

`POST /api/work/conference-tools/{conferenceId}/polls/{pollId}/vote`

Авторизация: scope `conference:write`.

Один голос на пользователя; повтор заменяет вариант. Закрытый опрос — 409.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

```json
{
  "option_index": 0
}
```

### Очередь зала ожидания

`GET /api/work/conference-tools/{conferenceId}/lobby`

Авторизация: scope `conference:read`.

Только модератор. Возвращает waiting_room и ожидающих сотрудников.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

### Допустить участника

`PATCH /api/work/conference-tools/{conferenceId}/lobby`

Авторизация: scope `conference:write`.

Только модератор. status: admitted или denied. Повтор обработанного запроса — 409.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

```json
{
  "user_id": 2,
  "status": "admitted"
}
```

### Настроить зал ожидания

`PATCH /api/work/conference-tools/{conferenceId}/settings`

Авторизация: scope `conference:write`.

Только модератор. Влияет на выдачу следующих токенов, не отзывает уже выданные.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

```json
{
  "waiting_room": true
}
```

### Участники для комнат

`GET /api/work/conference-tools/{conferenceId}/candidates`

Авторизация: scope `conference:read`.

Только модератор; активные сотрудники из участников встречи.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

### Комнаты обсуждений

`GET /api/work/conference-tools/{conferenceId}/breakouts`

Авторизация: scope `conference:read`.

Сотрудник видит назначенные ему комнаты; модератор — все.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

### Создать комнату обсуждения

`POST /api/work/conference-tools/{conferenceId}/breakouts`

Авторизация: scope `conference:write`.

Только модератор; до 30 открытых комнат, назначаются участники этой встречи. Аудио/видео отдельные, чат и опросы общие.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

```json
{
  "name": "Обсуждение архитектуры",
  "member_ids": [
    2,
    3
  ]
}
```

### Закрыть комнату

`PATCH /api/work/conference-tools/{conferenceId}/breakouts/{roomId}`

Авторизация: scope `conference:write`.

Только модератор. media_disconnected=false означает, что отключение LiveKit не подтверждено; повторите запрос.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

```json
{
  "closed": true
}
```

### Войти в комнату

`POST /api/work/conference-tools/{conferenceId}/breakouts/{roomId}/token`

Авторизация: scope `conference:write`.

Только назначенный участник или модератор, после допуска из зала ожидания. JWT на 5 минут.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

```json
{}
```

### Журнал посещаемости

`GET /api/work/conference-tools/{conferenceId}/attendance`

Авторизация: scope `conference:read`.

Только модератор. people и sessions из подписанных webhook LiveKit; пересекающиеся интервалы объединяются. Незавершённые интервалы помечены.

- `join_code`; пример: `c08af190-c1a6-4e7d-aa2f-5f084495c015` — Для авторизованного сотрудника с входом по ссылке

## Совместные статьи

### Статьи с просроченной проверкой

`GET /api/work/knowledge/stale`

Авторизация: scope `knowledge:read`.

Только доступные пространства, без архивных статей. Черновики видны редакторам.

### Состояние общего текста

`GET /api/work/knowledge/{articleId}/collaboration`

Авторизация: scope `knowledge:read`.

enabled, epoch, update в base64, version_number. Чтение не инициализирует документ.

### Включить общий текст

`POST /api/work/knowledge/{articleId}/collaboration/initialize`

Авторизация: scope `knowledge:write`. Права: `edit пространства`.

Переводит статью из абзацного режима в одновременный текстовый. Повтор возвращает существующее состояние.

```json
{}
```

### Обмен правками и курсорами

`POST /api/work/knowledge/{articleId}/collaboration/sync`

Авторизация: scope `knowledge:write`.

Yjs update/vector в base64, epoch и client_id UUID. update необязателен: без него достаточно view, с ним нужен edit. anchor/focus — относительные позиции Yjs. Возвращает недостающий update, vector, людей и версию; смена поколения — 409.

```json
{
  "epoch": "c08af190-c1a6-4e7d-aa2f-5f084495c015",
  "client_id": "5aeaa8f2-d040-46a6-9b77-17a380b933fa",
  "vector": "AA==",
  "anchor": null,
  "focus": null
}
```

### Восстановить версию статьи

`POST /api/work/knowledge/{articleId}/restore`

Авторизация: scope `knowledge:write`. Права: `edit пространства`.

Создаёт новую версию с прежним текстом и названием, сохраняет историю, сбрасывает согласование и поколение совместного документа. Текущий version_number обязателен.

```json
{
  "version_number": 5,
  "restore_version": 2
}
```

### Состояние совместной статьи

`GET /api/work/knowledge/{articleId}`

Авторизация: scope `knowledge:read`.

Статья, блоки с ревизиями, присутствующие сотрудники, комментарии и история. Черновики требуют edit пространства.

### Сохранённая версия статьи

`GET /api/work/knowledge/{articleId}/history/{version}`

Авторизация: scope `knowledge:read`.

Название и текст выбранной версии. История накапливается после обновления до 0.10.

### Отметить присутствие

`POST /api/work/knowledge/{articleId}/presence`

Авторизация: scope `knowledge:write`. Права: `view пространства`.

Обновление присутствия, активность видна 45 секунд.

```json
{}
```

### Подготовить блоки статьи

`POST /api/work/knowledge/{articleId}/initialize`

Авторизация: scope `knowledge:write`. Права: `edit пространства`.

Один раз разбивает существующий Markdown на абзацы для совместной работы.

```json
{}
```

### Добавить блок

`POST /api/work/knowledge/{articleId}/blocks`

Авторизация: scope `knowledge:write`. Права: `edit пространства`.

Добавляет блок после after_id; null размещает в конце. Текст Markdown до 100 000 символов.

```json
{
  "body": "## Новое решение",
  "after_id": null
}
```

### Изменить блок

`PATCH /api/work/knowledge/{articleId}/blocks/{blockId}`

Авторизация: scope `knowledge:write`. Права: `edit пространства`.

revision обязательна. Разные блоки можно сохранять независимо; конфликт того же блока возвращает 409.

```json
{
  "body": "Исправленное решение",
  "revision": 1
}
```

### Удалить блок

`DELETE /api/work/knowledge/{articleId}/blocks/{blockId}`

Авторизация: scope `knowledge:write`. Права: `edit пространства`.

Удаление с проверкой текущей ревизии, история статьи сохраняется.

```json
{
  "revision": 1
}
```

### Комментарий к статье или блоку

`POST /api/work/knowledge/{articleId}/comments`

Авторизация: scope `knowledge:write`. Права: `edit пространства`.

Комментарий с цитатой; block_id необязателен.

```json
{
  "block_id": null,
  "quote_text": "Срок запуска",
  "body": "Уточните дату, пожалуйста"
}
```

### Решить замечание

`PATCH /api/work/knowledge/{articleId}/comments/{commentId}`

Авторизация: scope `knowledge:write`. Права: `edit пространства`.

resolved=false открывает замечание повторно.

```json
{
  "resolved": true
}
```

### Ответственный и проверка статьи

`PATCH /api/work/knowledge/{articleId}/review`

Авторизация: scope `knowledge:write`. Права: `edit пространства; дополнительные права по действию`.

action: configure, request, approve, reject, publish. version_number обязательна. configure задаёт steward_id и review_due_date; approve/reject доступны ответственному или администратору пространства. Изменение после проверки требует нового согласования.

```json
{
  "action": "configure",
  "version_number": 3,
  "steward_id": 2,
  "review_due_date": "2026-12-01"
}
```

## Планирование

### Предложения перераспределения

`GET /api/work/leveling`

Авторизация: scope `reports:read`. Права: `capacity.view; task.edit + task.assign для предложений`.

До 20 предложений на окно не более 32 дней. Учитывает оценки оставшейся работы, календари, отсутствия и резерв по всем проектам. Детали задач выдаются только там, где вызывающий может редактировать и назначать; получатель должен иметь доступ к проекту. Сам запрос ничего не изменяет.

- `start` (обязательно); пример: `2026-09-14`
- `end` (обязательно); пример: `2026-09-27`

## Дашборды и аналитика

### Рассчитать показатели и формулу

`POST /api/work/analytics/metrics`

Авторизация: scope `reports:read`.

Данные только доступных проектов. from/to включительно влияют на created/completed; previous содержит их значения за предыдущий равный период. Остальные показатели — текущий снимок. Деление на ноль возвращает value:null.

```json
{
  "filter": {
    "projectId": 1,
    "from": "2026-09-01",
    "to": "2026-09-30",
    "timezone": "Europe/Moscow"
  },
  "expression": "done / total * 100"
}
```

### Вероятностный прогноз проекта

`GET /api/work/analytics/forecast`

Авторизация: scope `reports:read`. Права: `report.view + project.browse`.

28–84 полных дней наблюдений и минимум 5 завершений. 2000 выборок семидневных блоков; p50/p85/p95 в днях и dates. Недостаток данных возвращает status:insufficient, выход за 730 дней — null.

- `project_id` (обязательно); пример: `1`

### Группы для общего дашборда

`GET /api/work/analytics/groups`

Авторизация: scope `profile:read`.

С dashboard.share — активные группы пространства; иначе только собственные активные группы с наследованием.

### Собственная почтовая подписка

`GET /api/work/analytics/subscriptions/{dashboardId}`

Авторизация: scope `profile:read`.

Нужен доступ к дашборду. Возвращает расписание, revision, последнюю отправку и безопасную ошибку.

### Настроить собственный отчёт

`PUT /api/work/analytics/subscriptions/{dashboardId}`

Авторизация: scope `profile:write`.

Адрес — из профиля текущего пользователя. revision защищает от перезаписи; 0 для новой подписки. Требуются worker и SMTP.

```json
{
  "enabled": true,
  "frequency": "weekly",
  "timezone": "Europe/Moscow",
  "delivery_hour": 9,
  "weekday": 1,
  "revision": 0
}
```

## Представления

### Личная таблица и закреплённые виды

`GET /api/work/views`

Авторизация: scope `profile:read`.

Настройки столбцов, фильтров и закреплённых представлений текущего пользователя; revision для записи.

### Сохранить представления

`PUT /api/work/views`

Авторизация: scope `profile:write`.

Полная замена личных настроек с обязательной revision; конфликт другого устройства — 409. До 30 закреплённых видов.

```json
{
  "revision": 0,
  "config": {
    "columns": [
      "title",
      "priority",
      "due_date"
    ],
    "filter": {
      "projectId": 1
    },
    "pinned": []
  }
}
```

### Изменить задачу с возможностью отмены

`POST /api/work/task-changes`

Авторизация: scope `tasks:write`. Права: `task.edit; task.assign для исполнителя`.

Возвращает undo_id, доступный автору 10 минут. Проверяет версии, права, согласования и допустимые значения. Дополнительные атрибуты изменяются через карточку или bulk.

```json
{
  "task_id": 42,
  "version_number": 3,
  "patch": {
    "priority": "high"
  }
}
```

### Отменить изменение задачи

`POST /api/work/undo/{actionId}`

Авторизация: scope `tasks:write`. Права: `task.edit; task.assign для исполнителя`.

Однократное восстановление изменённых полей с повторной проверкой прав. Если задачу уже изменили, возвращает 409 и не перезаписывает новые данные.

```json
{}
```

## Безопасность

### Активные сессии

`GET /api/work/security/sessions`

Авторизация: сессия браузера.

Текущие сессии. user_id другого пользователя требует auth.manage.

- `user_id`; пример: `2`

### Завершить сессию

`DELETE /api/work/security/sessions/{sessionId}`

Авторизация: сессия браузера.

Отзывает указанную сессию; чужие сессии требуют auth.manage и user_id.

- `user_id`; пример: `2`

### Завершить остальные сессии

`DELETE /api/work/security/sessions/others`

Авторизация: сессия браузера.

Для себя сохраняет текущую сессию; для другого user_id отзывает все его сессии.

- `user_id`; пример: `2`

### Состояние второго фактора

`GET /api/work/security/mfa`

Авторизация: сессия браузера.

Возвращает enabled и число оставшихся резервных кодов; секреты не выдаются.

### Просмотр прав пользователя или роли

`GET /api/work/security/access-preview`

Авторизация: сессия браузера.

Передайте user_id или role_id. Только чтение; требуется role.manage.

- `user_id`; пример: `2`

### Настройки синхронизации каталога

`GET /api/work/directory`

Авторизация: сессия браузера.

Требуется auth.manage. Секрет подключения берётся из настройки LDAP.

### Предварительная проверка LDAP

`POST /api/work/directory/preview`

Авторизация: сессия браузера.

Проверяет сохранённые настройки без изменений пользователей. Требуются auth.manage и group.manage.

### Синхронизировать LDAP

`POST /api/work/directory/sync`

Авторизация: сессия браузера.

Повторно читает каталог и применяет изменения транзакцией; проверяет процент отключений. Требуются auth.manage и group.manage.

### Получить секрет TOTP

`POST /api/work/security/mfa/setup`

Авторизация: сессия браузера.

Настройка требует недавней сессии; setup/disable/recovery для локального пользователя требуют текущий password. enable принимает code и показывает резервные коды один раз. Повтор TOTP запрещён.

```json
{
  "password": "ТЕКУЩИЙ_ПАРОЛЬ"
}
```

### Включить второй фактор

`POST /api/work/security/mfa/enable`

Авторизация: сессия браузера.

Настройка требует недавней сессии; setup/disable/recovery для локального пользователя требуют текущий password. enable принимает code и показывает резервные коды один раз. Повтор TOTP запрещён.

```json
{
  "code": "000000"
}
```

### Отключить второй фактор

`POST /api/work/security/mfa/disable`

Авторизация: сессия браузера.

Настройка требует недавней сессии; setup/disable/recovery для локального пользователя требуют текущий password. enable принимает code и показывает резервные коды один раз. Повтор TOTP запрещён.

```json
{
  "password": "ТЕКУЩИЙ_ПАРОЛЬ",
  "code": "000000"
}
```

### Заменить резервные коды

`POST /api/work/security/mfa/recovery`

Авторизация: сессия браузера.

Настройка требует недавней сессии; setup/disable/recovery для локального пользователя требуют текущий password. enable принимает code и показывает резервные коды один раз. Повтор TOTP запрещён.

```json
{
  "password": "ТЕКУЩИЙ_ПАРОЛЬ",
  "code": "000000"
}
```

### Настроить каталог

`PUT /api/work/directory`

Авторизация: сессия браузера.

Требуются auth.manage и group.manage. Источники групп ldap/oidc и external_key настраиваются в управлении группами.

```json
{
  "enabled": false,
  "config": {
    "interval_minutes": 30,
    "ldap_filter": "(objectClass=person)",
    "mail_attribute": "mail",
    "name_attribute": "displayName",
    "groups_attribute": "memberOf",
    "disabled_attribute": "userAccountControl",
    "disabled_mode": "ad_bit2",
    "disable_missing": true,
    "reactivate": true,
    "max_disable_percent": 20,
    "oidc_group_claim": "groups"
  }
}
```

## Автоматизации

### Правила автоматизации

`GET /api/work/automations`

Авторизация: scope `automation:read`. Права: `automation.manage`.

Правила рабочего пространства. Выполнение использует актуальные права последнего редактора.

### Создать правило

`POST /api/work/automations`

Авторизация: scope `automation:write`. Права: `automation.manage`.

Условия all/any; операторы equals, not_equals, contains, in, is_empty, within_days, greater_than, less_than. Действия branch, notify_assignee, notify_user, set_field, create_subtask. До 100 блоков и 5 уровней. Интервал 5–525600 минут. Изменение записывает вызывающего пользователя исполнителем правила.

```json
{
  "name": "Напомнить о сроке",
  "project_id": 1,
  "enabled": true,
  "trigger_type": "scheduled",
  "trigger_config": {
    "interval_minutes": 1440
  },
  "conditions": {
    "mode": "all",
    "conditions": [
      {
        "field": "due_date",
        "operator": "within_days",
        "value": 2
      }
    ]
  },
  "actions": [
    {
      "type": "branch",
      "condition": {
        "mode": "all",
        "conditions": [
          {
            "field": "priority",
            "operator": "equals",
            "value": "critical"
          }
        ]
      },
      "then": [
        {
          "type": "notify_assignee",
          "title": "Проверьте критическую задачу"
        }
      ],
      "else": [
        {
          "type": "notify_assignee",
          "title": "Приближается срок задачи"
        }
      ]
    }
  ]
}
```

### Изменить правило

`PATCH /api/work/automations/{ruleId}`

Авторизация: scope `automation:write`. Права: `automation.manage`.

Условия all/any; операторы equals, not_equals, contains, in, is_empty, within_days, greater_than, less_than. Действия branch, notify_assignee, notify_user, set_field, create_subtask. До 100 блоков и 5 уровней. Интервал 5–525600 минут. Изменение записывает вызывающего пользователя исполнителем правила.

```json
{
  "name": "Напомнить о сроке",
  "project_id": 1,
  "enabled": true,
  "trigger_type": "scheduled",
  "trigger_config": {
    "interval_minutes": 1440
  },
  "conditions": {
    "mode": "all",
    "conditions": [
      {
        "field": "due_date",
        "operator": "within_days",
        "value": 2
      }
    ]
  },
  "actions": [
    {
      "type": "branch",
      "condition": {
        "mode": "all",
        "conditions": [
          {
            "field": "priority",
            "operator": "equals",
            "value": "critical"
          }
        ]
      },
      "then": [
        {
          "type": "notify_assignee",
          "title": "Проверьте критическую задачу"
        }
      ],
      "else": [
        {
          "type": "notify_assignee",
          "title": "Приближается срок задачи"
        }
      ]
    }
  ]
}
```

### Удалить правило

`DELETE /api/work/automations/{ruleId}`

Авторизация: scope `automation:write`. Права: `automation.manage`.

Удаляет правило и связанные журналы согласно внешним ключам.

### Пробный запуск без изменений

`POST /api/work/automations/preview`

Авторизация: scope `automation:write`. Права: `automation.manage + project.browse`.

Возвращает matched, steps и dry_run. Ветвление вычисляется по доступным полям выбранной задачи, действия не выполняются.

```json
{
  "rule": {
    "name": "Напомнить о сроке",
    "project_id": 1,
    "enabled": true,
    "trigger_type": "scheduled",
    "trigger_config": {
      "interval_minutes": 1440
    },
    "conditions": {
      "mode": "all",
      "conditions": [
        {
          "field": "due_date",
          "operator": "within_days",
          "value": 2
        }
      ]
    },
    "actions": [
      {
        "type": "branch",
        "condition": {
          "mode": "all",
          "conditions": [
            {
              "field": "priority",
              "operator": "equals",
              "value": "critical"
            }
          ]
        },
        "then": [
          {
            "type": "notify_assignee",
            "title": "Проверьте критическую задачу"
          }
        ],
        "else": [
          {
            "type": "notify_assignee",
            "title": "Приближается срок задачи"
          }
        ]
      }
    ]
  },
  "task_id": 42
}
```

### Журнал выполнения

`GET /api/work/automations/{ruleId}/runs`

Авторизация: scope `automation:read`. Права: `automation.manage`.

Последние 100 запусков: состояние, время, шаги и безопасный текст ошибки.

## Согласования

### Список согласований

`GET /api/work/approvals`

Авторизация: scope `tasks:read`.

До 500 запросов доступных проектов, включая порядок этапов, заместителей и решения.

### Отправить на согласование

`POST /api/work/approvals`

Авторизация: scope `tasks:write`. Права: `approval.request`.

mode: sequential или parallel; 1–30 согласующих, необязательные заместители и срок. Инициатор не может согласовывать сам. Для задачи сохраняется её точная версия.

```json
{
  "project_id": 1,
  "task_id": 42,
  "title": "Согласовать запуск",
  "mode": "sequential",
  "due_at": "2026-12-20T15:00:00Z",
  "reason": "Проверка перед выпуском",
  "steps": [
    {
      "reviewer_id": 2,
      "substitute_id": 3
    },
    {
      "reviewer_id": 4
    }
  ]
}
```

### Принять решение

`POST /api/work/approvals/{approvalId}/decision`

Авторизация: scope `tasks:write`. Права: `approval.decide + назначение согласующим`.

Только назначенный согласующий или заместитель и только на доступном этапе. Комментарий обязателен. Отклонение завершает весь запрос.

```json
{
  "step_id": 1,
  "decision": "approved",
  "comment": "Проверено, замечаний нет"
}
```

### Отменить согласование

`POST /api/work/approvals/{approvalId}/cancel`

Авторизация: scope `tasks:write`.

Инициатор или пользователь с approval.manage может отменить незавершённый запрос.

```json
{}
```

### Ограничения переходов

`GET /api/work/approval-gates/{projectId}`

Авторизация: scope `projects:read`. Права: `project.browse`.

Этапы, требующие согласования, и обязательные поля.

### Настроить ограничения переходов

`PUT /api/work/approval-gates/{projectId}`

Авторизация: scope `projects:write`. Права: `approval.manage`.

Полностью заменяет список. Пустой массив снимает ограничения. Переход требует согласования текущей версии задачи. Поля: title, description, assignee_id, due_date, estimate_minutes, custom.<код>.

```json
[
  {
    "stage_id": 3,
    "required_fields": [
      "assignee_id",
      "due_date"
    ]
  }
]
```

## Загрузка команд

### Календарь загрузки

`GET /api/work/capacity`

Авторизация: scope `projects:read`. Права: `capacity.view`.

Доступные часы, план и перегрузка по дням. Занятость в закрытых проектах учитывается без раскрытия их названий. Период до 367 дней.

- `start`; пример: `2026-09-07`
- `end`; пример: `2026-09-20`

### Рабочая неделя сотрудника

`PUT /api/work/capacity/calendar`

Авторизация: scope `projects:write`. Права: `capacity.manage`.

Семь значений часов от воскресенья до субботы, каждое 0–24. Часовой пояс IANA.

```json
{
  "user_id": 2,
  "hours": [
    0,
    8,
    8,
    8,
    8,
    8,
    0
  ],
  "timezone": "Europe/Moscow"
}
```

### Отсутствие или общий выходной

`POST /api/work/capacity/absence`

Авторизация: scope `projects:write`. Права: `capacity.manage`.

user_id=null создаёт общий выходной; unavailable_percent уменьшает доступность на 1–100%. Пересекающиеся отсутствия учитываются по максимальному проценту.

```json
{
  "user_id": 2,
  "start_date": "2026-09-21",
  "end_date": "2026-09-25",
  "unavailable_percent": 100,
  "label": "Отпуск"
}
```

### Плановая занятость в проекте

`POST /api/work/capacity/allocation`

Авторизация: scope `projects:write`. Права: `capacity.manage + project.edit`.

Часы на рабочий день с учётом обычной недели. Отпуск уменьшает доступность, но не снимает запланированную нагрузку.

```json
{
  "user_id": 2,
  "project_id": 1,
  "start_date": "2026-09-07",
  "end_date": "2026-09-30",
  "hours_per_day": 4
}
```

### Удалить отсутствие

`DELETE /api/work/capacity/absence/{entryId}`

Авторизация: scope `projects:write`. Права: `capacity.manage`.

Удаляет выбранную запись в текущем рабочем пространстве.

### Удалить занятость

`DELETE /api/work/capacity/allocation/{entryId}`

Авторизация: scope `projects:write`. Права: `capacity.manage`.

Удаляет выбранную запись в текущем рабочем пространстве.

## Портфель

### Портфель и базовые планы

`GET /api/work/portfolio`

Авторизация: scope `projects:read`. Права: `report.view в проектах`.

Доступные проекты, задачи, блокирующие связи, расчёт критического пути и последние 20 базовых планов.

### Сценарий сдвига сроков

`POST /api/work/portfolio/scenario`

Авторизация: scope `projects:write`. Права: `report.view в проектах`.

shifts задаёт сдвиг каждого проекта в календарных днях, от −365 до 365. Расчёт не меняет задачи. Используются блокирующие зависимости finish-to-start.

```json
{
  "shifts": {
    "1": 7,
    "2": 0
  }
}
```

### Сохранить базовый план

`POST /api/work/portfolio/baseline`

Авторизация: scope `projects:write`. Права: `portfolio.manage + report.view`.

Фиксирует текущие сроки видимых задач для последующего сравнения.

```json
{
  "name": "План до изменения объёма"
}
```

### Создать межпроектную зависимость

`POST /api/work/portfolio/dependencies`

Авторизация: scope `projects:write + tasks:write`. Права: `task.edit в целевом проекте`.

task_id зависит от depends_on_task_id. Оба проекта должны быть доступны. Проверяются версия задачи и отсутствие циклов. Изменение попадает в историю.

```json
{
  "task_id": 42,
  "depends_on_task_id": 17,
  "version_number": 3
}
```

### Удалить зависимость

`DELETE /api/work/portfolio/dependencies`

Авторизация: scope `projects:write + tasks:write`. Права: `task.edit в целевом проекте`.

task_id зависит от depends_on_task_id. Оба проекта должны быть доступны. Проверяются версия задачи и отсутствие циклов. Изменение попадает в историю.

```json
{
  "task_id": 42,
  "depends_on_task_id": 17,
  "version_number": 3
}
```

## Доступы

### Права на пользовательские поля

`GET /api/work/field-access/{projectId}`

Авторизация: scope `projects:read`.

Вычисленные can_read/can_edit. Менеджеру доступа также доступны списки читателей и редакторов.

### Настроить доступ к полям

`PUT /api/work/field-access/{projectId}`

Авторизация: scope `projects:write`. Права: `project.access.manage`.

Полная замена ограничений. Пользователи задаются user:<id>, группы — group:<id>, учитывается вложенность. Пустые списки закрывают поле для обычных участников. Администраторы и менеджеры доступа сохраняют доступ.

```json
[
  {
    "field_code": "budget",
    "readers": [
      "group:3"
    ],
    "editors": [
      "user:2"
    ]
  }
]
```

### Пользователи и группы для назначения

`GET /api/work/access-directory/{projectId}`

Авторизация: scope `projects:read`. Права: `project.access.manage`.

Минимальный справочник имён и идентификаторов без секретов и профилей.

### Почему доступ разрешён

`GET /api/work/access-explain/{projectId}`

Авторизация: scope `projects:read`.

Прямые назначения, группы, функциональные роли, временные разрешения и итоговые права. По умолчанию собственные права.

- `user_id`; пример: `2` — Для другого пользователя требуется project.access.manage

### Запросы временного доступа

`GET /api/work/access-requests`

Авторизация: scope `projects:read`.

Собственные запросы и запросы проектов, которыми пользователь вправе управлять.

### Запросить временный доступ

`POST /api/work/access-requests`

Авторизация: scope `projects:write`.

Укажите project_key или project_id. Роль viewer/member, срок не более 90 дней. Запрос не выдаёт права до одобрения.

```json
{
  "project_key": "NOVA",
  "project_role": "viewer",
  "reason": "Нужно проверить план интеграции",
  "expires_at": "2026-10-01T18:00:00Z"
}
```

### Решить или отозвать запрос

`PATCH /api/work/access-requests/{requestId}`

Авторизация: scope `projects:write`. Права: `project.access.manage`.

status: approved, rejected, revoked. Нельзя одобрять себе или выдавать отсутствующие права. Явные запреты ролей сохраняют приоритет.

```json
{
  "status": "approved",
  "reason": "Доступ нужен на время проверки"
}
```

## Поручения встреч

### Встречи с доступными записями

`GET /api/work/meetings`

Авторизация: scope `conference:read`. Права: `conference.recording.view`.

Список для работы с записями и поручениями. Исключает удалённые и просроченные записи.

### Черновики поручений и задания ИИ

`GET /api/work/meeting-actions/{conferenceId}`

Авторизация: scope `ai:read`. Права: `conference.recording.view`.

Предложения, проверенные поручения и состояние фоновой генерации.

### Выделить поручения из записи

`POST /api/work/meeting-actions/{conferenceId}/generate`

Авторизация: scope `ai:write`. Права: `ai.conference.summarize + conference.recording.view`.

202: запускает фоновую обработку завершённой расшифровки. Предложения содержат точную цитату и начало фрагмента. Задачи автоматически не создаются.

```json
{
  "recording_id": 12
}
```

### Проверить поручение

`PATCH /api/work/meeting-actions/{conferenceId}/{actionId}`

Авторизация: scope `ai:write + tasks:write`. Права: `ai.conference.summarize + task.create; task.assign при назначении`.

status: accepted создаёт задачу один раз, dismissed отклоняет предложение. Перед принятием можно изменить название, описание, исполнителя и срок.

```json
{
  "status": "accepted",
  "title": "Подготовить план запуска",
  "assignee_id": 2,
  "due_date": "2026-09-30"
}
```

### Черновик протокола в базе знаний

`POST /api/work/meeting-actions/{conferenceId}/publish`

Авторизация: scope `ai:write + knowledge:write`. Права: `ai.conference.summarize + edit пространства`.

Создаёт статью-черновик с принятыми поручениями в выбранном пространстве. Повторный вызов создаёт отдельную статью.

```json
{
  "space_id": 1,
  "title": "Поручения по итогам встречи"
}
```

## Записи встреч

### Главы, текст и история исправлений

`GET /api/work/recordings/{conferenceId}/{recordingId}`

Авторизация: scope `conference:read`. Права: `conference.recording.view`.

Фрагменты с etag для защиты от перезаписи и последние 100 записей журнала.

### Сохранить главы

`PUT /api/work/recordings/{conferenceId}/{recordingId}/chapters`

Авторизация: scope `conference:write`. Права: `conference.recording.view + conference.manage`.

Полная замена, до 500 глав; время начала должно быть внутри записи.

```json
[
  {
    "start_seconds": 0,
    "title": "Вступление"
  },
  {
    "start_seconds": 120,
    "title": "План запуска"
  }
]
```

### Исправить расшифровку

`PATCH /api/work/recordings/{conferenceId}/{recordingId}/transcript`

Авторизация: scope `conference:write`. Права: `conference.recording.view + conference.manage`.

etag берётся из GET. Сохраняет автора, старый и новый текст. Меняет ревизию источника для последующих запросов ИИ. Старые сводки автоматически не переписываются.

```json
{
  "chunk_index": 0,
  "etag": "0000000000000000000000000000000000000000000000000000000000000000",
  "text": "Исправленный текст фрагмента"
}
```

### Установить срок хранения

`PATCH /api/work/recordings/{conferenceId}/{recordingId}/retention`

Авторизация: scope `conference:write`. Права: `conference.recording.view + conference.manage`.

null отключает автоудаление; дата должна быть минимум через сутки. По истечении доступ закрывается сразу, worker удаляет S3-объект и расшифровку.

```json
{
  "retained_until": "2026-12-31T18:00:00Z"
}
```

## Личные настройки

### Настройки уведомлений

`GET /api/work/preferences`

Авторизация: scope `profile:read`.

Настройки текущего пользователя. Почтовые уведомления по умолчанию выключены.

### Настроить почту и тихие часы

`PUT /api/work/preferences`

Авторизация: scope `profile:write`.

digest: off — отдельная текущая доставка, daily — раз в день, weekly — не чаще раза в неделю. email_enabled включает почту. Тихие часы поддерживают переход через полночь. Требуется настроенный SMTP и worker.

```json
{
  "timezone": "Europe/Moscow",
  "quiet_start": "22:00",
  "quiet_end": "08:00",
  "digest": "daily",
  "digest_hour": 9,
  "mentions_only": false,
  "email_enabled": true
}
```

## Офлайн

### Синхронизировать одно изменение

`POST /api/work/offline`

Авторизация: scope `tasks:write`. Права: `task.create/task.edit/comment.create по операции`.

kind: task.create, task.update, comment.create, voice.create. UUID operation_id уникален у пользователя: повтор идентичного запроса возвращает прежний результат, другой запрос с тем же UUID — 409. Для task.update обязательна version_number. Голос предварительно загружается через voice-comments/presign, затем data содержит object_key, mime_type, duration_seconds (до 1800); файл до 25 МБ.

```json
{
  "operation_id": "dad3c9e6-dfa3-45cd-9473-a591623b659c",
  "kind": "task.update",
  "task_id": 42,
  "version_number": 3,
  "data": {
    "priority": "high"
  }
}
```

## Устройства и прочтение чатов (0.15.0)

Методы `/api/work/push` (GET/POST/DELETE) работают только с браузерной сессией, персональные API-токены не допускаются. GET возвращает готовность сервера и публичный VAPID-ключ. POST принимает PushSubscription.toJSON(), DELETE — объект с endpoint. Доступ к отправляемым событиям проверяется повторно в worker. Секреты подписки хранятся зашифрованными.

`POST /api/chat/channels/{channelId}/read` с телом `{ "message_id": 123 }` подтверждает прочтение доступного канала; требуется scope `chat:write` при вызове API-токеном. Неверный канал сообщения отклоняется, уменьшить курсор старым запросом нельзя. `GET /messages` возвращает последние 100 сообщений; after=0 начинает историю, after=ID выбирает следующие 100, before=ID — предыдущие. after и before несовместимы. Параметр mark_read=false отключает прежнюю автоматическую отметку прочтения для GET.

[Подробная настройка PWA и Web Push](PWA-AND-CHAT.md).
