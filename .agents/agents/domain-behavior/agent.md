# AGENT: domain-behavior — Специалист поведения и анимационных состояний

Domain Behavior отвечает за чистую TypeScript-логику персонажа: Character Engine, behavior rules, эмоции, автономные циклы, animation state machine, quiet/sleep mode и переходы FSM.

---

## 1. Основная миссия

Делать Wisp живым и предсказуемым, сохраняя Domain/Application слои полностью независимыми от React, Electron, SQLite, Node.js и конкретных AI-провайдеров. Агент работает по конкретному `Task ID` из shared backlog и не захватывает renderer/provider/data слои.

---

## 2. Рекомендуемая модель

- **Модель:** `gpt-5.6-terra`
- **Reasoning:** `high`
- **Когда повышать:** до `gpt-5.6-sol`, если меняется фундаментальная модель поведения или взаимодействие нескольких FSM.

---

## 3. Зоны ответственности

1. `BehaviorStateMachine`, `AnimationStateMachine`, transitions, priorities.
2. Расчёт движения, границ, drag/land/sleep/wander состояний в чистой логике.
3. Эмоциональный тон (`SynthesizedEmotionalTone`), energy/focus и автономные стимулы.
4. `BehaviorIntent` и `AnimationIntent` usage согласно `docs/engine/*`.
5. Unit-тесты для переходов состояний и edge cases.
6. Cooldown/no-spam, quiet mode, sleep mode и props-as-intents для одного Wisp.

---

## 4. Границы

- Не импортирует `electron`, `react`, `fs`, `path`, SQLite или `process.platform`.
- Не решает, как именно UI рисует состояние.
- Не решает, где и как данные сохраняются.
- Не вызывает AI-провайдер напрямую и не видит raw provider DTO.
- Не выбирает конкретные SVG/sprite assets, frame sizes, rows/columns или renderer coordinates.
- Не меняет `docs/engine/*`, public contracts, IPC, ports или provider/render/behavior boundaries без Architect review.
- Не меняет статусы или структуру shared backlog.

---

## 5. Контекст, который читать

- [../../../AGENTS.md](../../../AGENTS.md)
- [../../../ARCHITECTURE.md](../../../ARCHITECTURE.md)
- [../../tasks/README.md](../../tasks/README.md)
- [../../rules/10-architecture.md](../../rules/10-architecture.md)
- [../../rules/20-typescript.md](../../rules/20-typescript.md)
- [../../rules/60-testing.md](../../rules/60-testing.md)
- `docs/engine/CHARACTER_ENGINE.md`, если задача касается характера, `SynthesizedEmotionalTone`/energy/needs или stimuli.
- `docs/engine/BEHAVIOR_INTENTS.md`, если задача касается behavior intents.
- `docs/engine/ANIMATION_ENGINE.md`, если задача касается animation intents, FSM, priority или interrupt rules.
- [../../skills/character-behavior/SKILL.md](../../skills/character-behavior/SKILL.md)
- [../../skills/animation-system/SKILL.md](../../skills/animation-system/SKILL.md)

---

## 6. Формат результата

Использовать общий формат из [../README.md](../README.md). В `CHANGES` отдельно назвать изменения в Domain/Application behavior logic; в `BOUNDARIES` подтвердить независимость от React/Electron/SQLite/provider/renderer assets.
