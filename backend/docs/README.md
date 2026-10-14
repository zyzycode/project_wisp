# Backend Wisp

Backend формирует AI-ответы и ведёт служебный учёт запросов.
[Архитектура и ORM-модели](ARCHITECTURE.md) · [API-контракты и fixtures](../../docs/contracts/README.md).

## Фактическая реализация

`GET /health`; `POST /v1/chat`, `/v1/touch`, `/v2/chat`, `/v3/chat`, `/v3/events`.
Ответы — JSON без streaming. Один активный провайдер на процесс: Groq или Gemini.
Health проверяет HTTP runtime; доступность провайдера проверяется отдельно.

## Запуск

Из `backend/`, Python 3.10+:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
```

Создайте `backend/.env` по [.env.example](../.env.example), задайте `WISP_AI_PROVIDER`
и соответствующий `GROQ_API_KEY` или `GEMINI_API_KEY`. Все параметры и подсказки —
в шаблоне; process environment имеет приоритет. После изменений нужен перезапуск.
Секреты не коммитятся. Состав зависимостей — в [requirements.txt](../requirements.txt)
и [requirements-dev.txt](../requirements-dev.txt).

Из корня репозитория: `node scripts/wisp.mjs dev:backend`.
Адрес по умолчанию — `http://127.0.0.1:8000`, Swagger — `/docs`.
Запускать один ASGI worker. Внешний доступ и условия передачи данных провайдеру
определены в [API-контракте](../../docs/contracts/BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление).

## Проверки

Из `backend/`: `.venv/Scripts/python.exe -m pip check`, затем
`.venv/Scripts/python.exe -m pytest -q`. Тесты подменяют внешние provider-вызовы.
