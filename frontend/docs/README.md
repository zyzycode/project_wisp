# Документация desktop Wisp

Документы frontend находятся рядом с приложением. Инженерные правила — [frontend/AGENTS.md](../AGENTS.md); подготовка и команды запуска — [корневой README](../../README.md#подготовка).

| Информация | Источник |
|---|---|
| Владение, семантика движков, IPC и локальная память | [Engine contracts](engine/README.md) |
| Наблюдаемое поведение и приёмочные сценарии | [Каталог поведения](behaviors/README.md) |
| Ручной запуск и проверка на Windows | [Windows checklist](WINDOWS_MVP_CHECKLIST.md) |
| Причины desktop-решений | [Motion ADR-014](adr/ADR-014-native-window-motion.md), [Utility ADR-015](adr/ADR-015-utility-ai-without-xstate.md), [SQLite ADR-016](adr/ADR-016-local-memory-sqlite.md) |
| Следующее расширение локальных предпочтений | [CHAR-A01: решение и Implementation consequences](CHAR_A01_RESULT.md); реализация — отдельный этап |
| Локальные обещания и напоминания | [REM-A01: решение и Implementation consequences](REM_A01_RESULT.md); реализация после MEM-I01 |
| Исторические задачи и проверки | [Desktop-архив](archive/README.md) |

Обмен desktop ↔ backend определяется единственными [общими wire-контрактами и fixtures](../../docs/contracts/README.md). Фактические возможности сервера — в [backend docs](../../backend/docs/README.md), общая vision и процесс работы — в [навигаторе проекта](../../docs/README.md). При изменении обмена проверять обе стороны границы.
