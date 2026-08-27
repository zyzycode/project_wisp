# .agents/tasks/README.md — Task Breakdown для Project Wisp

Этот документ превращает стратегический `ROADMAP.md` в маленькие agent-ready задачи для Codex-агентов. Backlog виден всем агентам и используется как общий координационный слой между Project Manager, Architect, feature-агентами, Reviewer, Fixer и Tester.

`ROADMAP.md` отвечает на вопрос: **куда идём и почему**.  
`.agents/tasks/README.md` отвечает на вопрос: **какую конкретную задачу можно дать агенту прямо сейчас**.

---

## 1. Правила task breakdown

Задача считается готовой для агента, если:

1. У неё есть один основной owner-agent.
2. Её можно выполнить за один ограниченный проход без захвата соседних слоёв.
3. Понятны входные документы и файлы, которые можно читать.
4. Понятны файлы или области, которые можно менять.
5. Есть короткие acceptance criteria.
6. Явно указан out of scope.
7. Для implementation-задач понятен следующий review/fix/test шаг.
8. Если задача зависит от предыдущей работы, указан `Depends on`.

Project Manager отвечает за то, чтобы не выдавать агентам целую roadmap-фазу как одну задачу.

---

## 2. Видимость и права

Все агенты могут читать этот файл перед началом работы, чтобы видеть:

- какие задачи уже готовы;
- какие задачи зависят от текущей;
- какой агент отвечает за следующий gate;
- есть ли review/fix/test шаги после реализации.

Права на изменение:

- **Project Manager** обновляет структуру backlog, статусы, зависимости, owner-agent и порядок задач.
- **Architect** может предлагать новые contract-задачи или блокеры, но не переписывает backlog без Project Manager.
- **Feature agents** не меняют backlog напрямую; они возвращают результат по своей задаче.
- **Code Reviewer** возвращает findings и предлагает перевод fix-gate в `ready`.
- **Fixer** возвращает fixed/rejected/blocked по конкретным findings.
- **Tester** возвращает verification report и предлагает закрыть задачу или вернуть её на fix.

Если агент обнаружил, что задача слишком большая или принадлежит другому owner-agent, он не расширяет scope, а возвращает Project Manager-у предложение по дроблению.

---

## 3. Статусы

- `planned` — задача понятна, но зависит от предыдущих задач.
- `ready` — можно выдавать owner-agent; все `Depends on` уже имеют статус `done` или зависимостей нет.
- `in_progress` — задача сейчас выполняется назначенным агентом.
- `blocked` — нужна внешняя информация, архитектурное решение или результат другой задачи.
- `done` — задача выполнена, результат принят Project Manager-ом.

Статус `done` для implementation-задачи не означает, что вся фаза закрыта. После неё могут стать `ready` задачи `tester`, `code-reviewer` или `fixer`.

---

## 4. State machine задачи

Обычный переход:

```text
planned -> ready -> in_progress -> done
                       |
                       v
                    blocked
```

Для implementation-задач Project Manager обычно ведёт цепочку:

```text
architect contract -> feature implementation -> tester -> code-reviewer -> fixer -> tester/reviewer as needed -> done
```

Правило: агент не должен сам брать следующую задачу только потому, что видит её в backlog. Следующую задачу назначает Project Manager.

---

## 5. Ближайший порядок работы

1. `P09-*` — сначала зафиксировать provider/intent/engine контракты в документации.
2. `P10-*` — затем реализовать MockAI и dialogue loop без реального backend.
3. `P11-*` / `P12-*` — расширить характер, поведение и анимации Wisp.
4. `P13-*` — отдельно развить renderer и asset pipeline.
5. `P14-*` / `P15-*` / `P16-*` — память, desktop-life поведение и настройки.
6. `P17-*` и дальше — подготовка к будущему внешнему backend-контракту, стабильность и упаковка.

---

## 6. Phase 9 — Provider & Intent Contracts

### P09-T01 — Создать индекс engine-документов

- **Status:** `done`
- **Owner:** `architect`
- **Depends on:** none.
- **Goal:** Создать `docs/engine/README.md` и зафиксировать, какие engine-документы являются source of truth.
- **Scope:** `docs/engine/README.md`.
- **Acceptance criteria:**
  - Перечислены `AI_PROVIDER_CONTRACT.md`, `CHARACTER_ENGINE.md`, `BEHAVIOR_INTENTS.md`, `ANIMATION_ENGINE.md`, `RENDER_ENGINE.md`, `MEMORY_ENGINE.md` и `SETTINGS_CONTRACT.md`.
  - Указано, что implementer-агенты не меняют engine contracts без architect review.
  - Подтверждено, что renderer engine не является game engine.
