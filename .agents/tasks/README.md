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

### [TASK: P14-S03] — Procedural Gaze Tracking & Cursor Reactions
- **Статус:** `ready`
- **Исполнитель:** `domain-behavior` + `app-developer`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Реализовать процедурное слежение взгляда за курсором мыши (расчет угла, сдвиг зрачков с `dead_zone` и `lerp`) и реакцию попытки поймать курсор `swat_cursor`.
- **Читать:**
  - `.agents/agents/domain-behavior/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md` (Раздел 4: Gaze Tracking & Reactions)
- **Менять:** `src/renderer/render-engine/`, `src/domain/behavior/`, unit-тесты.
- **Критерии приёмки:**
  - [ ] Плавный расчет смещения зрачков без джиттера.
  - [ ] Реакция `swat_cursor` при близком наведении мыши.
  - [ ] `npm test && npm run typecheck` проходят без ошибок.

---

### [TASK: P14-S04] — Activity Chains, Penalty & Zoomies Event
- **Статус:** `ready`
- **Исполнитель:** `domain-behavior`
- **Трек:** [`tracks/shimeji.md`](./tracks/shimeji.md)
- **Цель:** Иерархические цепочки поведения (`ActivityChain`), штраф за повторение поз (`RepetitionPenalty`) и редкое событие `Zoomies` (спринт с заносом).
- **Читать:**
  - `.agents/agents/domain-behavior/agent.md`
  - `docs/engine/SHIMEJI_SPEC.md` (Разделы 5 и 6)
- **Менять:** `src/domain/behavior/`, unit-тесты.
- **Критерии приёмки:**
  - [ ] Реализованы цепочки активностей с защитой от циклов.
  - [ ] Шкала скуки и ивент Zoomies триггерятся по формулам спецификации.
  - [ ] `npm test && npm run typecheck` проходят без ошибок.

---

### [TASK: P14-UI03] — Speech Bubble Auto-Dismiss & Polish
- **Статус:** `ready`
- **Исполнитель:** `app-developer`
- **Трек:** [`tracks/ui-desktop.md`](./tracks/ui-desktop.md)
- **Цель:** Настройка адаптивного позиционирования речевого облачка и таймингов автоматического скрытия сообщений.
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `src/renderer/components/Chat/SpeechBubble.tsx`
- **Менять:** `src/renderer/components/Chat/SpeechBubble.tsx`, тесты.
- **Критерии приёмки:**
  - [ ] Сообщения авто-скрываются через вычисленный интервал (3с + добавка за длину текста).
  - [ ] Облачко не вылезает за пределы видимого экрана.

---

### [TASK: P13-F03a] — Face Overlay & Gaze Pupils Pack
- **Статус:** `ready`
- **Исполнитель:** `sprite-artist`
- **Трек:** [`tracks/visual-sprites.md`](./tracks/visual-sprites.md)
- **Цель:** Отрисовка недостающих PNG лиц (`face_curious`, `face_dizzy`, `face_surprised`, `face_blush`, `pupils_normal`) для оверлея и Gaze Tracking.
- **Читать:**
  - `.agents/agents/sprite-artist/agent.md`
  - `docs/engine/RENDER_ENGINE.md` (Раздел 1)
- **Менять:** `public/assets/sprites/faces/`
