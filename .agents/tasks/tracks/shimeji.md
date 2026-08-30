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
- [ ] **P14-S03b:** Renderer Gaze Layer Compositor (позиционирование зрачков поверх лица). (`ready` / `app-developer`)
- [ ] **P14-G01:** Финальный интеграционный Review Gate Phase 14. (`planned`)

---

## 2. Подробные карточки задач

### [TASK: P14-S03b] — Renderer Gaze Layer Compositor
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-S03a`, `P13-F03a`
- **Цель:** Подключить слой зрачков `pupils_normal` в композер рендерера (`CharacterRenderer.tsx`):
  - Смещение зрачков по координатам `pupilOffset` от `GazeEngine`.
  - Трекинг глобальных координат курсора в Renderer и проброс в движок.
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Разделы 1.5, 2.1)
  - `src/domain/behavior/gaze-engine.ts`
- **Менять:** `src/renderer/`, тесты в `tests/renderer/`.
- **Критерии приёмки:**
  - [ ] Зрачки плавно смещаются за курсором в реальном времени.
  - [ ] Автоматический возврат в центр при выходе за радиус внимания.
  - [ ] `npm test && npm run typecheck` проходят без ошибок.
