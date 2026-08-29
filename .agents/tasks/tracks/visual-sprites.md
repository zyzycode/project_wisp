# Трек: Visual & Sprites (Track 13-F / Asset Pipeline)

Файл бэклога спрайтов, оверлея лиц, якорных точек (`anchors`/`pivot`) и генерации манифеста.
Архитектурная спецификация: [`docs/engine/RENDER_ENGINE.md`](../../../docs/engine/RENDER_ENGINE.md)

---

## 1. Текущий статус

- [x] **P13-F01:** Спецификация карты совместимости body/face и аудит манифеста. (`done`)
- [x] **P13-F02:** Offline Sprite Manifest Generator & Validator (`process_sprites.py`). (`done`)
- [x] **P13-F04:** Интеграция оверлея лиц и расчет смещения `anchors` в Renderer. (`done`)
- [x] **P13-F05:** Ревью-гейт интеграции оверлея лиц. (`done`)
- [ ] **P13-F03:** Отрисовка графических ассетов (прозрачные лица, новые позы тела, зрачки). (`ready` / `художник`)
- [ ] **P13-F06:** Sprite Ingestion & Manifest Bake (прогон скрипта и верификация в игре). (`planned` / `app-developer`)

---

## 2. Подробные карточки задач

### [TASK: P13-F03] — Face & Body Asset Preparation Pack
- **Исполнитель:** `художник`
- **Цель:** Отрисовать недостающие спрайты в формате PNG-32 с прозрачным фоном:
  - **Лица (`public/assets/sprites/faces/`):** `face_happy`, `face_sleepy`, `face_curious`, `face_thinking`, `face_surprised`, `face_dizzy`.
  - **Зрачки (`public/assets/sprites/faces/`):** `pupils_normal` (для gaze tracking).
  - **Позы тела (`public/assets/sprites/body/`):** `body_sit`, `body_stand_up`, `body_lie`, `body_jump_up`, `body_fall_down`, `body_land_impact`, `body_dragged_hang`, `body_crash_splat`, `body_recover`.
- **Критерии приёмки:**
  - [ ] Все спрайты лиц изолированы (нет тела и фона).
  - [ ] Единый размер холста и прозрачный фон (Alpha channel).
  - [ ] Нейминг строго в формате `snake_case_00.png`.

### [TASK: P13-F06] — Sprite Ingestion & Manifest Bake
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-F03`
- **Цель:** Прогнать скрипт `scripts/process_sprites.py` на новых спрайтах, запечь обновленный `manifest.json`, откалибровать координаты `anchors` для новых поз и убедиться в отсутствии визуальных артефактов.
- **Читать:**
  - `docs/engine/RENDER_ENGINE.md`
  - `scripts/process_sprites.py`
- **Критерии приёмки:**
  - [ ] Все новые PNG зарегистрированы в `public/assets/sprites/manifest.json`.
  - [ ] Тесты целостности манифеста `npm test` проходят без ошибок.
