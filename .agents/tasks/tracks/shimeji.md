# Трек: Shimeji & Advanced Autonomy (Phase 14)

Файл бэклога поведения, локомоции, физики и автономии персонажа в стиле Desktop Pet (Shimeji).
Архитектурная спецификация: [`docs/engine/SHIMEJI_SPEC.md`](../../../docs/engine/SHIMEJI_SPEC.md)

---

## 1. Текущий статус

- [x] **P14-S01:** Расширение FSM новыми локомоциями (`sit`, `stand_up`, `lie_down`, `get_up`, `run`, `jump`, `fall`, `land`, `crawl`) и шкала `Needs.boredom`. (`done`)
- [x] **P14-S01-REV:** Ревью-гейт FSM локомоции и шкалы скуки. (`done`)
- [x] **P14-A01:** Архитектурная формализация Shimeji-движка и контрактов в `SHIMEJI_SPEC.md`. (`done` / `architect`)
- [ ] **P14-S02:** Физика перетаскивания и баллистика броска мышью. (`ready` / `domain-behavior`)
- [ ] **P14-S03:** Procedural Gaze Tracking и реакции на курсор (`lerp`, `dead_zone`, `swat_cursor`). (`planned`)
- [ ] **P14-S04:** Цепочки активностей (`ActivityChain`), `RepetitionPenalty` и ивент `Zoomies`. (`planned`)
- [ ] **P14-S05:** Взаимодействие с границами окон и панелью задач (лазание, свисание). (`planned`)
- [ ] **P14-G01:** Финальный интеграционный Review Gate Phase 14. (`planned`)

---

## 2. Подробные карточки задач

### [TASK: P14-S02] — Drag & Throw Ballistics Physics
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P14-A01`
- **Цель:** Реализовать в domain физику броска мышью: вектор скорости `(vx, vy)` при отпускании курсора, параболический полёт с гравитацией, отскок от границ экрана и разделение исходов на `soft_landing`, `stumble`, `crash_landing` и `recover`.
- **Читать:**
  - `.agents/agents/domain-behavior/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md` (Разделы 1-3: Kinematics, Ballistics & Landing)
- **Менять:** `src/domain/behavior/` (модули кинематики), unit-тесты.
- **Критерии приёмки:**
  - [ ] Скорость `(vx, vy)` рассчитывается по истории точек перетаскивания (sliding window).
  - [ ] Симулируется полёт с гравитацией, сопротивлением воздуха и упругим отскоком.
  - [ ] Приземление на высокой скорости даёт `crash_landing` -> `recover`, на средней — `stumble`, на низкой — `soft_landing`.
  - [ ] Все domain-тесты и typecheck проходят.
- **Вне скоупа:** не трогать Renderer и Electron API.

### [TASK: P14-S03] — Procedural Gaze Tracking & Cursor Reactions
- **Исполнитель:** `domain-behavior` + `app-developer`
- **Зависит от:** `P14-A01`, `P13-F04`
- **Цель:** Реализовать процедурное слежение взгляда за курсором мыши (расчет угла, сдвиг зрачков с `dead_zone` и `lerp`) и реакцию попытки поймать курсор `swat_cursor`.
- **Читать:**
  - `.agents/agents/domain-behavior/agent.md` (для математики)
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 4: Gaze Tracking & Reactions)
- **Менять:** `src/renderer/render-engine/`, `src/domain/behavior/`, unit-тесты.
- **Критерии приёмки:**
  - [ ] Плавный поворот зрачков без джиттера при движении мыши рядом с персонажем.
  - [ ] При приближении в упор срабатывает жест лапкой `swat_cursor`.

### [TASK: P14-S04] — Activity Chains, Penalty & Zoomies Event
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P14-S02`
- **Цель:** Иерархические цепочки поведения (подойти к краю -> сесть -> посмотреть), защита от повторения одних и тех же поз (`RepetitionPenalty`) и редкое событие `Zoomies` (безумный спринт с заносом).
- **Читать:**
  - `.agents/agents/domain-behavior/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 5 & 6: Activity Chains & Character Engine integration)
- **Менять:** `src/domain/behavior/`, unit-тесты.
