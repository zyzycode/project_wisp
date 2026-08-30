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

### [TASK: P14-G01] — Shimeji Motion Orchestrator & Main Physics Loop Migration
- **Статус:** `in_progress`
- **Исполнитель:** `app-developer`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Реализовать `ShimejiMotionOrchestrator` в Application, `PetPositionPort` в Infrastructure, типизированный IPC стрим в Preload и очистить `DesktopPet.tsx` от вычислений физики по спецификации `docs/engine/SHIMEJI_SPEC.md` (Разделы 7–10).
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md` (Разделы 7, 8, 9, 10)
  - `src/shared/ipc-contracts.ts`
- **Менять:** `src/application/`, `src/infrastructure/`, `src/main/`, `src/preload/`, `src/shared/`, `src/renderer/`, тесты.
- **Критерии приёмки:**
  - [ ] Main является единственным владельцем координат окна и физики.
  - [ ] Renderer работает только как презентационный View.
  - [ ] `npm test && npm run typecheck` проходят со 100% успехом.

---

### [TASK: P13-F03a] — Face Overlay & Gaze Pupils Pack
- **Статус:** `in_progress`
- **Исполнитель:** `sprite-artist`
- **Трек:** [`tracks/visual-sprites.md`](./tracks/visual-sprites.md)
- **Цель:** Отрисовка недостающих PNG лиц и зрачков `pupils_normal`.
- **Читать:** `.agents/agents/sprite-artist/agent.md`, `docs/engine/RENDER_ENGINE.md`