- **Out of scope:** product-code, тесты, реализация движков.

### P09-T02 — Описать `IAIProvider` contract

- **Status:** `done`
- **Owner:** `architect`
- **Depends on:** `P09-T01`.
- **Goal:** Описать `IAIProvider`, provider DTO, thinking/latency/error states и offline fallback.
- **Scope:** `docs/engine/AI_PROVIDER_CONTRACT.md`.
- **Acceptance criteria:**
  - `MockAIProvider` описан как текущая default-реализация.
  - `ExternalAIProviderClient` описан как будущий client-side adapter к отдельному backend.
  - Прямые LLM SDK, пользовательские AI API-ключи и backend/proxy/server code запрещены в `project_wisp`.
  - Provider не знает про React, DOM, конкретные sprite/SVG assets и UI-компоненты.
- **Out of scope:** реализация provider в коде, сетевые вызовы, auth/billing.

### P09-T03 — Описать mapper provider responses в `BehaviorIntent`

- **Status:** `done`
- **Owner:** `architect`
- **Depends on:** `P09-T02`.
- **Goal:** Зафиксировать `ProviderResponseIntentMapper` как application-level компонент.
- **Scope:** `docs/engine/AI_PROVIDER_CONTRACT.md`, при необходимости `docs/engine/BEHAVIOR_INTENTS.md`.
- **Acceptance criteria:**
  - Provider возвращает semantic DTO, а не готовое поведение UI.
  - Application переводит provider DTO в internal `BehaviorIntent`.
  - Domain/Character Engine не видит raw provider DTO.
  - Mapper не принимает окончательные решения за Character Engine.
- **Out of scope:** реализация mapper в TypeScript.

### P09-T04 — Описать `BehaviorIntent` и `AnimationIntent`

- **Status:** `ready`
- **Owner:** `architect`
- **Depends on:** `P09-T02`, `P09-T03`.
- **Goal:** Создать начальные каталоги допустимых behavior intents и animation intents.
- **Scope:** `docs/engine/BEHAVIOR_INTENTS.md`, `docs/engine/ANIMATION_ENGINE.md`.
- **Acceptance criteria:**
  - Behavior intents описывают намерение поведения, а не UI-asset.
  - Animation intents описывают визуальное намерение, priority и interrupt rules.
  - Есть примеры для chat reply, thinking, happy reaction, confused reaction, sleep, wake up, drag, landing.
- **Out of scope:** frame size, rows/columns, конкретная нарезка sprite sheets.

### P09-G01 — Architecture docs review gate

- **Status:** `planned`
- **Owner:** `code-reviewer`
- **Depends on:** `P09-T01`, `P09-T02`, `P09-T03`, `P09-T04`.
- **Goal:** Проверить Phase 9 engine/provider/intent документы на противоречия.
- **Scope:** только `.md` документы Phase 9.
- **Acceptance criteria:**
  - Найдены противоречия между `AGENTS.md`, `ARCHITECTURE.md`, `ROADMAP.md` и `docs/engine/*`.
  - Замечания оформлены без исправлений кода.
- **Out of scope:** исправления, implementation, тесты.

---

## 7. Phase 10 — Mock AI & Dialogue Loop

### P10-T01 — Ввести `IAIProvider` port и DTO в коде

- **Status:** `planned`
- **Owner:** `mock-ai-provider`
- **Depends on:** `P09-G01`.
- **Goal:** Добавить типизированный provider port и DTO согласно `AI_PROVIDER_CONTRACT.md`.
- **Scope:** application ports/types only.
- **Acceptance criteria:**
  - Нет типов из внешних AI SDK.
  - DTO не содержит React/UI/component-specific данных.
  - Ошибки, latency и thinking states представлены типизированно.
- **Out of scope:** реальные сетевые вызовы, backend/proxy, UI redesign.

### P10-T02 — Реализовать локальный `MockAIProvider`

- **Status:** `planned`
- **Owner:** `mock-ai-provider`
- **Depends on:** `P10-T01`.
- **Goal:** Сделать офлайн-ответы Wisp по категориям сообщений.
- **Scope:** mock provider implementation and local response catalog.
- **Acceptance criteria:**
  - Категории: greeting, question, care, play, sleep, unknown/fallback.
  - Ответы полностью локальные.
  - Есть симуляция задержки и thinking state.
- **Out of scope:** memory extraction, real LLM, network.

### P10-T03 — Реализовать dialogue loop

- **Status:** `planned`
- **Owner:** `mock-ai-provider`
- **Depends on:** `P10-T02`, `P09-T03`, `P09-T04`.
- **Goal:** Связать ввод пользователя, provider response, mapper и presentation state.
- **Scope:** application dialogue flow and typed state handoff.
- **Acceptance criteria:**
  - UI не знает конкретный provider.
  - Provider response проходит через mapper в `BehaviorIntent`.
  - Thinking и reply отображаются через существующие presentation boundaries.
