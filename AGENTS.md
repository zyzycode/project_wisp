# AGENTS.md — рабочие правила Project Wisp

Этот файл — верхнеуровневое руководство для агентов и разработчиков. Он должен оставаться коротким; исполнимые карточки задач живут в [GitHub Issues](https://github.com/zyzycode/project_wisp/issues), а стабильные контракты движков — в `docs/engine/*.md`.

## Контекст проекта

- Desktop-first/offline-first MVP: один AI-компаньон на рабочем столе с движением, реакциями, эмоциями, локальной памятью и диалогом.
- Платформы: Linux, Windows, macOS; базовая среда разработки — Ubuntu Linux.
- Стек: Electron, строгий TypeScript, React, Zustand, типизированный IPC.
- AI: `IAIProvider` с локальным `MockAIProvider`. Для памяти и настроек планируется SQLite за репозиториями Main-процесса.
- Пользователь не регистрируется у AI-провайдеров, не вводит API-ключи, не запускает и не администрирует серверы; понимание токенов/моделей не требуется.

## Жёсткие ограничения

- Никакой серверной auth/billing-логики.
- Новые npm-зависимости запрещены без Dependency Review.
- Никакого нецелевого рефакторинга.
- Domain и Application остаются платформонезависимыми.
- Платформозависимое поведение живёт за platform adapters.
- Renderer не имеет доступа к Node.js и не знает детали хранилища, provider или ОС.

## Dependency Review

Новую npm-зависимость до реализации оценивает `architect`:

1. **Необходимость:** TypeScript, Node.js, Electron и Web API недостаточны.
2. **Пропорциональность:** библиотека решает значимую задачу, а не добавляет локальное удобство.
3. **Операционная поверхность:** приемлемы размер, транзитивные зависимости и состояние поддержки.
4. **Архитектурная изоляция:** зависимость ограничена Infrastructure/adapter и не проникает в Domain, Application или Renderer.
5. **Альтернатива:** самописное решение хуже по безопасности, надёжности или стоимости поддержки.

Решение — `approved` с обоснованием и ограничениями либо `rejected` с альтернативой. Его фиксируют в ADR или назначенной GitHub Issue.

## Архитектура кратко

- Main process: окна, IPC handlers, application use cases, оркестрация домена, persistence adapters.
- Preload: минимальный типизированный мост `window.wispAPI` с `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Provider: возвращает semantic response DTO; он не управляет React, DOM, CSS, ассетами или кадрами анимации.

Направление зависимостей и границы Domain/Renderer — в [архитектурных правилах](.agents/rules/10-architecture.md).

## Бюджет контекста

Агенты не читают весь markdown "на всякий случай".

Минимум для большинства задач приложения:

- `AGENTS.md` и инструкция назначенной роли;
- одна назначенная GitHub Issue;
- только документы-источники, названные в Issue;
- только файлы кода, нужные для задачи.

Архитектурные границы проверять по `.agents/rules/10-architecture.md`. Остальные `.agents/rules/*.md` читать только для релевантного слоя, `docs/engine/*.md` — только нужные разделы профильного контракта.

`ARCHITECTURE.md` — объясняющий обзор для людей, а не источник технических требований. Он не входит в обязательный контекст агента; читать его только при явной задаче на сам обзор.

Целевой размер markdown:

- `AGENTS.md`: до 120 строк.

## Отдельный скоуп ассетов

Генерация и обработка спрайтов — отдельный скоуп: следовать [asset-pipeline/AGENTS.md](asset-pipeline/AGENTS.md). Он размещает PNG, но не меняет манифест и runtime. Агент приложения не читает материалы генерации без необходимости.

Общий навигатор — [docs/README.md](docs/README.md).

## Роли агентов

Перед работой прочитать инструкцию назначенной роли по ссылке ниже, не остальные роли. «Ты менеджер» или «менеджер проекта» означает `project-manager`.

- [project-manager](.agents/agents/project-manager/agent.md): scope, маршрутизация задач, roadmap/backlog docs. Не меняет продуктовый код.
- [architect](.agents/agents/architect/agent.md): границы слоёв, IPC/ports, engine contracts, `docs/engine/*`.
- [app-developer](.agents/agents/app-developer/agent.md): основной desktop implementation: Main/Preload, Renderer UI, IPC, platform adapters, persistence/provider adapters.
- [domain-behavior](.agents/agents/domain-behavior/agent.md): character engine, behavior FSM, animation FSM.
- [reviewer](.agents/agents/reviewer/agent.md): review, verification, test strategy. Не чинит findings в том же review-pass.

## Рабочие правила

Перед правками определить затронутые файлы и короткий план. Делать самый маленький vertical slice, который закрывает задачу. Использовать существующие абстракции. Сохранять кроссплатформенные границы. Не менять unrelated files и не откатывать чужие изменения.

Проверка:

- Изменения продуктового кода требуют подходящие typecheck/lint/tests.
- Изменения только документации требуют проверки markdown/diff consistency.
- Project Manager не запускает продуктовые тесты для обычной работы с документацией и планированием.

Общий отчёт исполнителя: `TASK` (Task ID, scope) → `CHANGES` → `BOUNDARIES` → `VERIFICATION` (результаты или `NOT RUN` с причиной) → `RECOMMENDED NEXT GATE` (`reviewer` / `architect` / `blocked` / `done`).

Шаблон постановки задачи — в [инструкции project-manager](.agents/agents/project-manager/agent.md#формат-задачи).
