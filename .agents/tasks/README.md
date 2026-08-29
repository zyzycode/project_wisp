# .agents/tasks/README.md — компактная доска задач Project Wisp

Этот файл хранит только ближайший рабочий фронт (3–5 задач) и правила передачи задач агентам.
- `ROADMAP.md` — верхнеуровневый продуктовый роудмап (фазы 0..19).
- `docs/engine/SHIMEJI_SPEC.md` — подробный план и спецификация Shimeji-механик.

## Бюджет контекста

- Держать файл коротким: целевой размер — до 180 строк.
- Активными держать только текущую фазу и 3–5 задач.
- Агенту в prompt передаётся одна карточка задачи, а не весь backlog.
- Агент читает только релевантный `docs/engine/*.md`.

## Статусы

- `planned` — задача понятна, но ещё не готова к выдаче.
- `ready` — можно выдавать owner-agent.
- `in_progress` — задача выполняется.
- `blocked` — нужен внешний ответ или решение.
- `done` — результат принят.

## Текущее состояние спринта

- Phase 0–13: `done` — архитектура, оверлей, FSM, Character Engine v2, AI dialogue loop, Animation & Reaction Pack, Render Engine, Sprites, Logger & Debug HUD.
- Visual Track (13-F — Face Overlay & Anchors): `done`
  - `P13-F01` (Face Compatibility & Anchor Map Contract): `done`
  - `P13-F02` (Offline Sprite Manifest Generator & Validator): `done`
  - `P13-F03` (Face Asset Preparation Pack — art): `ready` (художник)
  - `P13-F04` (Face Overlay Integration & Anchor Resolver in Renderer): `done`
  - `P13-F05` (Face Overlay Review Gate): `done`
- Phase 14 (Shimeji & Advanced Autonomy): `in_progress` (детали в `docs/engine/SHIMEJI_SPEC.md`)
  - `P14-S01` (FSM Locomotion Expansion & Boredom Need): `done`
  - `P14-S01-REV` (Review Gate Locomotion & Boredom Need): `done`
  - `P14-S02` (Drag & Throw Ballistics Physics): `ready` (`domain-behavior`)
  - `P14-S03` (Procedural Gaze Tracking & Cursor Reactions): `planned`
  - `P14-S04` (Activity Chains, Repetition Penalty & Zoomies Event): `planned`

---

## Активная очередь задач

### [TASK: P14-S02] — Drag & Throw Ballistics Physics
- **Статус:** `ready`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P14-S01`
- **Цель:** Реализовать в domain физику броска мышью: вычисление вектора скорости `(vx, vy)` при `dragEnd`, параболический полёт с гравитацией, отскок от границ экрана и разделение приземления на `soft_landing`, `stumble` (спотыкание) и `crash_landing` (плюхнулся) с фазой `recover`.
- **Читать:**
  - `.agents/agents/domain-behavior/agent.md` (ОБЯЗАТЕЛЬНО первой строкой: манифест роли)
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 1.2 «Физика перетаскивания и броска»)
  - `docs/engine/ANIMATION_ENGINE.md`
- **Менять:** `src/domain/behavior/` (модуль кинематики/физики), unit-тесты.
- **Критерии приёмки:**
  - [ ] Скорость `(vx, vy)` рассчитывается по истории последних точек перетаскивания (sliding window).
  - [ ] Симулируется баллистическая траектория с гравитацией, сопротивлением воздуха и отскоком от границ экрана.
  - [ ] Приземление на высокой скорости переводит персонажа в `crash_landing` / `recover`, на средней — в `stumble`, на низкой — в `soft_landing`.
  - [ ] Написаны unit-тесты на расчёт импульса, гравитацию и условия приземления.
  - [ ] `npm test && npm run typecheck` завершаются без ошибок.
- **Вне скоупа:** не трогать Renderer, не вызывать Electron window API напрямую из domain.

### [TASK: P14-S03] — Procedural Gaze Tracking & Cursor Reactions
- **Статус:** `planned`
- **Исполнитель:** `domain-behavior` + `app-developer`
- **Зависит от:** `P14-S01`, `P13-F04`
- **Цель:** Реализовать слежение зрачков за курсором (`lerp`, `dead_zone`) и анимацию попытки поймать курсор лапкой `swat_cursor`.
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 1.3 «Слежение за курсором»)
- **Менять:** `src/renderer/`, `src/domain/behavior/`, unit-тесты.
- **Критерии приёмки:**
  - [ ] Плавный поворот взгляда без дрожания.
  - [ ] `npm test && npm run typecheck` завершаются без ошибок.
- **Вне скоупа:** не менять FSM и контракты памяти.
