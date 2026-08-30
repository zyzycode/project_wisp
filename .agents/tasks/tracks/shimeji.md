# Трек: Shimeji & Advanced Autonomy (Phase 14 / Stabilization & Polish)

Файл бэклога поведения, локомоции, физики, анимаций и UX персонажа на рабочем столе.
Архитектурная спецификация: [`docs/engine/SHIMEJI_SPEC.md`](../../../docs/engine/SHIMEJI_SPEC.md)
Спецификация рендера: [`docs/engine/RENDER_ENGINE.md`](../../../docs/engine/RENDER_ENGINE.md)

---

## 1. Текущий статус

- [x] **P14-S01..P14-S05b:** Архитектура, математика Shimeji, FSM, Gaze Engine, Surface Kinematics. (`done`)
- [x] **P14-G01 (a, b, c, REV):** Перенос физического цикла в Main Process и очистка Renderer. (`done`)
- [ ] **P14-P01:** Интеграция спрайтов из `manifest.json`, дискретный оверлей взгляда (`face_gaze`) и настройка рендерера. (`in_progress` / `app-developer`)
- [ ] **P14-P02:** Physics Calibration (гравитация, трение пола, отскоки и баллистика). (`pending` / `domain-behavior`)
- [ ] **P14-P03:** Dialogue & Speech Phrases Pool Expansion. (`pending` / `domain-behavior`)
- [ ] **P14-P04:** Context Menu UI/UX Redesign. (`pending` / `app-developer`)
- [ ] **P14-P-REV:** Shimeji Polish & Hands-On UX Review Gate. (`pending` / `reviewer`)

---

## 2. Подробные карточки задач стабилизации

### [TASK: P14-P01] — Интеграция спрайтов из manifest.json, дискретный оверлей взгляда (face_gaze) и настройка рендерера
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-G01c`
- **Цель:**
  1. **Связать FSM-состояния движения со спрайтами из manifest.json:**
     - `idle` / `rest` -> `body_idle` (8 кадров, overlay)
     - `walk` / `wander` -> `body_walk` (4 кадра, baked_in)
     - `run` / `sprint` -> `body_run` (4 кадра, baked_in)
     - `fall` / `falling` / `drop` -> `body_fall` (4 кадра, baked_in)
     - `land` / `landing` -> `body_land` (4 кадра, baked_in)
     - `crash` / `splat` / `crash_landing` -> `body_crash_splat` (8 кадров, baked_in)
     - `sit` -> `body_sit` (4 кадра, overlay)
     - `stand_up` / `get_up` -> `body_stand_up` (4 кадра, overlay)
     - `lie` / `lie_down` -> `body_lie` (4 кадра, overlay)
     - `sleep_start` / `sleep_transition` -> `body_sleep_trans` (4 кадра, baked_in)
     - `sleep` / `sleep_loop` -> `body_sleep` (4 кадра, baked_in)
     - `climb_wall` -> `body_climb_wall` (4 кадра, baked_in)
     - `ceiling_hang` / `hang_ceiling` -> `body_ceiling_hang` (4 кадра, baked_in)
     - `jump` -> `body_jump` (4 кадра, baked_in)
     - `petting` / `pet` -> `body_petting` (4 кадра, baked_in)
     - `dragged` / `drag` -> `body_dragged` (4 кадра, baked_in)
     - `wave` -> `body_wave` (4 кадра, baked_in)
     - `celebrate` -> `body_celebrate` (4 кадра, baked_in)
     - `scared` -> `body_scared` (4 кадра, baked_in)
     - `bored` -> `body_bored` (4 кадра, baked_in)
     - `thinking` -> `body_thinking` (4 кадра, baked_in)
  2. **Настроить оверлей лиц и дискретный взгляд (face_gaze):**
     - Проверять `manifest[bodyKey].faceOverlay.mode`: если `"overlay"` -> рендерить лицо, если `"baked_in"` -> не рендерить лицо.
     - Отключить процедурный слой отдельных зрачков (`pupils_*` / `pupilOffsetSourcePx`).
     - Использовать 4-кадровый `face_gaze` по положению курсора (Кадр 0: ←, Кадр 1: →, Кадр 2: ↑, Кадр 3: ↓/нейтрально).
     - Позиционировать лицо по `defaultAnchors.face` + компенсация покадрового смещения `frameMeta[frameIndex]?.anchors?.face`.
  3. **Покадровое воспроизведение (AnimationPlayer):**
     - Динамически определять длину из `framesCount` (4 и 8 кадров), цикл кадров с FPS из манифеста (по умолчанию 8 FPS).
- **Читать:**
  - `public/assets/sprites/manifest.json`
  - `docs/engine/RENDER_ENGINE.md`
  - `docs/AI_STUDIO_PROMPTS.md`
  - `src/renderer/components/Character/`
  - `src/domain/behavior/animation-state-machine.ts` и `gaze-engine.ts`
- **Менять:** `src/renderer/components/Character/`, `src/renderer/components/DesktopPet.tsx`, `tests/renderer/`, `tests/domain/`.
- **Критерии приёмки (DoD):**
  - [ ] Все FSM-состояния воспроизводят правильные анимации тела из `manifest.json`.
  - [ ] Оверлей лица рендерится только на телах с режимом `overlay`.
  - [ ] Взгляд переключает кадры `face_gaze_00..03` при движении мыши.
  - [ ] `npm test && npm run typecheck` проходят со 100% успехом.

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
