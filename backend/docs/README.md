# Backend Wisp

Backend формирует AI-ответы и ведёт служебный учёт запросов.
[Архитектура и ORM-модели](ARCHITECTURE.md) · [Context/Prompt Engine](CONTEXT_PROMPT_ENGINE.md) ·
[API-контракты и fixtures](../../docs/contracts/README.md).

## Реализованные возможности

**V7 реализован:** `/v7/chat` и `/v7/touch` работают через общий completion runtime.
Версии обозначают поддерживаемые wire-сценарии, а не этапы готовности сервера.
Старые endpoints сохранены для совместимости; v6 observation и v5 summary остаются
отдельными операциями и при использовании v7 chat.

| Endpoint | Возможности |
|---|---|
| `POST /v1/chat`, `/v1/touch` | Базовый диалог и короткая реакция на касание |
| `POST /v2/chat` | Диалог с локальной проекцией памяти и предложениями фактов |
| `POST /v3/chat`, `/v3/events` | Контекст предыдущей инициативы и реакции на события desktop |
| `POST /v5/chat`, `/v5/summary` | Диалог с производной summary; отдельная генерация после desktop preview/confirm |
| `POST /v6/observation` | Короткая реакция на appName/windowTitle; без истории, памяти и extraction |
| `POST /v7/chat` | Возможности v5 плюс обязательная appraisal, card/effectPolicy и optional previousTouch |
| `POST /v7/touch` | Реакция на явное касание с обязательной appraisal |
| `GET /health` | Проверка HTTP runtime; не проверяет доступность LLM |

[Appraisal v7](../../docs/contracts/AI_EVENTS_CONTRACT.md#10-interaction-a01-семантическое-взаимодействие-v7)
— предложение оценки текущего взаимодействия. При `eligible` модель классифицирует
текущую реплику; при `suppressed` допустима только `neutral/low/clear`. Числовой эффект,
согласие, память и окончательное принятие принадлежат desktop. PreviousTouch хранит
контекст уже опубликованной реакции, не является пользовательским фактом или evidence.

Ответы — JSON без streaming. Один активный провайдер на процесс: Groq или Gemini;
не более одного generation inference на запрос. Gemini предварительно считает
токены через официальный countTokens в пределах того же deadline; Groq сохраняет
консервативную оценку. [Точность и ограничения](CONTEXT_PROMPT_ENGINE.md#бюджет-и-ошибка).
Сервер не хранит диалоги и память
на диске: SQLite содержит служебный учёт, кеш ответов — только RAM до 10 минут.
Схемы и точные ограничения — в [общих контрактах](../../docs/contracts/README.md).

## Где находится логика

- [Архитектура](ARCHITECTURE.md) — путь запроса, слои, ресурсы и SQLite ledger.
- [Context/Prompt Engine](CONTEXT_PROMPT_ENGINE.md) — карта файлов, типы сценариев,
  правила личности, сборка контекста и бюджет.
- [CompletionService](../wisp_backend/completion/service.py) — повтор request ID,
  deadline, cancellation и завершение учёта.
- [Scenario policies](../wisp_backend/completion/policies.py) — связь сценария с
  типом контекста, prompt builder, проверкой ответа и лимитами.

## Запуск

Из `backend/`, Python 3.12+, Windows PowerShell:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
```

Linux/macOS:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Создайте `backend/.env` по [.env.example](../.env.example), задайте `WISP_AI_PROVIDER`
и соответствующий `GROQ_API_KEY` или `GEMINI_API_KEY`. Все параметры и подсказки —
в шаблоне; process environment имеет приоритет. После изменений нужен перезапуск.
Секреты не коммитятся. Состав зависимостей — в [requirements.txt](../requirements.txt).

Из корня репозитория: `node scripts/wisp.mjs dev:backend`.
Адрес по умолчанию — `http://127.0.0.1:8000`, Swagger — `/docs`.
Запускать один ASGI worker. Внешний доступ и условия передачи данных провайдеру
определены в [API-контракте](../../docs/contracts/BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление).

### Выбор v7 в desktop

Backend регистрирует все перечисленные endpoints при запуске; отдельного server
флага для v7 нет. Версию обращения выбирает desktop через `WISP_BACKEND_API_VERSION=7`
при заданном `WISP_BACKEND_URL`. Events/summary имеют отдельные клиентские настройки.
Общий `node scripts/wisp.mjs dev` сейчас принудительно задаёт desktop **v1** и отключает
AI events; это поведение launcher, а не отсутствие v7 на сервере. Для v7 запускать
`dev:backend` и `dev:frontend` отдельно с нужными переменными окружения desktop.

## Проверки

Из корня: `node scripts/wisp.mjs check:backend`, затем
`node scripts/wisp.mjs test:backend`. CLI выбирает Python из backend `.venv`.
Тесты подменяют внешние provider-вызовы; проверяют wire, prompts, бюджеты,
timeout/disconnect/shutdown и ledger. Они не подтверждают качество живых ответов LLM.


## Лицензия

Backend поставляется под [MIT license](../LICENSE).
