# Backend Wisp

> [!IMPORTANT]
> **Unified v1 Alpha:** backend и desktop используют один актуальный контракт.
> Wire-поля `version` и поддержки старых клиентов нет; desktop и backend обновляются совместно.
> Маршруты: `POST /v1/chat`, `/v1/touch`, `/v1/events`, `/v1/observation`,
> `/v1/summary` и `GET /health`. Chat/touch всегда возвращают appraisal.
> Клиент и сервер обновляются совместно; обратной совместимости со старыми API нет.

Backend формирует AI-ответы и ведёт служебный учёт запросов.
[Архитектура и ORM-модели](ARCHITECTURE.md) · [Context/Prompt Engine](CONTEXT_PROMPT_ENGINE.md) ·
[API-контракты и fixtures](../../docs/contracts/README.md).

## Поддерживаемые сценарии

| Сценарий | Маршрут | Описание возможностей |
|---|---|---|
| **Chat** | `POST /v1/chat` | Полноценный диалог: история сообщений, контекст локальной памяти фактов, карточка взаимодействия и семантическая appraisal (оценка тона) |
| **Events** | `POST /v1/events` | Подтверждённые игровые и социальные события, text-only ответ |
| **Touch** | `POST /v1/touch` | Мгновенный физический контакт (клик мышью): без текстовой истории, короткая эмоциональная реакция и оценка взаимодействия |
| **Observation** | `POST /v1/observation` | Фоновая реакция на активное приложение и заголовок окна пользователя (`appName`, `windowTitle`) |
| **Summary** | `POST /v1/summary` | Сжатие накопившихся пар реплик в лаконичное резюме диалога |
| **Health** | `GET /health` | Healthcheck HTTP-сервера |


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

## Проверки

Из корня: `node scripts/wisp.mjs check:backend`, затем
`node scripts/wisp.mjs test:backend`. CLI выбирает Python из backend `.venv`.
Тесты подменяют внешние provider-вызовы; проверяют wire, prompts, бюджеты,
timeout/disconnect/shutdown и ledger. Они не подтверждают качество живых ответов LLM.


## Лицензия

Backend поставляется под [MIT license](../LICENSE).
