# ADR-017: Desktop и backend в одном репозитории

Статус: Accepted пользователем 2026-10-06. Task: MONOREPO-01. Размещение документации уточнено пользователем 2026-10-13.

## Decision

Desktop находится в `frontend/`, Python/FastAPI backend — в `backend/`; runtime, зависимости, запуск и deployment раздельны. Desktop-документация — `frontend/docs/`, серверная — `backend/docs/`, общие материалы — `docs/`. Canonical wire contracts находятся в `docs/contracts/`; fixtures сохраняют путь `docs/contracts/fixtures/`. Правила: [общие](../../AGENTS.md), [desktop](../../frontend/AGENTS.md), [backend](../../backend/AGENTS.md); роли общие в `.agents/agents/`.

## Rationale

Отдельные репозитории усложняют совместные изменения API/fixtures. Desktop в корне хуже отделяет компоненты; пользователь выбрал симметричные каталоги. Корневой Node CLI маршрутизирует запуск и проверки без hoisting: npm package/lockfile — в `frontend/`, Python venv — в `backend/.venv/`.

## Consequences

Перенесён tracked snapshot `wisp_backend` на `275cc8161e5f725681fdacc725708acaf74784b6`; исходный репозиторий и его история сохранены отдельно, Git-истории не объединялись. Secrets, venv, кеши, IDE и runtime data не импортировались.

Перенос не меняет API и сетевые/процессные границы, не означает реализацию или принятие серверных gaps: [фактические возможности backend](../../backend/docs/README.md#фактическая-реализация). Proxy/TLS environment — явная серверная конфигурация. `frontend/asset-pipeline/` сохраняет независимый scope и frontend-relative пути; перенос не разрешает запуск его скриптов продуктовым ролям.
