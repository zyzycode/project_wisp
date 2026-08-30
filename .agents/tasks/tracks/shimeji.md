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
- [x] **P14-A02:** Architectural Decision (ADR-014) & IPC Orchestration Spec for Main Physics Loop. (`done` / `architect`)
- [x] **P14-A02-REV:** Ревью-гейт архитектурной спецификации Main Physics Loop (`Approved`). (`done` / `reviewer`)
- [ ] **P14-G01:** Shimeji Motion Orchestrator & Main Physics Loop Migration. (`in_progress` / `app-developer`)

---

## 2. Подробные карточки задач

### [TASK: P14-G01] — Shimeji Motion Orchestrator & Main Physics Loop Migration
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-A02`, `P14-S01`..`P14-S05b`
- **Цель:** Реализовать `ShimejiMotionOrchestrator` и перенести физический цикл в Main согласно спецификации `docs/engine/SHIMEJI_SPEC.md` (Разделы 7–10):
  1. Создать сервис `ShimejiMotionOrchestrator` в Application слое (`src/application/services/`).
  2. Реализовать порт `PetPositionPort` и адаптер `ElectronPetPositionAdapter` в Infrastructure слое.
  3. Добавить DTO и типизированный IPC в `src/shared/ipc-contracts.ts` и `src/preload/`:
     - `beginPetDrag`, `movePetDrag`, `releasePetDrag`, `onPetPresentationState`.
  4. Запустить `fixed-step` физический цикл в Main с трансляцией `PetPresentationStateDTO`.
  5. Очистить `DesktopPet.tsx`: удалить локальный `MotionEngine`, `MotionState`, RAF loop, прямой вызов `setPosition`.
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md` (Разделы 7, 8, 9, 10)
  - `src/shared/ipc-contracts.ts`
- **Менять:** `src/application/`, `src/infrastructure/`, `src/main/`, `src/preload/`, `src/shared/`, `src/renderer/`, тесты.
- **Критерии приёмки:**
  - [ ] Main является единственным владельцем координат окна и физики.
  - [ ] Renderer работает только как презентационный View.
  - [ ] `npm test && npm run typecheck` проходят со 100% успехом.
