# Трек: Shimeji & Advanced Autonomy (Phase 14 / Stabilization & Polish)

Файл бэклога поведения, локомоции, физики, анимаций и UX персонажа на рабочем столе.
Архитектурная спецификация: [`docs/engine/SHIMEJI_SPEC.md`](../../../docs/engine/SHIMEJI_SPEC.md)
Спецификация рендера: [`docs/engine/RENDER_ENGINE.md`](../../../docs/engine/RENDER_ENGINE.md)

---

## 1. Текущий статус

- [x] **P14-S01..P14-S05b:** Архитектура, математика Shimeji, FSM, Gaze Engine, Surface Kinematics. (`done`)
- [x] **P14-G01 (a, b, c, REV):** Перенос физического цикла в Main Process и очистка Renderer. (`done`)
- [ ] **P14-P01:** Интеграция FSM с Renderer и управление взглядом. (`in_progress` / `app-developer`)
- [ ] **P14-P02:** Physics Calibration (гравитация, трение пола, отскоки и баллистика). (`pending` / `domain-behavior`)
- [ ] **P14-P03:** Dialogue & Speech Phrases Pool Expansion. (`pending` / `domain-behavior`)
- [ ] **P14-P04:** Context Menu UI/UX Redesign. (`pending` / `app-developer`)
- [ ] **P14-P-REV:** Shimeji Polish & Hands-On UX Review Gate. (`pending` / `reviewer`)

---

## 2. Подробные карточки задач стабилизации

### [TASK: P14-P01] — Интеграция FSM с Renderer и управление взглядом
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-G01c`
- **Цель:**
  1. Связать состояния движения и реакций FSM с зарегистрированными анимациями по таблице ниже. Пути, число кадров, FPS и режим совместимости брать из рабочего манифеста, не из каталога подготовки.
  2. Настроить композицию лица и anchors по render contract; не накладывать второе полное лицо на `baked_in`. Переключать дискретный `face_gaze` по положению курсора.
  3. Обеспечить покадровое воспроизведение (AnimationPlayer) по метаданным манифеста без фиксированной длины клипа.
- **Читать:**
  - `public/assets/sprites/manifest.json`
  - `docs/engine/RENDER_ENGINE.md`
  - `src/renderer/components/Character/`
  - `src/domain/behavior/animation-state-machine.ts` и `gaze-engine.ts`
- **Менять:** `src/renderer/components/Character/`, `src/renderer/components/DesktopPet.tsx`, `tests/renderer/`, `tests/domain/`.
- **Вне скоупа:** генерация, нарезка, центрирование и замена PNG. При необходимости регистрации новых ключей или изменения метаданных — отдельная карточка `app-developer`; не заменять рабочий манифест целиком предложением пайплайна и сохранять ручные метаданные. Изменения контракта сначала направлять `architect`.
- **Критерии приёмки (DoD):**
  - [ ] Все FSM-состояния воспроизводят правильные анимации тела из `manifest.json`.
  - [ ] Оверлей лица рендерится только на телах с режимом `overlay`.
  - [ ] Взгляд переключает кадры `face_gaze_00..03` при движении мыши: 0 влево, 1 вправо, 2 вверх, 3 вниз.
  - [ ] `npm test && npm run typecheck` проходят со 100% успехом.

#### Соответствия FSM → анимация для P14-P01

Таблица задаёт соответствия для реализации; она не подтверждает, что интеграция уже завершена.

| Состояние / алиасы | Ключ анимации в манифесте |
|---|---|
| `idle` / `rest` | `body_idle` |
| `walk` / `wander` | `body_walk` |
| `run` / `sprint` | `body_run` |
| `fall` / `falling` / `drop` | `body_fall` |
| `land` / `landing` | `body_land` |
| `crash` / `splat` / `crash_landing` | `body_crash_splat` |
| `sit` | `body_sit` |
| `stand_up` / `get_up` | `body_stand_up` |
| `lie` / `lie_down` | `body_lie` |
| `sleep_start` / `sleep_transition` | `body_sleep_trans` |
| `sleep` / `sleep_loop` | `body_sleep` |
| `climb_wall` | `body_climb_wall` |
| `ceiling_hang` / `hang_ceiling` | `body_ceiling_hang` |
| `jump` | `body_jump` |
| `petting` / `pet` | `body_petting` |
| `dragged` / `drag` | `body_dragged` |
| `wave` | `body_wave` |
| `celebrate` | `body_celebrate` |
| `scared` | `body_scared` |
| `bored` | `body_bored` |
| `thinking` | `body_thinking` |

---

### [TASK: P14-P02] — Physics Calibration & Motion Tuning
- **Исполнитель:** `domain-behavior` (или `app-developer`)
- **Зависит от:** `P14-P01`
- **Цель:** Откалибровать параметры физики в `DEFAULT_MOTION_CONSTRAINTS` (`src/domain/behavior/`):
  1. Настроить плавность и скорость падения (`gravityPxPerSec2`, `linearDampingYPerSec`).
  2. Настроить скольжение и трение по полу (`floorTangentialRetention`, `linearDampingXPerSec`).
  3. Откалибровать отскоки от стен (`wallRestitution`, `floorRestitution`) и пороги исходов (`softLandingMaxSeverity`, `stumbleMaxSeverity`).
  4. Протестировать приятность бросков и перемещения курсором.
- **Читать:** `docs/engine/SHIMEJI_SPEC.md` (Разделы 2, 2.1–2.3).
- **Менять:** `src/domain/behavior/motion-engine.ts` (или `src/domain/behavior/models.ts`), тесты.

---

### [TASK: P14-P03] — Dialogue & Speech Phrases Pool Expansion
- **Исполнитель:** `domain-behavior`
- **Зависит от:** none
- **Цель:** Существенно расширить пул текстовых реплик и мыслей персонажа.
- **Читать:** `docs/engine/BEHAVIOR_INTENTS.md`.

---

### [TASK: P14-P04] — Context Menu UI/UX Redesign
- **Исполнитель:** `app-developer`
- **Зависит от:** none
- **Цель:** Полный редизайн контекстного меню (ПКМ) в компактный и красивый Desktop Pet стиль.
- **Читать:** `docs/engine/RENDER_ENGINE.md`.
