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

- Phase 0–12: `done` — архитектура, оверлей, FSM, Character Engine v2, AI dialogue loop, Animation & Reaction Pack.
- Phase 13 (Render Engine & Asset Pipeline): `in_progress`
  - `P13-A01` (Architecture Contract: RENDER_ENGINE.md): `done`
  - `P13-T01` (Structured Logger Infrastructure & Telemetry Stream): `done`
  - `P13-T02` (Asset Manifest Parser & Sprite Playback Controller): `done`
  - `P13-T03` (Layered Character Renderer Component): `done`
  - `P13-T04` (Safe Fallback Implementation): `in_progress`
  - `P13-T05` (Mini-Debug HUD & Dev Overlay): `planned`
  - `P13-T06` (Unit & Component Tests for Render Engine): `planned`
  - `P13-G01` (Code Review Phase 13): `planned`

## Активная очередь (Phase 13 — Render Engine & Asset Pipeline)

### P13-A01 — Architecture Contract: RENDER_ENGINE.md

- **Статус:** `done`
- **Исполнитель:** `architect`
- **Зависит от:** none
- **Цель:** Создать архитектурный контракт `docs/engine/RENDER_ENGINE.md`.
- **Читать:** `.agents/agents/architect/agent.md`, `docs/engine/ANIMATION_ENGINE.md`, `public/assets/sprites/manifest.json`.
- **Менять:** `docs/engine/RENDER_ENGINE.md`.
- **Критерии приёмки:**
  - [x] Специфицирован `manifest.json` и структура спрайтов.
  - [x] Описана композиция слотов `underlay` -> `body` -> `face` -> `blush` -> `overlay`.
  - [x] Специфицирован порт `ICharacterRenderer` и `RenderPresentationState`.
  - [x] Чётко описан алгоритм 3-уровневого Graceful Fallback.

### P13-T01 — Structured Logger Infrastructure & Telemetry Stream

