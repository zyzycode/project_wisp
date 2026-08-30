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
- [x] **P14-S03a:** Gaze & Cursor Proximity Math (`GazeEngine`, `CursorProximityEngine`). (`done` / `domain-behavior`)
- [x] **P14-S03a-REV:** Ревью-гейт математики взгляда и реакции на мышь (`Approved`). (`done` / `reviewer`)
- [x] **P14-S05b:** Platform Environment Adapter & WorkArea Provider. (`done` / `app-developer`)
- [x] **P14-S05b-REV:** Ревью-гейт адаптера окружения и IPC-провайдера рабочей области (`Approved`). (`done` / `reviewer`)
- [x] **P14-S03b:** Renderer Gaze Layer Compositor (позиционирование зрачков поверх лица). (`done` / `app-developer`)
- [x] **P14-S03b-REV:** Ревью-гейт композера слоя зрачков и взгляда (`Approved`). (`done` / `reviewer`)
- [ ] **P14-A02:** Architectural Decision & IPC Orchestration Spec for Main Physics Loop. (`in_progress` / `architect`)
- [ ] **P14-G01:** Shimeji Motion Orchestrator & Main Physics Loop Migration. (`planned` / `app-developer`)

---

## 2. Подробные карточки задач

### [TASK: P14-A02] — Architectural Decision & IPC Orchestration Spec for Main Physics Loop
- **Исполнитель:** `architect`
- **Зависит от:** `P14-S01`..`P14-S05b`
- **Цель:**
  1. Дать окончательное архитектурное заключение (ADR) по вопросу сторонних игровых/физических движков (Matter.js, PixiJS, Godot и т.д.) в контексте легковесного Desktop Pet.
  2. Детально специфицировать контракт и схему `ShimejiMotionOrchestrator` в Application/Main слое, typed IPC поток презентации и разделение обязанностей между Main и Renderer.
- **Читать:**
  - `.agents/agents/architect/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md`
  - `docs/engine/CHARACTER_ENGINE.md`
  - `src/shared/ipc-contracts.ts`
- **Менять:** `docs/engine/SHIMEJI_SPEC.md`, `docs/engine/ARCHITECTURE.md` (или соответствующий ADR).
