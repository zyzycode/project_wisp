# Тестирование и верификация

## Приоритеты

- Unit: domain/FSM transitions, physics, geometry, parsers, DTO mappers и pure functions.
- Integration: use cases + repositories, migrations, provider fallback, IPC routing/serialization.
- UI/component: только важные пользовательские взаимодействия и cleanup; не тестируй CSS-пиксели и сторонние Electron APIs.
- Проверяй поведение через public interface, а не private methods и implementation details.

Обязательно покрывай новые или изменённые acceptance criteria, edge cases, interrupt/priority transitions, provider fallback и persistence migrations.

## Gate по риску

- Базовые проверки product code: `npm run typecheck` и `npm test`.
- `npm run test:python` запускай при изменении Python scripts или их contracts.
- `npm run build` запускай при изменении build path, Electron/Vite config, packaging или release-sensitive wiring.
- Используй только scripts, существующие в `package.json`; не заявляй несуществующий lint gate.
- При узком изменении допустимы сначала targeted tests, но перед завершением выполни требуемый полный gate.
- После каждого микрошага обязательного полного прогона нет.
- Docs-only изменения требуют проверки ссылок и diff consistency, а не product tests.

## Bugfix и refactor

- Для bugfix сначала зафиксируй воспроизведение и root cause, затем добавь regression test, падающий без исправления. Если тест неприменим, объясни причину.
- Fix-pass после review привязывай к confirmed finding; пользовательский bug report отдельного finding не требует.
- Перед refactor убедись, что изменяемое поведение покрыто; при недостаточном покрытии добавь тест в scope или сообщи blocker.
- Refactor не меняет поведение и завершается тем же gate, который соответствовал бы изменённому product code.
