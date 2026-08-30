# .agents/tasks/README.md — Доска активного спринта Project Wisp

Этот файл — **командный пульт текущего спринта**.
Он содержит только активные задачи (3–5 карточек) прямо сейчас.

---

## 🗺️ Тематические треки бэклога

Все детальные задачи, ТЗ и чеклисты декомпозированы по специализированным трекам:

| Трек | Файл | Направление |
|---|---|---|
| 🐾 **Shimeji & Autonomy** | [`tracks/shimeji.md`](./tracks/shimeji.md) | Стабилизация физики, маппинг 34 спрайтов, дискретный `face_gaze`, редизайн меню |
| 🎨 **Visual & Sprites** | [`tracks/visual-sprites.md`](./tracks/visual-sprites.md) | ТЗ художника, оверлей лиц, анкоры, генерация манифеста |
| 🖥️ **UI & Desktop** | [`tracks/ui-desktop.md`](./tracks/ui-desktop.md) | Контекстное меню, чат-облачко, инспектор анимаций в Debug HUD |
| 🧠 **Memory & AI** | [`tracks/memory-ai.md`](./tracks/memory-ai.md) | SQLite память, диалоги, факты, AI-провайдеры (Next) |

---

## 🚦 Правила передачи задач агентам

1. Агенту в prompt передаётся **только одна изолированная карточка**.
2. Первая строка в `Читать:` — всегда `.agents/agents/<роль>/agent.md`.
3. Агент читает **только** свой файл трека и релевантный `docs/engine/*.md`.
4. Менеджер формирует сразу **пару промптов: Исполнитель + Ревьюер**.

---

## 🔥 Активная очередь спринта (В работе и следующие)

### [TASK: P14-P01] — Sprite Manifest Wiring, Face Overlay & Discrete face_gaze Integration
- **Статус:** `in_progress`
- **Исполнитель:** `app-developer`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Связать все 34 запечённых спрайта тела с FSM (ходьба, бег, сон, падение, шлепок, лазание), настроить оверлей лиц (`overlay` vs `baked_in`), подключить 4-направленный дискретный `face_gaze` и обеспечить покадровый плеер с поддержкой 4/8 кадров.
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `public/assets/sprites/manifest.json`
  - `docs/engine/RENDER_ENGINE.md`
  - `docs/AI_STUDIO_PROMPTS.md`
- **Менять:** `src/renderer/components/Character/`, `src/renderer/components/DesktopPet.tsx`, тесты.

---

### [TASK: P14-P02] — Physics Calibration & Motion Tuning
- **Статус:** `pending`
- **Исполнитель:** `domain-behavior`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Откалибровать параметры физики (гравитация, трение скольжения по полу, отскоки от стен и пороги приземления).
- **Читать:** `.agents/agents/domain-behavior/agent.md`, `docs/engine/SHIMEJI_SPEC.md`

---

### [TASK: P14-P03] — Dialogue & Speech Phrases Pool Expansion
- **Статус:** `pending`
- **Исполнитель:** `domain-behavior`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Существенно расширить пул текстовых реплик и случайных мыслей персонажа.
- **Читать:** `.agents/agents/domain-behavior/agent.md`, `docs/engine/BEHAVIOR_INTENTS.md`

---

### [TASK: P14-P04] — Context Menu UI/UX Redesign
- **Статус:** `pending`
- **Исполнитель:** `app-developer`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Полный редизайн контекстного меню (ПКМ) в компактный и красивый Desktop Pet стиль.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`

---

### [TASK: P13-F03a] — Face Overlay & Gaze Pupils Pack
- **Статус:** `in_progress`
- **Исполнитель:** `sprite-artist`
- **Трек:** [`tracks/visual-sprites.md`](./tracks/visual-sprites.md)
- **Цель:** Отрисовка недостающих PNG лиц.
- **Читать:** `.agents/agents/sprite-artist/agent.md`, `docs/engine/RENDER_ENGINE.md`
