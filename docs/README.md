# База знаний Project Wisp

Старт: [AGENTS.md](../AGENTS.md) → назначенная роль → текущая Issue/запрос → нужные разделы одного контракта. Уже переданные инструкции не перечитывать. При изменении обмена проверить обе стороны границы, а не ограничиваться одним файлом.

| Нужная информация | Источник |
|---|---|
| Общие инварианты, роли, verification | [AGENTS.md](../AGENTS.md) |
| Desktop-инварианты | [src/AGENTS.md](../frontend/AGENTS.md), также применяются к desktop tooling |
| Backend runtime, setup и фактические API gaps | [Backend navigator](backend/README.md), [backend/AGENTS.md](../backend/AGENTS.md) |
| Задачи, зависимости и фактические статусы | [GitHub Issues](https://github.com/zyzycode/project_wisp/issues), [Project](https://github.com/users/zyzycode/projects/1) |
| Продуктовые решения и порядок этапов | [Vision и roadmap](PRODUCT_VISION_AND_ROADMAP.md) |
| Ручной запуск и приёмка MVP на Windows | [Windows checklist](WINDOWS_MVP_CHECKLIST.md), выполняет владелец продукта |
| Владельцы правил движков и разделы для чтения | [Индекс engine contracts](engine/README.md) |
| Точные формы портов/IPC | [Application ports](../frontend/src/application/ports), [IPC DTO](../frontend/src/shared/ipc-contracts.ts) |
| Сценарии автономного поведения | [Behavior catalog](behaviors/README.md), только нужный pack; не заменяет contracts |
| Почему принято архитектурное решение | [ADR](adr/README.md), только связанная запись |
| Недостающие спрайты и fallback | Отчёт соответствующей задачи; правила — [frontend/AGENTS.md](../frontend/AGENTS.md#ассеты-и-проверки) |
| Создание Issue, выдача/закрытие спринта | [Шаблоны менеджера](workflow/ISSUE_HANDOFF.md), только для этой операции |
| Обзор для человека | [ARCHITECTURE.md](../ARCHITECTURE.md), необязателен для агентной задачи |

Для поиска внутри выбранного файла: `rg -n '^#{1,3} |<имя типа или правила>' <путь>`, затем прочитать владение и нужные разделы. Весь каталог движков, все роли и историю отчётов заранее не загружать.

Каноническая спецификация задаёт семантику, код — форму типов; расхождение требует architect gate для затронутой части. Навигаторы, behavior packs и отчёты не переопределяют contracts. Связанные с Issue `ARCHITECT RESULT`/`Implementation consequences` обязательны, даже если лежат в отдельном отчёте.

Аудиты `AUTONOMY_AUDIT_*`, `AUTO_46_50_IMPLEMENTATION.md` и engine `*_VERIFICATION.md` читать только при расследовании соответствующей задачи/регрессии; они не показывают актуальный статус всего продукта.

`frontend/asset-pipeline/` и `discord_orcestrations/` — внешние скоупы, не маршрут чтения для продуктовых ролей. Графику предоставляет художник-человек; интеграция готовых файлов из `frontend/public/assets/sprites/` принадлежит приложению.
