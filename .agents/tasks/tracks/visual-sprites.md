# Трек: Visual & Sprites (Track 13-F / Asset Pipeline)

Файл бэклога спрайтов, оверлея лиц, якорных точек (`anchors`/`pivot`) и генерации манифеста.
Архитектурная спецификация: [`docs/engine/RENDER_ENGINE.md`](../../../docs/engine/RENDER_ENGINE.md)
Промпты для генерации: [`docs/AI_STUDIO_PROMPTS.md`](../../../docs/AI_STUDIO_PROMPTS.md)

---

## 1. Текущий статус

- [x] **P13-F01:** Спецификация карты совместимости body/face и аудит манифеста. (`done`)
- [x] **P13-F02:** Offline Sprite Manifest Generator & Validator (`process_sprites.py`, `validate_manifest.py`). (`done`)
- [x] **P13-F04:** Интеграция оверлея лиц и расчет смещения `anchors` в Renderer. (`done`)
- [x] **P13-F05:** Ревью-гейт интеграции оверлея лиц. (`done`)
- [ ] **P13-F03a:** Лица и зрачки (Стандарт: 4 кадра `1x4`, оверлеи на прозрачном фоне `face_*` и `pupils_*`). (`in_progress` / `sprite-artist`)
- [ ] **P13-F03b:** Диалоговые безликие тела (`body_idle`, `body_sit`, `body_stand_up`) и новые физические Shimeji-позы с запечённым лицом. (`in_progress` / `sprite-artist`)
- [ ] **P13-F03c:** Реквизит, эффекты и очистка (`prop_pillow`, `prop_heart`, `prop_question`, `prop_sparkle`, чистка мусора). (`planned` / `sprite-artist`)
- [ ] **P13-F06:** Sprite Ingestion & Manifest Bake (прогон скрипта `process_sprites.py` и верификация). (`planned` / `app-developer`)

---

## 2. Подробные карточки задач

### [TASK: P13-F03a] — Face Overlay & Gaze Pupils Pack (4-Frame Standard)
- **Исполнитель:** `sprite-artist`
- **Зависит от:** none
- **Стандарт анимаций:** Минимум 4 кадра на анимацию (сетка `1x4` / `_00.png`..`_03.png`), прозрачный холст 512x512 PNG-32.
- **Цель:** Подготовить и сохранить изолированные PNG-32 спрайты эмоций и зрачков по 4 кадра в канонической структуре:
  1. **Лица (Эмоции):**
     - `public/assets/sprites/faces/curious/face_curious_00..03.png` (Любопытство)
     - `public/assets/sprites/faces/dizzy/face_dizzy_00..03.png` (Головокружение: спиральки `@_@` / `x_x`)
     - `public/assets/sprites/faces/shocked/face_shocked_00..03.png` (Удивление/шок: `O_O`)
     - `public/assets/sprites/faces/flirty/face_flirty_00..03.png` (Смущение/флирт: `>///<`)
     - `public/assets/sprites/faces/winking/face_winking_00..03.png` (Подмигивание `^_-`)
     - `public/assets/sprites/faces/pout/face_pout_00..03.png` (Обида/надутые щёчки `3: `)
     - `public/assets/sprites/faces/blink/face_blink_00..03.png` (Моргание)
     - `public/assets/sprites/faces/smug/face_smug_00..03.png` (Ухмылка)
     - `public/assets/sprites/faces/crying/face_crying_00..03.png` (Слёзки)
     - `face_happy`, `face_sad`, `face_angry`, `face_sleep`, `face_thinking`, `face_talking`.
  2. **Слой зрачков для Gaze Tracking:**
     - `public/assets/sprites/faces/pupils/pupils_normal_00..03.png` (Центральный взгляд)
     - `public/assets/sprites/faces/pupils/pupils_directional_00..03.png` (Направленный: L, R, U, D).
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Разделы 1.1, 1.5, 1.7, 2)
  - `docs/AI_STUDIO_PROMPTS.md` (Раздел Блок 2)
