# Backend Wisp

Backend формирует AI-ответы и ведёт служебный учёт запросов.
[Архитектура и ORM-модели](ARCHITECTURE.md) · [Context/Prompt Engine](CONTEXT_PROMPT_ENGINE.md) ·
[API-контракты и fixtures](../../docs/contracts/README.md).

## Фактическая реализация

`GET /health`; `POST /v1/chat`, `/v1/touch`, `/v2/chat`, `/v3/chat`, `/v3/events`,
`/v5/chat`, `/v5/summary`, `/v6/observation`, `/v7/touch`, `/v7/chat`. V5 opt-in: отдельная ветка v3 с производной summary;
генерация только после явного desktop preview/confirm, без server history.
[V6 observation](../../docs/contracts/AI_EVENTS_CONTRACT.md#9-observation-boundary) —
изолированная реакция на untrusted appName/windowTitle и current character: только text,
без memory extraction; metadata не сохраняется в ledger/logs, response cache — до 10 минут.
[V7 interactions](../../docs/contracts/AI_EVENTS_CONTRACT.md#10-interaction-a01-семантическое-взаимодействие-v7) —
явный touch с bounded appraisal и полноценный v5-compatible chat с card/effectPolicy,
summary, memory, previousInitiative и optional previousTouch. В этапе #89 desktop chat
передаёт suppressed; appraisal neutral/low/clear сопровождает обычный ответ без нового
эффекта разговора. PreviousTouch — обязательный при наличии atomic untrusted context,
не user fact и не extraction evidence. Числа и окончательное принятие принадлежат desktop.
Оба endpoint используют прежние service/provider/budget/ledger, один inference; request/context
остаются в RAM, response cache — до 10 минут, durable conversation storage не добавлен.
Ответы — JSON без streaming. Один активный провайдер на процесс: Groq или Gemini.
Health проверяет HTTP runtime; доступность провайдера проверяется отдельно.

## Запуск

Из `backend/`, Python 3.12+:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
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

Из `backend/`: `.venv/Scripts/python.exe -m pip check`, затем
`.venv/Scripts/python.exe -m pytest -q`. Тесты подменяют внешние provider-вызовы.


## Лицензия и исходный код

Backend содержит Python-адаптацию SillyTavern и поставляется как единая производная
программа под [AGPL-3.0](../COPYING). Исходный [MIT notice](../LICENSE) сохранён;
[NOTICE](../NOTICE) фиксирует upstream commit, перенесённые фрагменты и изменения.
Независимый HTTP desktop и монорепозиторий целиком автоматически не перелицензируются.
`/source` выдаёт бесплатный полный архив точной startup source revision (SHA-256);
заметная ссылка есть в `/docs`, HTTP responses содержат Link. До сетевой/binary поставки
проверить доступность архива пользователям и сохранить его рядом с артефактом.
[Состав, ограничения и проверка offer](CONTEXT_PROMPT_ENGINE.md#реализация-lore-и-проверка-source-offer-78).
