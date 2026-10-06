# Desktop ↔ Backend v1

Единственный канонический контракт — [docs/engine/BACKEND_API_CONTRACT.md](../engine/BACKEND_API_CONTRACT.md). Полные wire-формы — [backend-ai-contract.ts](../../src/application/ports/backend-ai-contract.ts), server validation — [schemas.py](../../backend/wisp_backend/schemas.py).

Прежний серверный документ дублировал desktop-спецификацию и содержал неразрешимые относительные ссылки. При объединении его заменили этим маршрутом, без второй копии правил. Общие fixtures — в [docs/contracts/fixtures/desktop-backend-v1/](../contracts/fixtures/desktop-backend-v1/).

Фактические возможности текущего v1 snapshot и пробелы относительно поздних server safeguards перечислены в [backend navigator](README.md#фактическая-реализация). Историческая версия документа сохраняется в исходном Git-репозитории на commit, указанном в [ADR-017](../adr/ADR-017-monorepo.md).
