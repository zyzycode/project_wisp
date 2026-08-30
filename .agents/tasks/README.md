# .agents/tasks/README.md — Доска активного спринта Project Wisp

Этот файл — **командный пульт текущего спринта**.
Он содержит только активные задачи (3–5 карточек) прямо сейчас.

---

## 🗺️ Тематические треки бэклога

Все детальные задачи, ТЗ и чеклисты декомпозированы по специализированным трекам:

| Трек | Файл | Направление |
|---|---|---|
| 🐾 **Shimeji & Autonomy** | [`tracks/shimeji.md`](./tracks/shimeji.md) | Локомоция, баллистика бросков, слежение за мышью, зумис |
| 🎨 **Visual & Sprites** | [`tracks/visual-sprites.md`](./tracks/visual-sprites.md) | ТЗ художника, оверлей лиц, анкоры, генерация манифеста |
| 🖥️ **UI & Desktop** | [`tracks/ui-desktop.md`](./tracks/ui-desktop.md) | Контекстное меню, чат-облачко, инспектор анимаций в Debug HUD |
| 🧠 **Memory & AI** | [`tracks/memory-ai.md`](./tracks/memory-ai.md) | SQLite память, диалоги, факты, AI-провайдеры |

---

## 🚦 Правила передачи задач агентам

1. Агенту в prompt передаётся **только одна изолированная карточка**.
2. Первая строка в `Читать:` — всегда `.agents/agents/<роль>/agent.md`.
3. Агент читает **только** свой файл трека и релевантный `docs/engine/*.md`.

---

## 🔥 Активная очередь спринта (В работе и следующие)

### [TASK: P13-F03a] — Face Overlay & Gaze Pupils Pack
- **Статус:** `in_progress`
- **Исполнитель:** `sprite-artist`
- **Трек:** [`tracks/visual-sprites.md`](./tracks/visual-sprites.md)
- **Цель:** Отрисовка недостающих PNG лиц (`face_curious`, `face_dizzy`, `face_surprised`, `face_blush`, `face_winking`, `face_pout`) и отдельного спрайта зрачков (`pupils_normal`) для оверлея и Gaze Tracking.
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Раздел 1: Manifest & Asset Metadata)
- **Менять:** `public/assets/sprites/faces/`

---

### [TASK: P14-S03a] — Gaze & Cursor Proximity Math Engine
- **Статус:** `ready`
- **Исполнитель:** `domain-behavior`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Реализовать в чистом Domain слое `GazeEngine` (сглаженное слежение зрачками за курсором) и `CursorProximityEngine` (dwell-таймер и готовность реакции `swat_cursor`).
- **Читать:**
  - `.agents/agents/domain-behavior/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 5: Gaze, cursor и environment)
- **Менять:** `src/domain/behavior/`, `tests/domain/`.
- **Критерии приёмки:**
  - [ ] Чистый TypeScript без DOM/Electron.
  - [ ] Плавный расчет смещения зрачков без джиттера.
  - [ ] `npm test && npm run typecheck` проходят без ошибок.

---

### [TASK: P14-S05b] — Platform Environment Adapter & WorkArea Provider
- **Статус:** `ready`
- **Исполнитель:** `app-developer`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Реализовать сбор `EnvironmentSnapshot` в infrastructure слое (через Electron `screen.getPrimaryDisplay().workArea` и границы окон) и проброс через IPC.
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `src/infrastructure/platform/`
  - `src/shared/ipc-contracts.ts`
- **Менять:** `src/infrastructure/platform/`, `src/main/`, `src/preload/`, тесты.
- **Критерии приёмки:**
  - [ ] Корректное формирование `EnvironmentSnapshot` по IPC.
  - [ ] `npm test && npm run typecheck` проходят без ошибок.
