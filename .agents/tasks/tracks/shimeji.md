# Трек: Shimeji & Advanced Autonomy (Phase 14)

Файл бэклога поведения, локомоции, физики и автономии персонажа в стиле Desktop Pet (Shimeji).
Архитектурная спецификация: [`docs/engine/SHIMEJI_SPEC.md`](../../../docs/engine/SHIMEJI_SPEC.md)

---

## 1. Текущий статус

- [x] **P14-S01:** Расширение FSM новыми локомоциями (`sit`, `stand_up`, `lie_down`, `get_up`, `run`, `jump`, `fall`, `land`, `crawl`) и шкала `Needs.boredom`. (`done`)
- [x] **P14-S01-REV:** Ревью-гейт FSM локомоции и шкалы скуки. (`done`)
- [x] **P14-A01:** Архитектурная формализация Shimeji-движка и контрактов в `SHIMEJI_SPEC.md`. (`done` / `architect`)
- [x] **P14-S02:** Физика перетаскивания и баллистика броска мышью (`MotionEngine`). (`done` / `domain-behavior`)
- [x] **P14-S02-REV:** Ревью-гейт кинематики броска и баллистики (`Approved`). (`done` / `reviewer`)
- [x] **P14-S04:** Цепочки активностей (`ActivityChain`), `RepetitionPenalty` и ивент `Zoomies`. (`done` / `domain-behavior`)
- [x] **P14-S04-REV:** Ревью-гейт цепочек активностей, штрафов повторов и зумис (`Approved`). (`done` / `reviewer`)
- [ ] **P14-S03:** Procedural Gaze Tracking и реакции на курсор (`lerp`, `dead_zone`, `swat_cursor`). (`ready` / `domain-behavior` + `app-developer`)
- [ ] **P14-S05:** Взаимодействие с границами окон и панелью задач (лазание, свисание). (`planned`)
- [ ] **P14-G01:** Финальный интеграционный Review Gate Phase 14. (`planned`)

---

## 2. Подробные карточки задач

### [TASK: P14-S03] — Procedural Gaze Tracking & Cursor Reactions
- **Исполнитель:** `domain-behavior` + `app-developer`
- **Зависит от:** `P14-S02`, `P13-F04`
- **Цель:** Реализовать процедурное слежение взгляда за курсором мыши (расчет угла, сдвиг зрачков с `dead_zone` и `lerp`) и реакцию попытки поймать курсор `swat_cursor`.
- **Читать:**
  - `.agents/agents/domain-behavior/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 4: Gaze Tracking & Reactions)
- **Менять:** `src/renderer/render-engine/`, `src/domain/behavior/`, unit-тесты.
- **Критерии приёмки:**
  - [ ] Плавный расчет смещения зрачков без джиттера.
  - [ ] Реакция `swat_cursor` при близком наведении мыши.
  - [ ] `npm test && npm run typecheck` проходят без ошибок.

### [TASK: P14-S05] — Environment Snapshots & Window Boundaries Interaction
- **Исполнитель:** `domain-behavior` + `app-developer`
- **Зависит от:** `P14-S04`
- **Цель:** Поддержка взаимодействия с границами окон и панелью задач (лазание по бокам, свисание с верхней границы) через `EnvironmentSnapshot`.
- **Читать:**
  - `.agents/agents/domain-behavior/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 5: Environment & Surfaces)
- **Менять:** `src/domain/behavior/`, `src/infrastructure/platform/`, unit-тесты.
