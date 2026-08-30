# Трек: Visual & Sprites (Track 13-F / Asset Pipeline)

Файл бэклога спрайтов, оверлея лиц, якорных точек (`anchors`/`pivot`) и генерации манифеста.
Архитектурная спецификация: [`docs/engine/RENDER_ENGINE.md`](../../../docs/engine/RENDER_ENGINE.md)
Промпты для генерации: [`docs/AI_STUDIO_PROMPTS.md`](../../../docs/AI_STUDIO_PROMPTS.md)

---

## 1. Текущий статус

- [x] **P13-F01:** Спецификация карты совместимости body/face и аудит манифеста. (`done`)
- [x] **P13-F02:** Offline Sprite Manifest Generator & Validator (`process_sprites.py`, `validate_manifest.py`). (`done`)
- [x] **P13-F04:** Интеграция оверлея лиц и расчёт смещения `anchors` в Renderer. (`done`)
- [x] **P13-F05:** Ревью-гейт интеграции оверлея лиц. (`done`)
- [x] **P13-F03b:** Генерация диалоговых безликих тел (`body_idle`, `body_sit`, `body_stand_up`, `body_lie`) и физических Shimeji-поз (`body_crash_splat` 8 кадров, `body_run`, `body_fall`, `body_climb_wall`, `body_ceiling_hang`, `body_jump`). (`done`)
- [x] **P13-F06:** Sprite Ingestion & Manifest Bake (нарезка всех новых листов скриптом `process_sprites.py`, запекание `manifest.json`, генерация GIF-превью и верификация тестов: 262/262 passed). (`done`)
- [ ] **P13-F03a:** Лица и направление взгляда (Стандарт: 4 кадра `1x4`, оверлеи на прозрачном фоне `face_*` и `pupils_*`). Основной набор готов; в процессе: расширенные эмоции и направленный взгляд `face_gaze`. (`in_progress` / `sprite-artist`)
- [ ] **P13-F03c:** Реквизит, эффекты и очистка (`prop_pillow`, `prop_heart`, `prop_question`, `prop_sparkle`, чистка мусора). (`planned` / `sprite-artist`)

> [!NOTE]
> **Статус анимаций персонажа:**
> - **Основные анимации полностью готовы и запечены (34 анимации):** все ключевые позы тела (idle, sit, lie, stand up, get up), все физические движения (fall, run, jump, crash splat, climb wall, ceiling hang), базовый процедурный слой зрачков `pupils_normal`.
> - **В доработке:** расширенная палитра эмоций лица (`face_*`) и направленный взгляд лица `face_gaze` (4 направления: L, R, U, D).

---

## 2. Подробные карточки задач

### [TASK: P13-F03a] — Face Overlay & Directional Gaze Pack (4-Frame Standard)
- **Исполнитель:** `sprite-artist`
- **Зависит от:** none
- **Стандарт анимаций:** Минимум 4 кадра на анимацию (сетка `1x4` / `_00.png`..`_03.png`), прозрачный холст 512x512 PNG-32.
- **Цель:** Подготовить и сохранить изолированные PNG-32 спрайты эмоций и оверлеев взгляда по 4 кадра в канонической структуре:
  1. **Лица (Эмоции & Взгляд):**
     - `public/assets/sprites/faces/curious/face_curious_00..03.png` (Любопытство)
     - `public/assets/sprites/faces/dizzy/face_dizzy_00..03.png` (Головокружение: спиральки `@_@` / `x_x`)
     - `public/assets/sprites/faces/shocked/face_shocked_00..03.png` (Удивление/шок: `O_O`)
     - `public/assets/sprites/faces/flirty/face_flirty_00..03.png` (Смущение/флирт: `>///<`)
     - `public/assets/sprites/faces/winking/face_winking_00..03.png` (Подмигивание `^_-`)
     - `public/assets/sprites/faces/pout/face_pout_00..03.png` (Обида/надутые щёчки `3: `)
     - `public/assets/sprites/faces/blink/face_blink_00..03.png` (Моргание)
     - `public/assets/sprites/faces/smug/face_smug_00..03.png` (Ухмылка)
     - `public/assets/sprites/faces/crying/face_crying_00..03.png` (Слёзки)
     - `public/assets/sprites/faces/gaze/face_gaze_00..03.png` (Направленный взгляд: L, R, U, D)
     - `face_happy`, `face_sad`, `face_angry`, `face_sleep`, `face_thinking`, `face_talking`.
  2. **Слой зрачков для базового трекинга:**
     - `public/assets/sprites/faces/pupils/pupils_normal_00..03.png` (Центральный взгляд) — *готов и запечен*
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Разделы 1.1, 1.5, 1.7, 2)
  - `docs/AI_STUDIO_PROMPTS.md` (Раздел Блок 2)
- **Менять:** `public/assets/sprites/faces/`

### [TASK: P13-F03b] — Faceless Dialog Bodies & Baked-in Shimeji Actions (4/8 Frame Standard)
- **Исполнитель:** `sprite-artist`
- **Зависит от:** none
- **Статус:** `done` (все тела нарезаны и запечены в `public/assets/sprites/body/`)

### [TASK: P13-F06] — Sprite Ingestion & Manifest Bake
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-F03a`, `P13-F03b`
- **Статус:** `done` (обработано 36 листов, 34 анимации зарегистрированы, 35 GIF-превью сгенерированы, тесты 262/262 passed).
