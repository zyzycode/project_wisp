# .agents/tasks/README.md — компактная доска задач Project Wisp

Этот файл хранит только ближайший рабочий фронт и правила передачи задач агентам.
`ROADMAP.md` отвечает на вопрос: куда идём.
Этот файл отвечает на вопрос: что делать следующим.

## Бюджет контекста

- Держать файл коротким: целевой размер — до 180 строк.
- Активными держать только текущую фазу и 3–5 задач.
- Агенту в prompt передаётся одна карточка задачи, а не весь backlog.
- Агент читает только релевантный `docs/engine/*.md`.

## Статусы

- `planned` — задача понятна, но ещё не готова к выдаче.
- `ready` — можно выдавать owner-agent.
- `in_progress` — задача выполняется.
- `blocked` — нужен внешний ответ или решение.
- `done` — результат принят.

## Текущее состояние

- Phase 0–13: `done` — архитектура, оверлей, FSM, Character Engine v2, AI dialogue loop, Animation & Reaction Pack, Render Engine, Sprites, Logger & Debug HUD.
- Memory Contract (`MEMORY_ENGINE.md`): `done` — архитектурный контракт памяти утверждён и зафиксирован.
- Phase 14 (Shimeji & Advanced Autonomy): `in_progress`
  - `P14-S01` (FSM Locomotion Expansion & Boredom Need): `ready`
  - `P14-S02` (Advanced Drag & Throw Physics with Velocity/Stumble): `planned`
  - `P14-S03` (Procedural Gaze Tracking & Cursor Reactions): `planned`
  - `P14-S04` (Activity Chains, Repetition Penalty & Zoomies Event): `planned`
  - `P14-G01` (Code Review Phase 14): `planned`

## Активная очередь (Phase 14 — Shimeji & Advanced Autonomy)

### P14-S01 — FSM Locomotion Expansion & Boredom Need

- **Статус:** `ready`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** none
- **Цель:** Расширить стейт-машину анимаций и поведение новыми состояниями: `sit`, `stand_up`, `lie_down`, `get_up`, `run`, `jump`, `fall`, `land`, `crawl`. Добавить 5-ю шкалу в потребности `Needs.boredom` (скука растёт со временем, снижается при активных действиях).
- **Читать:** `.agents/agents/domain-behavior/agent.md`, `docs/engine/CHARACTER_ENGINE.md`, `docs/engine/RENDER_ENGINE.md`.
- **Менять:** `src/domain/character/needs.ts`, `src/domain/animation/`, `src/domain/behavior/`, unit-тесты.
- **🎨 Арт-ассеты (Художник):**
  - `sit`/`stand_up`: `body_sit_00.png`, `face_sit_default.png`.
  - `lie_down`/`get_up`: `body_lie_00.png`, `face_lie_comfy.png`.
  - `run`: `body_run_00.png`..`03.png`.
  - `jump`/`fall`/`land`: `body_jump_up.png`, `body_fall_down.png`, `body_land_impact.png`.
- **Критерии приёмки:**
  - [ ] Новые интенты и состояния валидируются FSM.
  - [ ] `boredom` корректно тикает в `tickNeeds`.
  - [ ] Fallback-рендерер безопасно работает даже до появления всех PNG-файлов.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P14-S02 — Advanced Drag & Throw Physics

- **Статус:** `planned`
- **Исполнитель:** `domain-behavior` + `app-developer`
- **Зависит от:** `P14-S01`
- **Цель:** Расчёт вектора скорости `(vx, vy)` при отпускании мыши, параболический полёт с гравитацией, разделение приземления на `soft_landing`, `stumble` (спотыкание) и `crash_landing` (плюхнулся) с фазой вставания `recover`.
- **Читать:** `.agents/agents/domain-behavior/agent.md`, `src/application/services/pet-position.service.ts`.
- **🎨 Арт-ассеты (Художник):**
  - `body_dragged_hang.png`, `face_dragged_surprised.png` (удержание курсором).
  - `body_crash_splat.png`, `face_crash_dizzy.png` (аварийное падение).
  - `body_recover_00.png`, `01.png` (отряхивание и вставание).
- **Критерии приёмки:**
  - [ ] Плавный расчет физики броска и отскока/приземления.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P14-S03 — Procedural Gaze Tracking & Cursor Reactions

- **Статус:** `planned`
- **Исполнитель:** `app-developer` + `domain-behavior`
- **Зависит от:** `P14-S01`
- **Цель:** Вычисление угла к курсору, dead zone, сглаживание взгляда (`lerp`), смещение зрачков, следование за мышью (`cursor_chase`) и попытка поймать (`swat_cursor`).
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`.
- **🎨 Арт-ассеты (Художник):**
  - `face_base_open_eyes.png`, `pupils_normal.png` (процедурные зрачки).
  - `body_swat_00.png`, `01.png`, `face_playful_focus.png` (ловля курсора).
- **Критерии приёмки:**
  - [ ] Зрачки плавно смотрят на мышь без дрожания.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P14-S04 — Activity Chains, Repetition Penalty & Zoomies Event

- **Статус:** `planned`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P14-S01`
- **Цель:** Иерархические цепочки действий (`Explore`, `WindowWatching`, `Relax`, `Play`), кольцевой буфер `RepetitionPenalty` для предотвращения спама одинаковых действий и редкое безумное событие **Zoomies** (спринт-дрифт туда-сюда).
- **Читать:** `.agents/agents/domain-behavior/agent.md`, `src/domain/behavior/`.
- **🎨 Арт-ассеты (Художник):**
  - `body_inspect_lean.png`, `face_inspect_curious.png` (осмотр/исследование).
  - `body_skid_turn.png`, `face_zoomies_wild.png` (дрифт при Zoomies).
- **Критерии приёмки:**
  - [ ] Цепочки действий выполняются последовательно.
  - [ ] `RepetitionPenalty` предотвращает спам анимаций.
  - [ ] `npm test` и `npm run typecheck` зелёные.

## Поздние фазы

| Фаза | Тема | Исполнитель по умолчанию |
|---|---|---|
| 15 | Offline Memory & Persistence: SQLite, bounded history, facts, state restore, clear memory (Контракт готов) | `app-developer` |
| 16 | Settings & Control Surface: behavior, appearance, memory controls, full debug panel | `app-developer` |
| 17 | External AI Contract Readiness: future client-side adapter only | `architect` + `app-developer` |
| 18 | Stability & Performance Hardening: long sessions, cleanup, Wayland/X11 | `reviewer` |
| 19 | Production Packaging: Linux first, then Windows/macOS | `app-developer` |
