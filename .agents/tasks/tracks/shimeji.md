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
- [ ] **P14-G01:** Финальный интеграционный Review Gate Phase 14. (`ready` / `reviewer`)

---

## 2. Подробные карточки задач

### [TASK: P14-G01] — Final Integration Review Gate Phase 14 (Shimeji & Autonomy)
- **Исполнитель:** `reviewer`
- **Зависит от:** `P14-S01`..`P14-S05b`
- **Цель:** Сквозная верификация всей Phase 14: кинематики броска, физики гравитации/отскока, зацепления за стены/потолок, срыва `support_lost`, процедурного взгляда (`GazeEngine`), цепочек активностей (`ActivityRunner`), штрафов повторов и зумис.
- **Читать:**
  - `.agents/agents/reviewer/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md`
  - `docs/engine/RENDER_ENGINE.md`
  - `src/domain/behavior/`
  - `src/infrastructure/platform/`
  - `src/renderer/`
- **Критерии приёмки:**
  - [ ] Чистая изоляция: Domain не импортирует React/Electron/DOM/Node.
  - [ ] Renderer и Infrastructure строго соблюдают архитектурные границы и типизацию IPC.
  - [ ] Все тесты кодовой базы (`npm test`) и тайпчек (`npm run typecheck`) проходят на 100%.