- **Out of scope:** новые окна настроек, память, внешний backend.

### P10-T04 — Покрыть MockAI сценарии проверками

- **Status:** `planned`
- **Owner:** `tester`
- **Depends on:** `P10-T03`.
- **Goal:** Проверить типовые ответы, fallback и thinking flow.
- **Scope:** unit/integration tests for provider and dialogue loop.
- **Acceptance criteria:**
  - Проверены greeting/question/sleep/unknown scenarios.
  - Проверено, что provider не управляет UI напрямую.
  - Проверены fallback/error states.
- **Out of scope:** visual regression, real network, packaging.

### P10-G01 — MockAI review gate

- **Status:** `planned`
- **Owner:** `code-reviewer`
- **Depends on:** `P10-T04`.
- **Goal:** Проверить implementation Phase 10 и сформировать замечания.
- **Scope:** changed files from Phase 10 only.
- **Acceptance criteria:**
  - Проверены provider boundaries и отсутствие backend/SDK leakage.
  - Замечания оформлены без исправления кода.
- **Out of scope:** исправления, новые фичи после ревью.

### P10-G02 — MockAI fix gate

- **Status:** `planned`
- **Owner:** `fixer`
- **Depends on:** `P10-G01`.
- **Goal:** Исправить только подтверждённые замечания MockAI review.
- **Scope:** files mentioned in reviewer findings only.
- **Acceptance criteria:**
  - Исправлены только review findings.
  - Scope Phase 10 не расширен.
- **Out of scope:** новые provider features, real backend, UI redesign.

---

## 8. Phase 11 — Character Engine v2

### P11-T01 — Описать `CHARACTER_ENGINE.md`

- **Status:** `planned`
- **Owner:** `architect`
- **Depends on:** `P09-T04`.
- **Goal:** Зафиксировать модель характера, настроения, энергии, потребностей и стимулов.
- **Scope:** `docs/engine/CHARACTER_ENGINE.md`.
- **Acceptance criteria:**
  - Один Wisp, без системы множества персонажей.
  - Props описаны как часть поведения одного Wisp.
  - Domain state не зависит от React/Electron/SQLite.
  - Приоритет user input выше автономного поведения.
- **Out of scope:** реализация engine в коде.

### P11-T02 — Реализовать domain state для характера

- **Status:** `planned`
- **Owner:** `domain-behavior`
- **Depends on:** `P11-T01`.
- **Goal:** Добавить чистые domain-модели traits, mood, energy, needs.
- **Scope:** domain behavior layer only.
- **Acceptance criteria:**
  - Нет React/Electron/SQLite imports.
  - Есть defaults для Wisp.
  - State можно сериализовать для будущего хранения.
- **Out of scope:** UI настроек, память SQLite, provider logic.

### P11-T03 — Реализовать stimulus reducer

- **Status:** `planned`
- **Owner:** `domain-behavior`
- **Depends on:** `P11-T02`.
- **Goal:** Переводить user/timer/provider/memory stimuli в изменения domain state.
- **Scope:** pure domain behavior logic.
- **Acceptance criteria:**
  - Drag/click прерывают автономные действия.
  - Thinking/reply intents влияют на mood/focus предсказуемо.
  - Есть правила energy/sleepiness.
- **Out of scope:** renderer assets, chat UI redesign.

### P11-T04 — Проверить Character Engine сценарии

- **Status:** `planned`
- **Owner:** `tester`
- **Depends on:** `P11-T03`.
- **Goal:** Покрыть основные behavior scenarios и edge cases.
- **Scope:** domain unit tests.
- **Acceptance criteria:**
  - Проверены mood/energy/needs transitions.
  - Проверены interrupt priorities.
  - Проверены sleep/wake basics.
- **Out of scope:** E2E packaging, visual assets.

---

## 9. Phase 12 — Animation & Reaction Pack

### P12-T01 — Описать `ANIMATION_ENGINE.md`

- **Status:** `planned`
- **Owner:** `architect`
- **Depends on:** `P09-T04`.
- **Goal:** Зафиксировать animation intents, clip catalog, priority и interrupt rules.
- **Scope:** `docs/engine/ANIMATION_ENGINE.md`.
- **Acceptance criteria:**
  - Описаны idle, reaction, movement, sleep и transition clips.
  - Есть правила priority/interrupt/fallback.
  - Sprite sheet упомянут как целевой формат, без детальной нарезки кадров.
- **Out of scope:** render frame sizes, asset pipeline details.

### P12-T02 — Расширить reaction catalog

