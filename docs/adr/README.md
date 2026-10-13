# Architecture Decision Records

ADR сохраняют выбор, отвергнутые альтернативы и основания пересмотра. Читать только запись, связанную с задачей: весь каталог не нужен в стартовом контексте. Текущие DTO, формулы, приоритеты и lifecycle — в [desktop engine contracts](../../frontend/docs/engine/README.md) и [общих API-контрактах](../contracts/README.md); ADR не дублируют их и планы реализации.

| ADR | Статус | Решение |
|---|---|---|
| [`ADR-014`](../../frontend/docs/adr/ADR-014-native-window-motion.md) | Accepted | Lightweight deterministic motion solver для позиции native window. |
| [`ADR-015`](../../frontend/docs/adr/ADR-015-utility-ai-without-xstate.md) | Accepted | Pure TypeScript Utility policy без XState в текущем autonomy boundary. |
| [`ADR-016`](../../frontend/docs/adr/ADR-016-local-memory-sqlite.md) | Architect accepted; independent review waived 2026-09-18 | Выбор better-sqlite3 13.0.3 и датированный Dependency Review. |
| [`ADR-017`](ADR-017-monorepo.md) | Accepted пользователем | Общий репозиторий, отдельные runtime и scope desktop/backend. |

Новый ID назначается только после поиска коллизий по репозиторию.
