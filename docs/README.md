# Общая документация Project Wisp

Документы каждого приложения находятся рядом с ним: [frontend/docs](../frontend/docs/README.md) и [backend/docs](../backend/docs/README.md). В корневом `docs/` остаются продуктовые решения, общие API-контракты/fixtures и материалы, затрагивающие обе стороны.

Старт: [AGENTS.md](../AGENTS.md) → назначенная роль, если есть → текущая Issue/запрос → нужные разделы контракта. Уже переданные инструкции не перечитывать. При изменении обмена проверять обе стороны границы.

| Нужная информация | Источник |
|---|---|
| Общие инварианты, роли и verification | [AGENTS.md](../AGENTS.md) |
| Desktop: движки, сценарии, Windows, локальные ADR и архив | [Frontend docs](../frontend/docs/README.md), [desktop-правила](../frontend/AGENTS.md) |
| Backend: runtime, setup, API gaps и поставки | [Backend docs](../backend/docs/README.md), [backend-правила](../backend/AGENTS.md) |
| Desktop ↔ backend: wire v1/v2/v3 и fixtures | [Общие контракты](contracts/README.md) |
| Продуктовые решения и следующие этапы | [Vision и roadmap](PRODUCT_VISION_AND_ROADMAP.md) |
| Следующее расширение памяти событий и общих шуток | [MEM-A03: решение и Implementation consequences](MEM_A03_RESULT.md); реализация — отдельный этап |
| Локальное наблюдение приложений и отдельный эксперимент экрана | [OBS-A01: решение и Implementation consequences](OBS_A01_RESULT.md); реализация — отдельный этап |
| Причины архитектурных решений | [Реестр ADR](adr/README.md), только связанная запись |
| Задачи, зависимости и фактические статусы | [GitHub Issues](https://github.com/zyzycode/project_wisp/issues), [Project](https://github.com/users/zyzycode/projects/1) |
| Создание Issue, выдача/закрытие спринта | [Шаблоны менеджера](workflow/ISSUE_HANDOFF.md), только для этой операции |
| Обзор для человека | [ARCHITECTURE.md](../ARCHITECTURE.md), необязателен для агентной задачи |
| Исторические межкомпонентные решения | [Общий архив](archive/README.md) |

Каноническая спецификация задаёт семантику, код — форму типов; расхождение требует architect gate для затронутой части. Навигаторы, сценарии и отчёты не переопределяют contracts. Связанные с Issue `ARCHITECT RESULT`/`Implementation consequences` обязательны, в том числе после переноса в архив. Исторические статусы и разовые разрешения не действуют на новые задачи.

Для поиска: `rg -n '^#{1,3} |<имя типа или правила>' <путь>`, затем читать владение и нужный раздел. Весь каталог движков, все роли и историю отчётов заранее не загружать.

`frontend/asset-pipeline/` и `discord_orcestrations/` — внешние скоупы. Графику предоставляет художник-человек; правила готовых ассетов и отчётности — в [frontend/AGENTS.md](../frontend/AGENTS.md#ассеты-и-проверки).