- **Status:** `planned`
- **Owner:** `domain-behavior`
- **Depends on:** `P12-T01`, `P11-T03`.
- **Goal:** Добавить новые semantic reactions и выбор animation intents.
- **Scope:** domain animation selection logic.
- **Acceptance criteria:**
  - Реакции: happy, shy, confused, curious, sleepy, startled, proud.
  - Idle-варианты выбираются разнообразно, но не навязчиво.
  - Sleep scene поддерживает pillow prop intent.
- **Out of scope:** drawing sprite sheets, renderer implementation.

### P12-T03 — Реализовать transition/interrupt rules

- **Status:** `planned`
- **Owner:** `domain-behavior`
- **Depends on:** `P12-T01`, `P12-T02`.
- **Goal:** Улучшить FSM переходы между idle/reaction/sleep/drag/landing.
- **Scope:** animation state machine only.
- **Acceptance criteria:**
  - User drag has emergency priority.
  - Temporary reactions return to stable state.
  - Sleep/wake transitions cannot be spammed.
- **Out of scope:** UI layout, provider responses.

### P12-T04 — Проверить animation scenarios

- **Status:** `planned`
- **Owner:** `tester`
- **Depends on:** `P12-T03`.
- **Goal:** Проверить FSM/transition rules через сценарии.
- **Scope:** unit tests for animation state machine.
- **Acceptance criteria:**
  - Проверены idle variety, reaction priority, drag interrupt, sleep/wake.
  - Нет требований к процентам покрытия.
- **Out of scope:** visual pixel tests.

---

## 10. Phase 13 — Render Engine & Asset Pipeline

### P13-T01 — Описать `RENDER_ENGINE.md`

- **Status:** `planned`
- **Owner:** `architect`
- **Depends on:** `P09-T04`, `P12-T01`.
- **Goal:** Зафиксировать render engine как отдельный renderer module, не game engine.
- **Scope:** `docs/engine/RENDER_ENGINE.md`.
- **Acceptance criteria:**
  - Описаны layers, coordinates, anchor points, visual bounds, hitbox.
  - Разделены character state, animation state и visual render props.
  - Описана совместимость SVG сейчас, sprite sheets next, rigging future.
- **Out of scope:** реализация renderer, behavior logic.

### P13-T02 — Описать sprite sheet asset contract

- **Status:** `planned`
- **Owner:** `architect`
- **Depends on:** `P13-T01`.
- **Goal:** Детально описать format/naming/metadata для sprite sheets.
- **Scope:** `docs/engine/RENDER_ENGINE.md`, при необходимости `docs/engine/ANIMATION_ENGINE.md`.
- **Acceptance criteria:**
  - Frame width/height, rows/columns, fps, loop mode, origin/anchor, padding, transparent background.
  - Naming convention и metadata описаны достаточно для asset creation.
  - Формат не ломает будущий rigging path.
- **Out of scope:** создание реальных bitmap assets.

### P13-T03 — Сохранить SVG renderer как compatibility adapter

- **Status:** `planned`
- **Owner:** `ui-specialist`
- **Depends on:** `P13-T01`.
- **Goal:** Подогнать текущий SVG renderer под новый render contract.
- **Scope:** renderer components/adapters only.
- **Acceptance criteria:**
  - UI не получает behavior/domain internals напрямую.
  - SVG path остаётся working default.
  - Масштабирование и hitbox не ломаются.
- **Out of scope:** sprite asset production, domain behavior changes.

### P13-T04 — Добавить sprite sheet renderer MVP

- **Status:** `planned`
- **Owner:** `ui-specialist`
- **Depends on:** `P13-T02`, `P13-T03`.
- **Goal:** Реализовать минимальный renderer для одного sprite sheet по контракту.
- **Scope:** renderer layer and asset manifest handling.
- **Acceptance criteria:**
  - Поддержан один Wisp sprite sheet.
  - Frame stepping, loop и scale работают по metadata.
  - Renderer не содержит behavior decisions.
- **Out of scope:** full asset library, rigging, AI/provider logic.

### P13-T05 — Добавить dev debug overlay для renderer

- **Status:** `planned`
- **Owner:** `ui-specialist`
- **Depends on:** `P13-T01`, `P13-T03`.
- **Goal:** Показать bounding boxes, anchor point, current animation state в dev mode.
- **Scope:** renderer dev-only UI.
- **Acceptance criteria:**
  - Overlay доступен только в dev/debug mode.
  - По умолчанию показывает counters/status only.
  - Не показывает private memory facts.
- **Out of scope:** production UI, memory viewer.

---

## 11. Phase 14 — Offline Memory & Relationship

### P14-T01 — Описать memory contract

