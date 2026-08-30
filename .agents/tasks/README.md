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
4. Менеджер формирует сразу **пару промптов: Исполнитель + Ревьюер**.

---

## 🔥 Активная очередь спринта (В работе и следующие)

### [TASK: P14-G01] — Final Integration Review Gate Phase 14
- **Статус:** `ready`
- **Исполнитель:** `reviewer`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Финальная сквозная верификация всей автономной физики Shimeji (броски, отскоки, зацепление за поверхности, срыв `support_lost`, gaze tracking, цепочки активностей, зумис).
- **Читать:**
  - `.agents/agents/reviewer/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md`
  - `docs/engine/RENDER_ENGINE.md`
- **Критерии приёмки:**
  - [ ] Полное соответствие контракту `SHIMEJI_SPEC.md`.
  - [ ] Чистая изоляция Domain, Application и Infrastructure слоёв.
  - [ ] Все тесты `npm test` и `npm run typecheck` проходят (100%).

---

### [TASK: P13-F03a] — Face Overlay & Gaze Pupils Pack
- **Статус:** `in_progress`
- **Исполнитель:** `sprite-artist`
- **Трек:** [`tracks/visual-sprites.md`](./tracks/visual-sprites.md)
- **Цель:** Отрисовка недостающих PNG лиц (`face_curious`, `face_dizzy`, `face_surprised`, `face_blush`, `face_winking`, `face_pout`) и отдельного спрайта зрачков (`pupils_normal`) для оверлея и Gaze Tracking.
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Раздел 1: Manifest & Asset Metadata)
- **Менять:** `public/assets/sprites/faces/`
