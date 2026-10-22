# Общие контракты desktop ↔ backend

Alpha использует один актуальный API под `/v1`, без поля `version` в JSON. Старые маршруты удалены;
переключателя версии, probing и downgrade нет. Desktop и backend обновляются совместно.

| Область | Канонический контракт | Маршруты |
|---|---|---|
| Транспорт, ошибки, lifecycle и данные | [Backend API](BACKEND_API_CONTRACT.md) | Все `/v1/*`, `GET /health` |
| Диалог и локальная память | [Memory](BACKEND_MEMORY_CONTRACT.md) | `POST /v1/chat` |
| Appraisal, касание, инициативы и наблюдение | [AI Events](AI_EVENTS_CONTRACT.md) | `POST /v1/chat`, `/v1/touch`, `/v1/events`, `/v1/observation` |
| Lore и summary | [Context Data](CONTEXT_DATA_CONTRACT.md) | `POST /v1/chat`, `/v1/summary` |

[Общие fixtures](fixtures/desktop-backend-v1/) сгруппированы по возможностям.
[Interaction DTO](../../frontend/src/application/ports/backend-interaction-contract.ts)
определяет полный chat/touch контракт: обязательные card/effectPolicy, память в chat,
appraisal в обоих ответах. Остальные wire-модули описывают составляющие этого контракта.
Python-схемы и TypeScript-типы не импортируют друг друга; обе стороны проверяют общий corpus.
Локальные Application ports и IPC остаются отдельными от HTTP DTO.

Серверные границы — [backend](../../backend/docs/README.md),
локальные движки — [frontend](../../frontend/docs/engine/README.md).
