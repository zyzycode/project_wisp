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

### [TASK: P14-A02] — Architectural Decision & IPC Orchestration Spec for Main Physics Loop
- **Статус:** `in_progress`
- **Исполнитель:** `architect`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Анализ целесообразности сторонних движков (ADR) и формальная спецификация контракта `ShimejiMotionOrchestrator` и IPC-потока в Main-процессе.
- **Читать:**
  - `.agents/agents/architect/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md`
  - `src/shared/ipc-contracts.ts`
- **Менять:** `docs/engine/SHIMEJI_SPEC.md`

---

### [TASK: P14-G01] — Shimeji Motion Orchestrator & Main Physics Loop Migration
- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Реализация миграции физического цикла в Main согласно спецификации архитектора.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/SHIMEJI_SPEC.md`

---

### [TASK: P13-F03a] — Face Overlay & Gaze Pupils Pack
- **Статус:** `in_progress`
- **Исполнитель:** `sprite-artist`
- **Трек:** [`tracks/visual-sprites.md`](./tracks/visual-sprites.md)
- **Цель:** Отрисовка недостающих PNG лиц и зрачков `pupils_normal`.
- **Читать:** `.agents/agents/sprite-artist/agent.md`, `docs/engine/RENDER_ENGINE.md`
