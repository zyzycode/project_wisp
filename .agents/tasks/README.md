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

### [TASK: P14-A01] — Shimeji Engine Architecture & Contract Formalization
- **Статус:** `in_progress`
- **Исполнитель:** `architect`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Спроектировать и зафиксировать в `docs/engine/SHIMEJI_SPEC.md` строгие архитектурные контракты Shimeji: DTO для кинематики броска (без утечек Electron в domain), интерфейсы Gaze Tracking (координаты мыши, lerp, dead_zone, swat) и цепочки поведения с `RepetitionPenalty`.
- **Читать:**
  - `.agents/agents/architect/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md`
  - `docs/engine/CHARACTER_ENGINE.md`
  - `docs/engine/ANIMATION_ENGINE.md`
- **Менять:** `docs/engine/SHIMEJI_SPEC.md`, `docs/engine/README.md`.
- **Критерии приёмки:**
  - [ ] Описаны строгие TypeScript DTO для баллистики и исходов приземления.
  - [ ] Описаны интерфейсы и формулы Gaze Tracking.
  - [ ] Зафиксированы строгие правила изоляции (domain чистый от Electron/DOM).

---

### [TASK: P14-UI01] — Context Menu & Interaction Polish
- **Статус:** `ready`
- **Исполнитель:** `app-developer`
- **Трек:** [`tracks/ui-desktop.md`](./tracks/ui-desktop.md)
- **Цель:** Расширить контекстное меню персонажа: добавить интерактивы (Погладить, Поиграть, Покормить), принудительную смену поз для тестов (Сесть, Лечь, Встать), сброс позиции по центру и тумблер Debug HUD.
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `.agents/tasks/tracks/ui-desktop.md` (Раздел 2, Task P14-UI01)
- **Менять:** `src/renderer/` (модули контекстного меню), unit-тесты.
- **Критерии приёмки:**
  - [ ] Меню открывается по правому клику и не выходит за пределы экрана.
  - [ ] Пункты меню триггерят соответствующие стимулы/действия.
  - [ ] `npm test && npm run typecheck` проходят без ошибок.

---

### [TASK: P14-S02] — Drag & Throw Ballistics Physics
- **Статус:** `blocked` (ждёт завершения P14-A01)
- **Исполнитель:** `domain-behavior`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Реализовать в domain чистую физику броска мышью по контракту из `SHIMEJI_SPEC.md`.

---

### [TASK: P13-F03] — Face & Body Asset Preparation Pack
- **Статус:** `ready`
- **Исполнитель:** `художник`
- **Трек:** [`tracks/visual-sprites.md`](./tracks/visual-sprites.md)
- **Цель:** Отрисовка прозрачных PNG лиц (`faces/`) и новых поз локомоции (`body/`).
