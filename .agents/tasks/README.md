# .agents/tasks/README.md — Доска активного спринта Project Wisp

Этот файл — **командный пульт текущего спринта**.
Он содержит только активные задачи (3–5 карточек) прямо сейчас.

---

## 🗺️ Тематические треки бэклога

Все детальные задачи, ТЗ и чеклисты декомпозированы по специализированным трекам:

| Трек | Файл | Направление |
|---|---|---|
| 🐾 **Shimeji & Autonomy** | [`tracks/shimeji.md`](./tracks/shimeji.md) | Стабилизация физики, интеграция FSM с Renderer, взгляд, редизайн меню |
| 🖥️ **UI & Desktop** | [`tracks/ui-desktop.md`](./tracks/ui-desktop.md) | Контекстное меню, чат-облачко, инспектор анимаций в Debug HUD |
| 🧠 **Memory & AI** | [`tracks/memory-ai.md`](./tracks/memory-ai.md) | SQLite память, диалоги, факты, AI-провайдеры (Next) |

Здесь только задачи приложения. Подготовка изображений и их готовность — в отдельном [Asset Pipeline](../../asset-pipeline/README.md); его материалы не входят в контекст этих карточек.

---

## 🚦 Правила передачи задач агентам

1. Агенту в prompt передаётся **только одна изолированная карточка**.
2. Первая строка в `Читать:` — всегда `.agents/agents/<роль>/agent.md`.
3. Агент читает **только назначенную карточку** своего трека и нужные разделы `docs/engine/*.md`.
4. Менеджер формирует сразу **пару промптов: Исполнитель + Ревьюер**.

---

## 🔥 Активная очередь спринта (В работе и следующие)

### [TASK: P14-P01] — Интеграция FSM с Renderer и управление взглядом
- **Статус:** `in_progress`
- **Исполнитель:** `app-developer`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Связать состояния FSM с Renderer, настроить композицию лица, дискретный взгляд и воспроизведение по рабочему манифесту. Подробности — в карточке трека; подготовка PNG не входит в задачу.
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `public/assets/sprites/manifest.json`
  - `docs/engine/RENDER_ENGINE.md`
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