- **Статус:** `done`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-A01`
- **Цель:** Реализовать порт `ILogger` и адаптер `AppLogger` с `LogBuffer`.
- **Читать:** `.agents/agents/app-developer/agent.md`.
- **Менять:** `src/application/ports/logger.interface.ts`, `src/infrastructure/logging/`.
- **Критерии приёмки:**
  - [x] Реализован интерфейс `ILogger` и адаптер `AppLogger`.
  - [x] Поддерживаются уровни `debug`, `info`, `warn`, `error`, `silent` и кольцевой буфер `ILogBuffer`.
  - [x] `npm test` и `npm run typecheck` зелёные.

### P13-T02 — Asset Manifest Parser & Sprite Playback Controller

- **Статус:** `done`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-A01`
- **Цель:** Реализовать парсер и нормализатор `manifest.json` (`ManifestLoader`), чистый `AnimationPlayer` (отсчёт времени по deltaMs, сменяемость кадров, циклы и completion events) под готовые 4 спрайта `body_walk_00..03.png`.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`, `public/assets/sprites/manifest.json`.
- **Менять:** `src/renderer/render-engine/` (`manifest-loader.ts`, `animation-player.ts`, `types.ts`, `index.ts`), unit-тесты.
- **Критерии приёмки:**
  - [x] `ManifestLoader` читает `manifest.json` и нормализует дефолтные FPS/pivot.
  - [x] `AnimationPlayer` детерминированно меняет кадры по tick(deltaMs), поддерживает режимы `loop`, `hold`, `once` и `until_replaced`/`bounded`.
  - [x] Написаны unit-тесты на расчет таймингов, переключение кадров и completion event.
  - [x] `npm test` и `npm run typecheck` зелёные.

### P13-T03 — Layered Character Renderer Component

- **Статус:** `done`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-T02`
- **Цель:** Реализовать Asset/Fallback Resolver, React-адаптер (`useCharacterAnimation`) и обновить `CharacterRenderer.tsx`, отображая Wisp через спрайты с оверлеями румянца и пропсов по Z-индексам.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`.
- **Менять:** `src/renderer/render-engine/asset-resolver.ts`, `src/renderer/components/Character/`, `src/renderer/components/CharacterRenderer.tsx`.
- **Критерии приёмки:**
  - [x] Wisp ходит спрайтами при FSM walk.
  - [x] Z-порядок слоёв соблюден.
  - [x] `npm test` и `npm run typecheck` зелёные.

### P13-T04 — Safe Fallback Implementation

- **Статус:** `in_progress`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-T03`
- **Цель:** Реализовать строгую 3-уровневую систему Graceful Degradation и технический фоллбек в `AssetResolver` и `SpriteRenderer` согласно `docs/engine/RENDER_ENGINE.md` (§6): Level 1 (точное совпадение тона) -> Level 2 (базовый body_walk / body_idle + процедурный оверлей) -> Level 3 (системная векторная заглушка / безопасный дефолт) без падений FSM и сбоев таймеров, плюс Technical Fallback при ошибках загрузки картинок (404/decode error).
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md` (§6 Graceful Fallback).
- **Менять:** `src/renderer/render-engine/asset-resolver.ts`, `src/renderer/components/Character/SpriteRenderer.tsx`, unit/component тесты.
- **Критерии приёмки:**
  - [ ] Полная изоляция: отсутствующий в манифесте или битый спрайт ни при каких обстоятельствах не крашит FSM и не блокирует цикл анимации.
  - [ ] Level 2 корректно сохраняет семантические оверлеи (`blush`, `props`) даже если спрайты тела откатились к `body_idle`.
  - [ ] Technical Fallback обрабатывает ошибки `onError` у `<img>` без зависания плеера.
  - [ ] Написаны unit-тесты на все 3 уровня фоллбека и обработку сетевых/дисковых ошибок.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P13-T05 — Mini-Debug HUD & Dev Overlay

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-T01`, `P13-T03`
- **Цель:** Оверлей отладки (`Ctrl+D` / контекстное меню) с выводом live-потребностей, дружбы, тона, FPS и ленты логов.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`, `src/renderer/components/`.
- **Менять:** `src/renderer/components/Debug/` (`DebugHUD.tsx`, `LogViewer.tsx`).
- **Критерии приёмки:**
  - [ ] Оверлей открывается по хоткею и меню, показывает живые данные.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P13-T06 — Unit & Component Tests for Render Engine

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-T04`, `P13-T05`
- **Цель:** Полное тестовое покрытие пайплайна спрайтов, логгера, фоллбеков и компонентов.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`, `tests/renderer/`.
- **Менять:** `tests/renderer/`.
- **Критерии приёмки:**
  - [ ] 100% зелёные тесты.

### P13-G01 — Code Review Phase 13

- **Статус:** `planned`
- **Исполнитель:** `reviewer`
- **Зависит от:** `P13-T06`
- **Цель:** Аудит Phase 13.
- **Читать:** `.agents/agents/reviewer/agent.md`, `docs/engine/RENDER_ENGINE.md`, код Phase 13.
- **Менять:** ничего.

## Поздние фазы

| Фаза | Тема | Исполнитель по умолчанию |
|---|---|---|
| 14 | Offline Memory & Relationship: SQLite memory, facts, history, clear memory | `app-developer` |
| 15 | Desktop Life Behaviors: quiet mode, cooldowns, habits | `domain-behavior` |
| 16 | Settings & Control Surface: behavior, appearance, memory controls, full debug panel | `app-developer` |
| 17 | External AI Contract Readiness: future client-side adapter only | `architect` + `app-developer` |
| 18 | Stability & Performance Hardening: long sessions, cleanup, Wayland/X11 | `reviewer` |
| 19 | Production Packaging: Linux first, then Windows/macOS | `app-developer` |