- **Менять:** `public/assets/sprites/faces/`
- **Критерии приёмки:**
  - [ ] Все спрайты изолированы (только лицо/глаза/зрачки на прозрачном холсте 512x512).
  - [ ] Каждая анимация содержит ровно 4 кадра (`_00.png`..`_03.png`).
  - [ ] Файлы названы строго по шаблону `public/assets/sprites/faces/<эмоция>/face_<эмоция>_00..03.png` и `public/assets/sprites/faces/pupils/pupils_normal_00..03.png`.

### [TASK: P13-F03b] — Faceless Dialog Bodies & Baked-in Shimeji Actions (4+ Frame Standard)
- **Исполнитель:** `sprite-artist`
- **Зависит от:** none
- **Стандарт анимаций:** Минимум 4 кадра на анимацию (сетка `1x4` / `_00.png`..`_03.png`, `2x4` для `body_idle`), холст 512x512 PNG-32.
- **Главное архитектурное правило:**
  - **Диалоговые позы (`overlay`):** `body_idle` (8 кадров), `body_sit` (4 кадра), `body_stand_up` (4 кадра) — выполняются **БЕЗ ЛИЦА** (чистая кожа) для наложения эмоций, моргания и взгляда за курсором.
  - **Контекстные, кинематические и эмоциональные позы (`baked_in`):** `body_petting`, `body_wave`, `body_bored`, `body_scared`, `body_celebrate`, `body_thinking`, `body_sleep`, `body_sleep_trans`, `body_dragged`, `body_walk`, `body_run`, `body_lie`, `body_fall`, `body_land`, `body_recover`, `body_climb_wall`, `body_ceiling_hang`, `body_jump`, `body_crash_splat` — выполняются **С ГОТОВЫМ ЗАПЕЧЁННЫМ ЛИЦОМ**.
- **Цель:**
  1. **Сгенерировать диалоговые позы БЕЗ ЛИЦА (`overlay`):**
     - `body_idle` (8 кадров `2x4`)
     - `body_sit`, `body_stand_up` (по 4 кадра `1x4`).
  2. **Отрисовать недостающие позы Shimeji С ГОТОВЫМ ЛИЦОМ (`baked_in`):**
     - `body_lie`, `body_run`, `body_fall`, `body_crash_splat`, `body_recover`, `body_climb_wall`, `body_ceiling_hang`, `body_jump` (по 4 кадра `1x4`).
  3. **Сохранить готовые позы на диске с запечённым лицом:**
     - `body_petting`, `body_wave`, `body_bored`, `body_land`, `body_dragged`, `body_walk`, `body_thinking`, `body_sleep`, `body_sleep_trans`, `body_celebrate`, `body_scared`.
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Разделы 1.5, 1.6, 1.7)
  - `docs/AI_STUDIO_PROMPTS.md` (Раздел Блок 1)
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 1: Kinematics & States)
- **Менять:** `public/assets/sprites/body/`
- **Критерии приёмки:**
  - [ ] Диалоговые спрайты тела (`idle`, `sit`, `stand_up`) выполнены с чистой кожей в области лица.
  - [ ] Кинематические и физические позы выполнены с выразительными готовыми лицами.
  - [ ] Каждая анимация содержит минимум 4 кадра с единым pivot по низу персонажа.
  - [ ] Файлы распределены по папкам `public/assets/sprites/body/<поза>/body_<поза>_00..03.png`.

### [TASK: P13-F03c] — Props, FX & Sprite Tree Cleanup
- **Исполнитель:** `sprite-artist`
- **Зависит от:** `P13-F03a`
- **Цель:** Создать спрайты реквизита (`prop_pillow`, `prop_heart`, `prop_question`, `prop_sparkle` в `public/assets/sprites/props/`) и переименовать/интегрировать оставшиеся пользовательские PNG.
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Раздел 2: Layer Ordering & Blend)
  - `docs/AI_STUDIO_PROMPTS.md` (Раздел Блок 3)
- **Менять:** `public/assets/sprites/props/`, `public/assets/sprites/`

### [TASK: P13-F06] — Sprite Ingestion & Manifest Bake
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-F03a`, `P13-F03b`
- **Цель:** Прогнать скрипт `scripts/process_sprites.py` на новых спрайтах, запечь обновленный `manifest.json`, откалибровать координаты `anchors` и проверить целостность через `npm test`.
