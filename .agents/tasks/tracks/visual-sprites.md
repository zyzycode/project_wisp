# Трек: Visual & Sprites (Track 13-F / Asset Pipeline)

Файл бэклога спрайтов, оверлея лиц, якорных точек (`anchors`/`pivot`) и генерации манифеста.
Архитектурная спецификация: [`docs/engine/RENDER_ENGINE.md`](../../../docs/engine/RENDER_ENGINE.md)

---

## 1. Текущий статус

- [x] **P13-F01:** Спецификация карты совместимости body/face и аудит манифеста. (`done`)
- [x] **P13-F02:** Offline Sprite Manifest Generator & Validator (`process_sprites.py`, `validate_manifest.py`). (`done`)
- [x] **P13-F04:** Интеграция оверлея лиц и расчет смещения `anchors` в Renderer. (`done`)
- [x] **P13-F05:** Ревью-гейт интеграции оверлея лиц. (`done`)
- [ ] **P13-F03a:** Лица и зрачки (Стандарт: 4 кадра `1x4`, `face_curious`, `face_dizzy`, `face_shocked`, `face_flirty`, `face_winking`, `face_pout`, `pupils_normal`). (`in_progress` / `sprite-artist`)
- [ ] **P13-F03b:** Базовые Shimeji-позы (Стандарт: 4 кадра `1x4`, `body_sit`, `body_stand_up`, `body_lie`, `body_run`, `body_fall`, `body_crash_splat`, `body_recover`). (`ready` / `sprite-artist`)
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
     - `public/assets/sprites/faces/curious/face_curious_00..03.png` (Любопытство: приподнятая бровь/широкие глазки)
     - `public/assets/sprites/faces/dizzy/face_dizzy_00..03.png` (Головокружение: спиральки `@_@` или крестики `x_x`)
     - `public/assets/sprites/faces/shocked/face_shocked_00..03.png` (Удивление/шок: круглые глаза `O_O` и приоткрытый рот)
     - `public/assets/sprites/faces/flirty/face_flirty_00..03.png` (Смущение/флирт: милое выражение лица `>///<`; румянец на щёчках также поддерживается процедурным слоем `procedural_blush`)
     - `public/assets/sprites/faces/winking/face_winking_00..03.png` (Подмигивание `^_-`)
     - `public/assets/sprites/faces/pout/face_pout_00..03.png` (Обида/надутые щёчки `3: `)
  2. **Слой зрачков для Gaze Tracking:**
     - `public/assets/sprites/faces/pupils/pupils_normal_00..03.png` (Изолированные зрачки без склер и век для свободного смещения движком взгляда).
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Разделы 1.1, 1.5, 2)
- **Менять:** `public/assets/sprites/faces/`
- **Критерии приёмки:**
  - [ ] Все спрайты изолированы (только лицо/глаза/зрачки на прозрачном холсте 512x512).
  - [ ] Каждая анимация содержит минимум 4 кадра (`_00.png`..`_03.png`).
  - [ ] Файлы названы строго по шаблону `public/assets/sprites/faces/<эмоция>/face_<эмоция>_00..03.png` и `public/assets/sprites/faces/pupils/pupils_normal_00..03.png`.
- **Вне скоупа:** Не менять TypeScript-код (`src/`), не запускать генерацию манифеста (будет сделано в `P13-F06`).

### [TASK: P13-F03b] — Shimeji Body Locomotion & Physics Poses (4-Frame Standard)
- **Исполнитель:** `sprite-artist`
- **Зависит от:** none
- **Стандарт анимаций:** Минимум 4 кадра на анимацию (сетка `1x4` / `_00.png`..`_03.png`), холст 512x512 PNG-32.
- **Цель:** Отрисовать новые позы тела для FSM Shimeji по 4 кадра: `body_sit`, `body_stand_up`, `body_lie`, `body_run`, `body_fall`, `body_crash_splat`, `body_recover` (без запеченных лиц либо с нейтральным силуэтом).
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Разделы 1.5, 1.6)
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 1: Kinematics & States)
- **Менять:** `public/assets/sprites/body/`
- **Критерии приёмки:**
  - [ ] Каждая анимация содержит минимум 4 кадра с единым pivot по низу персонажа.
  - [ ] Файлы распределены по папкам `public/assets/sprites/body/<поза>/body_<поза>_00..03.png`.

### [TASK: P13-F03c] — Props, FX & Sprite Tree Cleanup
- **Исполнитель:** `sprite-artist`
- **Зависит от:** `P13-F03a`
- **Цель:** Создать спрайты реквизита (`prop_pillow`, `prop_heart`, `prop_question`, `prop_sparkle` в `public/assets/sprites/props/`) и удалить временные папки (`body/idle/delete_me/`, `custom/растерянность/`).
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Раздел 2: Layer Ordering & Blend)
- **Менять:** `public/assets/sprites/props/`, `public/assets/sprites/`
- **Критерии приёмки:**
  - [ ] Созданы 4 набора реквизита на прозрачном фоне.
  - [ ] В `public/assets/` нет кириллических имен и временных скриптов `delete_me`.

### [TASK: P13-F06] — Sprite Ingestion & Manifest Bake
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-F03a`, `P13-F03b`
- **Цель:** Прогнать скрипт `scripts/process_sprites.py` на новых спрайтах, запечь обновленный `manifest.json`, откалибровать координаты `anchors` и проверить целостность через `npm test`.
