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
- [x] **P14-S05a:** Domain Surface Kinematics & Climbing FSM (лазание по бокам, свисание). (`done` / `domain-behavior`)
- [x] **P14-S05a-REV:** Ревью-гейт кинематики поверхностей и FSM лазания (`Approved`). (`done` / `reviewer`)
- [ ] **P14-S03a:** Gaze & Cursor Proximity Math (`GazeEngine`, `CursorProximityEngine`). (`ready` / `domain-behavior`)
- [ ] **P14-S03b:** Renderer Gaze Layer Compositor (позиционирование зрачков поверх лица). (`planned` / `app-developer`)
- [ ] **P14-S05b:** Platform Environment Adapter & WorkArea Provider. (`ready` / `app-developer`)
- [ ] **P14-G01:** Финальный интеграционный Review Gate Phase 14. (`planned`)

---

## 2. Подробные карточки задач

### [TASK: P14-S03a] — Gaze & Cursor Proximity Math Engine
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P14-S02`
- **Цель:** Реализовать чистую доменную математику слежения за курсором (`GazeEngine`) и расчета дистанции/срабатывания реакции (`CursorProximityEngine`):
  - Расчет вектора взгляда с учетом `dead_zone`, `scale`, `flipX` и экспоненциального сглаживания (`lerp`/`smoothingTimeSec`).
  - Расчет времени нахождения мыши в радиусе (`dwellWithinSwatRangeMs`) и генерация сигнала готовности `swat_cursor`.
- **Читать:**
  - `.agents/agents/domain-behavior/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 5: Gaze, cursor и environment)
- **Менять:** `src/domain/behavior/`, `tests/domain/`.
- **Критерии приёмки:**
  - [ ] Чистый TypeScript без DOM/Electron.
  - [ ] Плавный возврат в нейтральное положение при уходе курсора за радиус внимания.
  - [ ] 100% покрытие unit-тестами.

### [TASK: P14-S05b] — Platform Environment Adapter & WorkArea Provider
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-S05a`
- **Цель:** Реализовать сбор `EnvironmentSnapshot` в infrastructure слое (через Electron `screen.getPrimaryDisplay().workArea` и детекцию границ окон), передачу через IPC в Renderer/Application orchestrator.
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `src/infrastructure/platform/`
  - `src/shared/ipc-contracts.ts`
- **Менять:** `src/infrastructure/platform/`, `src/main/`, `src/preload/`, тесты.

### [TASK: P14-S03b] — Renderer Gaze Layer Compositor
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-S03a`, `P13-F03a`
- **Цель:** Подключить слой зрачков `pupils_normal` в композер рендерера (`CharacterRenderer.tsx`):
  - Смещение зрачков по координатам `pupilOffset` от `GazeEngine`.
  - Трекинг глобальных координат курсора в Renderer и проброс в движок.
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Разделы 1.5, 2.1)
- **Менять:** `src/renderer/`, тесты в `tests/renderer/`.
