# Общие контракты desktop ↔ backend

Единый wire contract для независимо запускаемых desktop и backend. Документы общие для обеих сторон; копии в каталогах приложений не создавать. Клиентские порты и IPC не являются серверным протоколом.

| Версия / область | Канонический контракт | Общие fixtures |
|---|---|---|
| v1: chat, ошибки, серверные budgets и lifecycle | [Backend API](BACKEND_API_CONTRACT.md) | [v1](fixtures/desktop-backend-v1) |
| v2: выбранная память и проверяемые кандидаты | [Backend Memory](BACKEND_MEMORY_CONTRACT.md) | [v2](fixtures/desktop-backend-v2) |
| v3: события и последующий разговор; явное касание v1 | [AI Events](AI_EVENTS_CONTRACT.md) | [v3](fixtures/desktop-backend-v3); touch — проверки обеих реализаций |

AI Events также определяет связанные causal gates и правила использования результата на клиенте: перенос документа не разделяет и не меняет этот сквозной контракт. Детали локальных движков — в [frontend contracts](../../frontend/docs/engine/README.md).

Наличие контракта и fixtures не подтверждает реализацию endpoint. Поддерживаемые текущим сервером версии и gaps — в [backend docs](../../backend/docs/README.md#фактическая-реализация). Python-схемы и TypeScript-типы не импортируют друг друга; совместимость проверяется общими fixtures. Их путь `docs/contracts/fixtures/` сохранён для существующих тестов.