- **Status:** `planned`
- **Owner:** `architect`
- **Depends on:** `P11-T01`.
- **Goal:** Зафиксировать границы memory: local-only, clear required, no manual entry editing.
- **Scope:** `docs/engine/MEMORY_ENGINE.md` или раздел в `CHARACTER_ENGINE.md`.
- **Acceptance criteria:**
  - Renderer не знает SQLite.
  - Память не синхронизируется и не отправляется наружу без будущего явного контракта.
  - Пользователь может очистить память.
  - Редактирование отдельных memory entries исключено.
- **Out of scope:** schema implementation.

### P14-T02 — Реализовать SQLite repositories

- **Status:** `planned`
- **Owner:** `data-memory`
- **Depends on:** `P14-T01`.
- **Goal:** Добавить `IMemoryRepository` / `ISettingsRepository` через Main process.
- **Scope:** data/application infrastructure boundaries.
- **Acceptance criteria:**
  - Данные лежат в `app.getPath('userData')`.
  - Renderer обращается только через typed IPC/application API.
  - Есть миграции.
- **Out of scope:** cloud sync, external backend.

### P14-T03 — Реализовать bounded chat history

- **Status:** `planned`
- **Owner:** `data-memory`
- **Depends on:** `P14-T02`.
- **Goal:** Сохранять историю общения с ограничением размера.
- **Scope:** memory repository and application use cases.
- **Acceptance criteria:**
  - Есть лимиты размера/возраста истории.
  - Очистка истории работает безопасно.
  - Empty/corrupt data fallback предсказуем.
- **Out of scope:** semantic LLM summarization.

### P14-T04 — Реализовать простое извлечение фактов

- **Status:** `planned`
- **Owner:** `data-memory`
- **Depends on:** `P14-T03`.
- **Goal:** Локально извлекать простые факты без LLM.
- **Scope:** deterministic heuristics and memory use cases.
- **Acceptance criteria:**
  - Поддержаны простые факты: имя, предпочтения, частые темы.
  - Нет сетевых вызовов.
  - Факты можно полностью очистить.
- **Out of scope:** manual editing, embeddings, vector DB.

### P14-T05 — Проверить memory scenarios

- **Status:** `planned`
- **Owner:** `tester`
- **Depends on:** `P14-T04`.
- **Goal:** Проверить persistence, cleanup и IPC boundaries.
- **Scope:** repository/use case tests.
- **Acceptance criteria:**
  - Память переживает restart scenario.
  - Очистка удаляет history/facts/relationship state.
  - Renderer не импортирует SQLite.
- **Out of scope:** cloud/backend tests.

### P14-G01 — Memory review gate

- **Status:** `planned`
- **Owner:** `code-reviewer`
- **Depends on:** `P14-T05`.
- **Goal:** Проверить memory implementation и границы Renderer/Main/Application.
- **Scope:** changed files from Phase 14 only.
- **Acceptance criteria:**
  - Проверено, что Renderer не импортирует SQLite и не знает storage details.
  - Проверено, что clear memory удаляет history/facts/relationship state.
  - Замечания оформлены без исправления кода.
- **Out of scope:** fixes, cloud sync, manual memory editing.

### P14-G02 — Memory fix gate

- **Status:** `planned`
- **Owner:** `fixer`
- **Depends on:** `P14-G01`.
- **Goal:** Исправить только подтверждённые замечания Memory review.
- **Scope:** files mentioned in reviewer findings only.
- **Acceptance criteria:**
  - Исправлены только review findings.
  - Scope Phase 14 не расширен.
- **Out of scope:** новые memory features, cloud/backend work.

---

## 12. Phase 15 — Desktop Life Behaviors

### P15-T01 — Реализовать quiet/sleep mode rules

- **Status:** `planned`
- **Owner:** `domain-behavior`
- **Depends on:** `P11-T03`, `P12-T03`.
- **Goal:** Добавить anti-distraction режим, где Wisp спит или ведёт себя тихо.
- **Scope:** domain behavior rules.
- **Acceptance criteria:**
  - Sleep mode suppresses non-critical autonomous actions.
  - User direct input can wake/interact according to rules.
  - Pillow/sleep prop expressed as intent, not renderer asset path.
- **Out of scope:** settings UI, renderer asset creation.

### P15-T02 — Реализовать cooldown/no-spam rules

- **Status:** `planned`
- **Owner:** `domain-behavior`
- **Depends on:** `P15-T01`.
- **Goal:** Ограничить частоту автономных реплик и действий.
- **Scope:** domain scheduling/cooldown logic.
- **Acceptance criteria:**
  - Wisp не отвлекает пользователя слишком часто.
  - Cooldowns testable as pure logic.
  - Manual user interaction bypasses or resets rules predictably.
