# AGENTS.md — рабочие правила Project Wisp

Этот файл — верхнеуровневое руководство для агентов и разработчиков. Он должен оставаться коротким; исполнимые карточки задач живут в [GitHub Issues](https://github.com/zyzycode/project_wisp/issues), а стабильные контракты движков — в `docs/engine/*.md`.

## Продукт

Project Wisp — кроссплатформенный desktop AI-компаньон в духе desktop pets: один персонаж живёт на рабочем столе, двигается, реагирует, выражает эмоции, помнит локально и может общаться.

Обещание пользователю: скачал, установил, Wisp ожил. Пользователь не должен регистрироваться у AI-провайдеров, вставлять API-ключи, понимать токены/модели, запускать локальные серверы или заниматься администрированием.

## Текущий объём работ

Репозиторий — desktop-first и offline-first MVP.

- Целевые платформы: Linux, Windows, macOS.
- Базовая среда разработки: Ubuntu Linux.
- Стек приложения: Electron, TypeScript в строгом режиме, React, Zustand, типизированный IPC.
- AI-слой: граница `IAIProvider`, текущая реализация — локальный `MockAIProvider`.
- Хранение данных: локальный SQLite за репозиториями Main-процесса, когда начнутся память и настройки.

## Жёсткие ограничения

- Никакого backend/proxy/server кода в `project_wisp`.
- Никаких официальных внешних AI SDK в desktop-клиенте.
- Никаких пользовательских AI API-ключей.
- Никакой серверной auth/billing-логики.
- Никаких лишних npm-зависимостей.
- Никакого нецелевого рефакторинга.
- Domain и Application остаются платформонезависимыми.
- Платформозависимое поведение живёт за platform adapters.
- Renderer не имеет доступа к Node.js и не знает детали хранилища, provider или ОС.

## Архитектура кратко

Поток:

```text
Renderer UI -> typed preload/IPC -> Application use cases -> Domain -> Ports <- Infrastructure adapters
```

Владение:

- Main process: окна, IPC handlers, application use cases, оркестрация домена, persistence adapters.
- Preload: минимальный типизированный мост `window.wispAPI` с `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer: только React UI и состояние отображения.
- Domain: чистый TypeScript для поведения, анимаций и правил персонажа.
- Provider: возвращает semantic response DTO; он не управляет React, DOM, CSS, ассетами или кадрами анимации.

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
