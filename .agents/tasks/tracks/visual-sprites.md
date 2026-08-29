# Трек: Visual & Sprites (Track 13-F / Asset Pipeline)

Файл бэклога спрайтов, оверлея лиц, якорных точек (`anchors`/`pivot`) и генерации манифеста.
Архитектурная спецификация: [`docs/engine/RENDER_ENGINE.md`](../../../docs/engine/RENDER_ENGINE.md)

---

## 1. Текущий статус

- [x] **P13-F01:** Спецификация карты совместимости body/face и аудит манифеста. (`done`)
- [x] **P13-F02:** Offline Sprite Manifest Generator & Validator (`process_sprites.py`). (`done`)
- [x] **P13-F04:** Интеграция оверлея лиц и расчет смещения `anchors` в Renderer. (`done`)
- [x] **P13-F05:** Ревью-гейт интеграции оверлея лиц. (`done`)
- [ ] **P13-F03a:** Лица и зрачки (`face_curious`, `face_dizzy`, `face_surprised`, `face_blush`, `face_winking`, `face_pout`, `pupils_normal`). (`ready` / `sprite-artist`)
- [ ] **P13-F03b:** Базовые Shimeji-позы (`body_sit`, `body_stand_up`, `body_lie`, `body_run`, `body_fall`, `body_crash_splat`, `body_recover`). (`ready` / `sprite-artist`)
- [ ] **P13-F03c:** Реквизит, эффекты и очистка (`prop_pillow`, `prop_heart`, `prop_question`, `prop_sparkle`, чистка мусора). (`planned` / `sprite-artist`)
- [ ] **P13-F06:** Sprite Ingestion & Manifest Bake (прогон скрипта `process_sprites.py` и верификация). (`planned` / `app-developer`)

---

## 2. Подробные карточки задач

### [TASK: P13-F03a] — Face Overlay & Gaze Pupils Pack
- **Исполнитель:** `sprite-artist`
- **Зависит от:** none
- **Цель:** Отрисовать недостающие спрайты эмоций и зрачков в формате PNG-32 с прозрачным фоном: `face_curious`, `face_dizzy`, `face_surprised`, `face_blush`, `face_winking`, `face_pout`, `pupils_normal`.
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Раздел 1: Manifest & Asset Metadata)
- **Менять:** `public/assets/sprites/faces/`
- **Критерии приёмки:**
  - [ ] Все спрайты изолированы (только лицо/глаза/зрачки на прозрачном холсте 512x512).
  - [ ] Файлы названы строго по шаблону `public/assets/sprites/faces/<эмоция>/face_<эмоция>_00.png`.
  - [ ] Для gaze tracking подготовлен отдельный спрайт зрачков `pupils_normal_00.png`.

### [TASK: P13-F03b] — Shimeji Body Locomotion & Physics Poses
- **Исполнитель:** `sprite-artist`
- **Зависит от:** none
- **Цель:** Отрисовать новые позы тела для FSM Shimeji: `body_sit`, `body_stand_up`, `body_lie`, `body_run`, `body_fall`, `body_crash_splat`, `body_recover` (без запеченных лиц либо с нейтральным силуэтом).
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Разделы 1.5, 1.6)
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 1: Kinematics & States)
- **Менять:** `public/assets/sprites/body/`
- **Критерии приёмки:**
  - [ ] Каждая анимация содержит от 2 до 4 кадров с единым pivot по низу персонажа.
  - [ ] Файлы распределены по папкам `public/assets/sprites/body/<поза>/body_<поза>_00.png`.

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