- **Out of scope:** OS notifications, analytics.

### P15-T03 — Реализовать habits model

- **Status:** `planned`
- **Owner:** `domain-behavior`
- **Depends on:** `P15-T02`, `P14-T02`.
- **Goal:** Добавить любимые места/паттерны активности без сетевых зависимостей.
- **Scope:** domain behavior state.
- **Acceptance criteria:**
  - Habits не зависят от конкретной ОС.
  - Position preferences respect screen/work area constraints.
  - Memory integration optional through ports.
- **Out of scope:** SQLite schema changes unless already provided by Phase 14.

### P15-T04 — Проверить desktop-life behavior scenarios

- **Status:** `planned`
- **Owner:** `tester`
- **Depends on:** `P15-T03`.
- **Goal:** Проверить quiet mode, cooldowns, user-return и interrupt сценарии.
- **Scope:** domain tests and selected integration checks.
- **Acceptance criteria:**
  - Проверены inactivity, return after pause, sleep, wake, cooldown.
  - Автономное поведение не блокирует user input.
- **Out of scope:** packaging, backend.

### P15-G01 — Desktop-life review gate

- **Status:** `planned`
- **Owner:** `code-reviewer`
- **Depends on:** `P15-T04`.
- **Goal:** Проверить, что desktop-life behavior остался чистой domain/application логикой.
- **Scope:** changed files from Phase 15 only.
- **Acceptance criteria:**
  - Проверены cooldown/quiet/sleep boundaries.
  - Проверено, что domain не зависит от renderer assets или Electron.
  - Замечания оформлены без исправления кода.
- **Out of scope:** fixes, settings UI, renderer asset work.

### P15-G02 — Desktop-life fix gate

- **Status:** `planned`
- **Owner:** `fixer`
- **Depends on:** `P15-G01`.
- **Goal:** Исправить только подтверждённые замечания Desktop-life review.
- **Scope:** files mentioned in reviewer findings only.
- **Acceptance criteria:**
  - Исправлены только review findings.
  - Scope Phase 15 не расширен.
- **Out of scope:** новые behavior features.

---

## 13. Phase 16 — Settings & Control Surface

### P16-T01 — Описать settings contract

- **Status:** `planned`
- **Owner:** `architect`
- **Depends on:** `P14-T01`, `P15-T01`, `P13-T01`.
- **Goal:** Зафиксировать настройки поведения, внешности, памяти и debug mode.
- **Scope:** `docs/engine/SETTINGS_CONTRACT.md` или раздел в architecture docs.
- **Acceptance criteria:**
  - Behavior/appearance first.
  - OS integrations marked as later step.
  - Source of truth находится в Main/Application, UI только отображает/запрашивает изменения.
- **Out of scope:** implementation.

### P16-T02 — Реализовать behavior/appearance settings UI

- **Status:** `planned`
- **Owner:** `ui-specialist`
- **Depends on:** `P16-T01`, `P14-T02`, `P13-T03`, `P15-T02`.
- **Goal:** Дать пользователю базовые настройки внешности и интенсивности поведения.
- **Scope:** renderer settings UI and typed boundaries.
- **Acceptance criteria:**
  - Scale/theme/behavior intensity сохраняются локально.
  - UI не обращается напрямую к Node/Electron/SQLite.
  - Defaults можно восстановить.
- **Out of scope:** auth, billing, external provider settings.

### P16-T03 — Реализовать memory control UI

- **Status:** `planned`
- **Owner:** `ui-specialist`
- **Depends on:** `P16-T01`, `P14-T05`.
- **Goal:** Позволить пользователю увидеть краткий статус памяти и очистить её.
- **Scope:** renderer UI and application calls.
- **Acceptance criteria:**
  - Есть clear memory action.
  - Нет ручного редактирования отдельных memory entries.
  - UI не показывает лишние private facts в debug defaults.
- **Out of scope:** memory implementation internals.

### P16-T04 — Реализовать dev/debug panel

- **Status:** `planned`
- **Owner:** `ui-specialist`
- **Depends on:** `P16-T01`, `P13-T05`.
- **Goal:** Показать dev-only counters/status для состояния Wisp.
- **Scope:** renderer dev/debug UI.
- **Acceptance criteria:**
  - Debug panel доступен только в dev mode.
  - По умолчанию status/counters only.
  - Private memory facts hidden by default.
- **Out of scope:** production diagnostics, telemetry.

### P16-T05 — Проверить settings/control scenarios

