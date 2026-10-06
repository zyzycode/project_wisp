# ADR-017: Desktop и backend в одном репозитории

Статус: Accepted пользователем 2026-10-06. Task: MONOREPO-01.

## Decision

Хранить desktop и Python/FastAPI backend в `project_wisp`, разместив desktop в `frontend/`, сервер в `backend/`. Обе части имеют отдельные runtime, зависимости, запуск и deployment. Общие Markdown-документы находятся в корневом `docs/`, серверные инструкции — в `docs/backend/`; canonical wire contracts и fixtures сохраняют существующие пути.

Корневой `AGENTS.md` задаёт общие границы. Desktop-инварианты находятся в `frontend/AGENTS.md` с явными ссылками из `frontend/tests/AGENTS.md`/`frontend/public/AGENTS.md`; серверные — в `backend/AGENTS.md`. Роли остаются общими в `.agents/agents/`, с проверками по затронутому scope.

## Alternatives

Отдельные репозитории усложняют совместные изменения API/fixtures. Desktop в корне затрудняет визуальное разделение компонентов; пользователь выбрал симметричные `frontend/` и `backend/`. Корневой Node CLI запускает npm из `frontend/` без hoisting; зависимости и lockfile — в `frontend/`, Python venv — в `backend/.venv/`.

## Consequences

Импортируется tracked snapshot локального `wisp_backend` на `275cc8161e5f725681fdacc725708acaf74784b6`; исходный репозиторий и его история сохраняются отдельно. Это перенос исходников, не объединение Git-историй. `.env`, `.venv`, кеши, IDE и runtime data не импортируются.

API не меняется: текущий сервер поддерживает v1, расширения и server-only safeguards ещё не реализованы в импортированном snapshot. Их gaps перечислены в [backend navigator](../backend/README.md); canonical contracts не ослабляются. Исправление inherited proxy покрывается регрессионным тестом; использование proxy/TLS environment становится явной серверной конфигурацией.

## Implementation consequences

Для MONOREPO-01 обязательны этот ADR, [общие инструкции](../../AGENTS.md), инструкции затронутых каталогов и [серверный navigator](../backend/README.md). Перенести desktop код/тесты/ассеты/tooling в `frontend/`, backend — в `backend/`; общую документацию оставить в корне. Корневой Node CLI и launchers обеспечивают совместный запуск, остановку обоих компонентов и отдельные проверки без новых dependencies. Обновить ссылки и проверить общие v1 fixtures. Затем desktop typecheck → tests, backend pip check → pytest и разрешённый live smoke. Source backend не изменять; существующие пользовательские изменения сохранять.

Проверки выполняет исполнитель; по завершении scope — done. Миграция не принимает серверные gaps и не меняет сетевые/процессные границы.

`frontend/asset-pipeline/` относится к frontend, но сохраняет независимые инструкции. При переносе его пути к `public/` и определение root остаются frontend-relative; ссылки на общие docs обновляются. Скрипты художника не запускаются этой задачей. Общий `.gitignore` исключает frontend node_modules, backend venv/secrets/cache и локальные output/input pipeline.
