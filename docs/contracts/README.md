# Общие контракты desktop ↔ backend

Единый wire contract для независимо запускаемых desktop и backend. Документы общие для обеих сторон; копии в каталогах приложений не создавать. Клиентские порты и IPC не являются серверным протоколом.

| Версия / область | Канонический контракт | Общие fixtures |
|---|---|---|
| v1: chat, ошибки, серверные budgets и lifecycle | [Backend API](BACKEND_API_CONTRACT.md) | [v1](fixtures/desktop-backend-v1) |
| v2: выбранная память и проверяемые кандидаты | [Backend Memory](BACKEND_MEMORY_CONTRACT.md) | [v2](fixtures/desktop-backend-v2) |
| v3: события и последующий разговор; явное касание v1 | [AI Events](AI_EVENTS_CONTRACT.md) | [v3](fixtures/desktop-backend-v3); touch — проверки обеих реализаций |

AI Events также определяет связанные causal gates и правила использования результата на клиенте: перенос документа не разделяет и не меняет этот сквозной контракт. Детали локальных движков — в [frontend contracts](../../frontend/docs/engine/README.md).

Будущее расширение подтверждённых событий и общих шуток: [Memory §6](BACKEND_MEMORY_CONTRACT.md#6-mem-a03-planned-расширение-событий-и-шуток) и [#65 (MEM-A03)](https://github.com/zyzycode/project_wisp/issues/65). Планируемый v4 chat не меняет действующие v1–v3; DTO, fixtures и реализация поставляются отдельными задачами.


Наличие контракта и fixtures не подтверждает реализацию endpoint. Поддерживаемые текущим сервером версии и gaps — в [backend docs](../../backend/docs/README.md#фактическая-реализация). Python-схемы и TypeScript-типы не импортируют друг друга; совместимость проверяется общими fixtures. Их путь `docs/contracts/fixtures/` сохранён для существующих тестов.

Planned lore/summary: [CTX-A01](CONTEXT_DATA_CONTRACT.md) — server-owned lore без wire delta и отдельная v5 ветка на базе v3; #79 зависит от MEM-I01/#80 для source provenance/suppression. V4 knowledge не меняется; v5 fixtures поставляются в #79.
