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
- Phase 13 Polish & UI Unification: `in_progress`
  - `P13-P01` (Unified Pet Menu & Expanded Dev Telemetry Panel): `in_progress`
- Phase 14 (Offline Memory & Relationship Persistence): `planned`
  - `P14-A01` (Architecture Contract: MEMORY_ENGINE.md): `planned`
  - `P14-T01` (SQLite Database Initialization & Migrations): `planned`
  - `P14-T02` (Chat History Repository & Bounded Context Buffer): `planned`
  - `P14-T03` (User Facts & Character State Persistence): `planned`
  - `P14-T04` (Privacy Controls & Clear Memory Flow): `planned`
  - `P14-G01` (Code Review Phase 14): `planned`

## Активная очередь (Phase 13 Polish — Unified Control & Debug UI)

### P13-P01 — Unified Pet Menu & Expanded Dev Telemetry Panel

- **Статус:** `in_progress`
- **Исполнитель:** `app-developer`
- **Зависит от:** Phase 13
- **Цель:** Объединить контекстное меню и Dev Debug HUD в единую удобную панель управления (`UnifiedPetMenu` / `ContextMenu`) с табами («Действия», «Внешний вид», «🛠️ Debug»), исключив конфликт двух спорящих оверлеев. Сделать секцию дебага просторной и читаемой (шкалы потребностей, дружба, тон, FSM, FPS, логгер). Хоткей `Ctrl+D` открывает меню сразу на вкладке «Debug».
- **Читать:** `.agents/agents/app-developer/agent.md`, `src/renderer/components/`.
- **Менять:** `src/renderer/components/Interaction/ContextMenu.tsx`, `src/renderer/components/Debug/`, `src/renderer/components/DesktopPet.tsx`, `src/renderer/index.css`, unit/component тесты.
- **Критерии приёмки:**
  - [ ] Контекстное меню и Debug HUD объединены в один стильный табовый интерфейс.
  - [ ] Хоткей `Ctrl+D` открывает меню сразу на вкладке «Debug».
  - [ ] Панель просторная, с комфортными отступами и прокруткой логов, не перекрывает экран вторым дублирующим окном.
  - [ ] `npm test` и `npm run typecheck` зелёные.

## Поздние фазы

| Фаза | Тема | Исполнитель по умолчанию |
|---|---|---|
| 14 | Offline Memory & Relationship: SQLite memory, facts, history, clear memory | `architect` + `app-developer` |
| 15 | Desktop Life Behaviors: quiet mode, cooldowns, habits | `domain-behavior` |
| 16 | Settings & Control Surface: behavior, appearance, memory controls, full debug panel | `app-developer` |
| 17 | External AI Contract Readiness: future client-side adapter only | `architect` + `app-developer` |
| 18 | Stability & Performance Hardening: long sessions, cleanup, Wayland/X11 | `reviewer` |
| 19 | Production Packaging: Linux first, then Windows/macOS | `app-developer` |