- **Status:** `planned`
- **Owner:** `tester`
- **Depends on:** `P16-T02`, `P16-T03`, `P16-T04`.
- **Goal:** Проверить сохранение настроек, clear memory action и dev/debug visibility.
- **Scope:** settings UI and application boundary tests.
- **Acceptance criteria:**
  - Настройки behavior/appearance сохраняются и восстанавливаются.
  - Clear memory action вызывает application boundary, а не storage напрямую.
  - Debug panel доступен только в dev mode.
- **Out of scope:** OS integrations, auth/billing, external provider settings.

### P16-G01 — Settings review gate

- **Status:** `planned`
- **Owner:** `code-reviewer`
- **Depends on:** `P16-T05`.
- **Goal:** Проверить settings/control implementation и privacy defaults.
- **Scope:** changed files from Phase 16 only.
- **Acceptance criteria:**
  - Проверено, что UI не обращается напрямую к Node/Electron/SQLite.
  - Проверено, что private memory facts hidden by default.
  - Замечания оформлены без исправления кода.
- **Out of scope:** fixes, OS integrations.

### P16-G02 — Settings fix gate

- **Status:** `planned`
- **Owner:** `fixer`
- **Depends on:** `P16-G01`.
- **Goal:** Исправить только подтверждённые замечания Settings review.
- **Scope:** files mentioned in reviewer findings only.
- **Acceptance criteria:**
  - Исправлены только review findings.
  - Scope Phase 16 не расширен.
- **Out of scope:** новые settings features.

---

## 14. Phase 17 — External AI Contract Readiness

### P17-T01 — Обновить external backend contract notes

- **Status:** `planned`
- **Owner:** `architect`
- **Depends on:** `P09-T02`, `P10-G02`.
- **Goal:** Уточнить будущий client-side контракт к отдельному backend.
- **Scope:** `docs/engine/AI_PROVIDER_CONTRACT.md`.
- **Acceptance criteria:**
  - Dev/prod backend explicitly lives in another repo.
  - Desktop client consumes contract, does not implement gateway.
  - Auth/billing are future client-side contract concerns only.
- **Out of scope:** backend implementation, proxy, SDK keys.

### P17-T02 — Добавить provider selection design

- **Status:** `planned`
- **Owner:** `architect`
- **Depends on:** `P17-T01`.
- **Goal:** Описать dev-only provider selection без реального backend.
- **Scope:** docs only first.
- **Acceptance criteria:**
  - `MockAIProvider` remains default.
  - `ExternalAIProviderClient` is optional future adapter.
  - Failure/offline/rate-limit states have mapping rules.
- **Out of scope:** сетевые вызовы.

### P17-T03 — Реализовать `ExternalAIProviderClient` stub

- **Status:** `planned`
- **Owner:** `mock-ai-provider`
- **Depends on:** `P17-T02`.
- **Goal:** Добавить client-side adapter skeleton после architect approval.
- **Scope:** provider adapter boundary only.
- **Acceptance criteria:**
  - Stub не содержит URL реального сервиса, ключей или SDK.
  - Stub можно отключить/не собирать в production if needed.
  - UI/behavior не меняются.
- **Out of scope:** dev backend repo, auth flow, billing.

### P17-G01 — External AI readiness review gate

- **Status:** `planned`
- **Owner:** `code-reviewer`
- **Depends on:** `P17-T03`.
- **Goal:** Проверить, что future external AI readiness не добавила backend/proxy/SDK leakage.
- **Scope:** changed files from Phase 17 only.
- **Acceptance criteria:**
  - `MockAIProvider` остаётся default.
  - `ExternalAIProviderClient` остаётся client-side adapter/stub.
  - В repo нет backend/proxy/server implementation.
- **Out of scope:** fixes, real backend validation.

### P17-G02 — External AI readiness fix gate

- **Status:** `planned`
- **Owner:** `fixer`
- **Depends on:** `P17-G01`.
- **Goal:** Исправить только подтверждённые замечания External AI readiness review.
- **Scope:** files mentioned in reviewer findings only.
- **Acceptance criteria:**
  - Исправлены только review findings.
  - В repo по-прежнему нет backend/proxy/server implementation.
- **Out of scope:** real backend, auth flow, billing, new provider features.

---

## 15. Phase 18 — Stability & Performance Hardening

### P18-T01 — Составить performance scenario matrix

- **Status:** `planned`
- **Owner:** `tester`
- **Depends on:** `P16-G02`, `P17-G02`.
- **Goal:** Описать реальные сценарии длительной desktop-сессии.
- **Scope:** test plan docs and test checklist.
- **Acceptance criteria:**
  - Есть сценарии idle, chat, sleep, drag, settings, long session.
  - Есть Linux Ubuntu baseline и Wayland/X11 notes.
  - Нет абстрактного "100% coverage".
- **Out of scope:** production packaging.

### P18-T02 — Проверить timer/listener cleanup

