# Общая документация Project Wisp

Документы каждого приложения находятся рядом с ним: [frontend/docs](../frontend/docs/README.md) и [backend/docs](../backend/docs/README.md). В корневом `docs/` остаются продуктовые решения, общие API-контракты/fixtures и материалы, затрагивающие обе стороны.

Старт: [AGENTS.md](../AGENTS.md) → назначенная роль, если есть → текущая Issue/запрос → нужные разделы контракта. Уже переданные инструкции не перечитывать. При изменении обмена проверять обе стороны границы.

| Нужная информация | Источник |
|---|---|
| Общие инварианты, роли и verification | [AGENTS.md](../AGENTS.md) |
| Desktop: движки, сценарии, Windows, локальные ADR и архив | [Frontend docs](../frontend/docs/README.md), [desktop-правила](../frontend/AGENTS.md) |
| Backend: runtime, setup, API gaps и поставки | [Backend docs](../backend/docs/README.md), [backend-правила](../backend/AGENTS.md) |
| Desktop ↔ backend: wire v1 и fixtures | [Общие контракты](contracts/README.md) |
| Продуктовые решения и следующие этапы | [Vision и roadmap](PRODUCT_VISION_AND_ROADMAP.md) |
| Следующее расширение памяти событий и общих шуток | [#65 (MEM-A03)](https://github.com/zyzycode/project_wisp/issues/65); канонический контракт — [Memory §10](../frontend/docs/engine/MEMORY_ENGINE.md#10-mem-a03-важные-события-и-общие-шутки-planned) |
| AI-реакции на приложение и заголовок; отдельный эксперимент экрана | [#84 (OBS-A02)](https://github.com/zyzycode/project_wisp/issues/84); канонический контракт — [Perception §11](../frontend/docs/engine/PERCEPTION_ENGINE.md#11-obs-a02-активное-приложение-и-заголовок) |
| Причины архитектурных решений | [Реестр ADR](adr/README.md), только связанная запись |
| Создание Issue, выдача/закрытие спринта | [Инструкция и шаблоны менеджера](../.agents/agents/project-manager/agent.md#шаблоны-работы-менеджера) |


Каноническая спецификация задаёт семантику, код — форму типов; расхождение требует architect gate для затронутой части. Навигаторы, сценарии и отчёты не переопределяют contracts. Связанные с Issue `ARCHITECT RESULT`/`Implementation consequences` берутся из комментариев к соответствующей Issue. Исторические статусы и разовые разрешения не действуют на новые задачи.

Для поиска: `rg -n '^#{1,3} |<имя типа или правила>' <путь>`, затем читать владение и нужный раздел. Весь каталог движков, все роли и историю отчётов заранее не загружать.

`frontend/asset-pipeline/` и `discord_orcestrations/` — внешние скоупы. Графику предоставляет художник-человек; правила готовых ассетов и отчётности — в [frontend/AGENTS.md](../frontend/AGENTS.md#7-ассеты-и-проверки).
