# ADR-017: Desktop и backend в одном репозитории

Статус: Accepted пользователем 2026-10-06. Task: MONOREPO-01.

## Decision

Хранить desktop и Python/FastAPI backend в `project_wisp`, сохранив существующие desktop-пути и добавив `backend/`. Обе части имеют отдельные runtime, зависимости, запуск и deployment. Общие Markdown-документы находятся в корневом `docs/`, серверные инструкции — в `docs/backend/`; canonical wire contracts и fixtures сохраняют существующие пути.

Корневой `AGENTS.md` задаёт общие границы. Desktop-инварианты находятся в `src/AGENTS.md` с явными ссылками из `tests/AGENTS.md`/`public/AGENTS.md`; серверные — в `backend/AGENTS.md`. Роли остаются общими в `.agents/agents/`, с проверками по затронутому scope.

## Alternatives

Отдельные репозитории усложняют совместные изменения API/fixtures. Перенос desktop в новый каталог добавляет ненужный churn путей, tooling и документации; npm workspaces не требуются для Python backend.

## Consequences

Импортируется tracked snapshot локального `wisp_backend` на `275cc8161e5f725681fdacc725708acaf74784b6`; исходный репозиторий и его история сохраняются отдельно. Это перенос исходников, не объединение Git-историй. `.env`, `.venv`, кеши, IDE и runtime data не импортируются.

API не меняется: текущий сервер поддерживает v1, расширения и server-only safeguards ещё не реализованы в импортированном snapshot. Их gaps перечислены в [backend navigator](../backend/README.md); canonical contracts не ослабляются. Исправление inherited proxy покрывается регрессионным тестом; использование proxy/TLS environment становится явной серверной конфигурацией.

## Implementation consequences

Для MONOREPO-01 обязательны этот ADR, [общие инструкции](../../AGENTS.md), инструкции затронутых каталогов и [серверный navigator](../backend/README.md). Перенести tracked код/тесты/tooling в `backend/`, добавить ссылки и исключения runtime файлов, проверить общие v1 fixtures. Затем desktop typecheck → tests, backend pip check → pytest и разрешённый live smoke. Source backend не изменять; существующие пользовательские изменения сохранять.

Следующий gate: независимый reviewer. Миграция не принимает серверные gaps и не меняет сетевые/процессные границы.