- **Status:** `planned`
- **Owner:** `tester`
- **Depends on:** `P18-T01`.
- **Goal:** Найти утечки timers/subscriptions/IPC listeners.
- **Scope:** tests/audit for changed runtime areas.
- **Acceptance criteria:**
  - Проверены cleanup paths для renderer/domain/application listeners.
  - Findings переданы `fixer`, если есть.
- **Out of scope:** unrelated refactor.

### P18-T03 — Проверить Wayland/X11 fallback behavior

- **Status:** `planned`
- **Owner:** `tester`
- **Depends on:** `P18-T01`.
- **Goal:** Проверить прозрачность, click-through и positioning degradation.
- **Scope:** Linux smoke tests and platform notes.
- **Acceptance criteria:**
  - Поведение на Wayland описано без обещания невозможной идентичности с X11.
  - Fallbacks documented.
- **Out of scope:** Windows/macOS full QA.

### P18-G01 — Stability fix gate

- **Status:** `planned`
- **Owner:** `fixer`
- **Depends on:** `P18-T02`, `P18-T03`.
- **Goal:** Исправить только подтверждённые tester findings из hardening phase.
- **Scope:** files mentioned in tester findings only.
- **Acceptance criteria:**
  - Исправлены только подтверждённые timer/listener/fallback issues.
  - Нет unrelated refactor.
- **Out of scope:** новые фичи, packaging.

---

## 16. Phase 19 — Production Packaging

### P19-T01 — Описать packaging strategy

- **Status:** `planned`
- **Owner:** `electron-platform`
- **Depends on:** `P18-G01`.
- **Goal:** Зафиксировать путь к автономному desktop release без пользовательских ключей и серверов.
- **Scope:** packaging docs/config planning.
- **Acceptance criteria:**
  - Linux baseline описан первым.
  - Windows/macOS requirements перечислены отдельно.
  - Release не требует backend/server/API keys.
- **Out of scope:** publishing pipeline.

### P19-T02 — Подготовить Linux package baseline

- **Status:** `planned`
- **Owner:** `electron-platform`
- **Depends on:** `P19-T01`.
- **Goal:** Настроить базовую сборку Linux package.
- **Scope:** Electron packaging config.
- **Acceptance criteria:**
  - Package устанавливается и запускается на Ubuntu baseline.
  - Данные пользователя идут через `app.getPath('userData')`.
  - Нет backend/server implementation.
- **Out of scope:** store publishing, auto-update.

### P19-T03 — Проверить final release smoke

- **Status:** `planned`
- **Owner:** `tester`
- **Depends on:** `P19-T02`.
- **Goal:** Проверить путь "скачал -> установил -> Wisp ожил".
- **Scope:** release smoke checklist.
- **Acceptance criteria:**
  - Запуск не требует API-ключей, локального сервера или ручной настройки.
  - Основные сценарии: visible pet, drag, chat mock, sleep, settings, clear memory.
  - Known platform limitations documented.
- **Out of scope:** backend contract validation.

### P19-G01 — Packaging review gate

- **Status:** `planned`
- **Owner:** `code-reviewer`
- **Depends on:** `P19-T03`.
- **Goal:** Проверить packaging changes и сформировать release-blocking findings.
- **Scope:** packaging and release docs/config only.
- **Acceptance criteria:**
  - Проверено, что release не требует API-ключей, backend/server или ручной настройки.
  - Проверены platform adapter boundaries для packaging-related changes.
  - Findings готовы для `P19-G02`, если они появятся.
- **Out of scope:** исправления, auto-update, store publishing.

### P19-G02 — Packaging fix gate

- **Status:** `planned`
- **Owner:** `fixer`
- **Depends on:** `P19-G01`.
- **Goal:** Исправить только release-blocking замечания Packaging review.
- **Scope:** files mentioned in reviewer findings only.
- **Acceptance criteria:**
  - Исправлены только release-blocking findings.
  - Release по-прежнему не требует API-ключей, backend/server или ручной настройки.
- **Out of scope:** auto-update, store publishing, unrelated release polish.

---

## 17. Правило передачи задачи агенту

Project Manager не должен копировать агенту целый раздел `ROADMAP.md`.

Вместо этого он берёт одну задачу из этого файла и оформляет prompt:

```markdown
Goal:
<цель одной задачи из task breakdown>

Context:
<roadmap phase + relevant docs>

Owner:
<agent role>

Constraints:
<layer boundaries, forbidden files/areas, repo hard constraints>

Acceptance criteria:
- [ ] ...

Out of scope:
<что агент точно не делает>
```

Если задача требует изменения public contracts, `docs/engine/*`, IPC, ports или provider/render/behavior boundaries, первым owner должен быть `architect`.
