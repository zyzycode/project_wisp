# Project Wisp: Правила для агентов

Этот документ определяет роли и контекст агентов. Полные правила: [.agents/rules/rules.md](.agents/rules/rules.md).

## Стек и окружение

- Linux (Ubuntu / Wayland / X11) — основной baseline разработки и smoke verification.
- Runtime: Node.js 22 LTS, npm.
- Framework: Electron 35, React 19, TypeScript 5.8 (Strict Mode).
- Build/Dev: Vite 6, `@vitejs/plugin-react`.
- Tests: Vitest 3.
- Архитектура: Desktop-first, Clean Architecture, Main/Renderer isolation, typed IPC.
- Документация движков: [docs/engine/README.md](docs/engine/README.md).

## Ограничения

- **Desktop Offline-First:** строго локальное настольное приложение (Electron + React + TypeScript). Запрещено добавление серверных backend-прослоек, удаленных БД и микросервисов.
- Никаких внешних runtime-зависимостей без отдельного согласования.
- **Zero New Dependencies First:** перед добавлением npm-пакета агент обязан проверить, решается ли задача стандартными средствами Node.js / Electron / React / Web API.
- Новую npm-зависимость до реализации оценивает `architect`:
  1. Лицензия: MIT, Apache 2.0, BSD, ISC (GPL/AGPL запрещены).
  2. Размер и transitives: bundlephobia / npm trends, минимальный overhead.
  3. Активность: релизы за последний год, отсутствие открытых критических CVE.
  4. Нативные биндинги: предпочтение pure JS/WASM перед native C++ (node-gyp риски сборки на разных платформах).
  5. Альтернатива: почему нельзя написать 50-100 строк собственного кода.

## Кроссплатформенность

- Пути: только `path.join`, никаких ручных слэшей в файловых операциях.
- Регистр: в коде и документации имена файлов и импорты должны строго совпадать с регистром на файловой системе (чувствительность Linux).
- ОС-специфичные модули и ветвления (`process.platform`) изолируются в адаптерах: `src/infrastructure/platform/`.

## Изоляция слоёв

- Renderer не импортирует Node.js, Electron, persistence или provider internals. Доступ только через типизированный мост `window.wispAPI` из `src/preload/`.
- Domain не зависит от Electron, React, UI, Node.js, провайдеров и внешних библиотек.
- Application остаётся платформенно-нейтральным.
- Main процесс владеет жизненным циклом и управляет окнами.

## Обзор архитектуры

`ARCHITECTURE.md` — объясняющий обзор для людей, а не источник технических требований. Он не входит в обязательный контекст агента; читать его только при явной задаче на сам обзор.

## Отдельный скоуп ассетов

Генерация и обработка спрайтов — отдельный скоуп: следовать [asset-pipeline/AGENTS.md](asset-pipeline/AGENTS.md). Он размещает PNG, но не меняет манифест и runtime. Агент приложения не читает материалы генерации без необходимости.

## Изолированный скоуп Discord

Директория `discord_orcestrations/` — полностью автономная инфраструктура Discord-бота и сообщества. Продуктовые агенты Wisp туда не заходят, не модифицируют её и не импортируют оттуда код. См. [discord_orcestrations/.agent.md](discord_orcestrations/.agent.md).

Общий навигатор — [docs/README.md](docs/README.md).

## Роли агентов

Перед работой прочитать инструкцию назначенной роли по ссылке ниже, не остальные роли. «Ты менеджер» или «менеджер проекта» означает `project-manager`.

- [project-manager](.agents/agents/project-manager/agent.md): scope, маршрутизация задач (Fast-Track по умолчанию, Architect только по 4 триггерам), task backlog в GitHub Issues. Не меняет продуктовый код. Подключается после завершения задачи (`Approved` / `done`).
- [architect](.agents/agents/architect/agent.md): архитектура подсистем, инварианты в `docs/engine/*` и объявление целевых контрактов в кодовой базе (типы портов в `src/application/ports/` и DTO в `src/shared/ipc-contracts.ts`). Старый запрет «docs-only» устранён: объявляет и актуализирует интерфейсы в коде. Dependency Review.
- [app-developer](.agents/agents/app-developer/agent.md): реализация задач на Fast-Track (объявление/расширение портов и DTO, Domain/Application, Main/Preload, Renderer, adapters, packaging), реализация логики, сервисов, UI и тестов.
- [reviewer](.agents/agents/reviewer/agent.md): review, verification, test strategy. Проверяет как docs, так и код контрактов архитектора (`npm run typecheck`). Не отклоняет задачи архитектора из-за файлов в `src/`. Имеет право на точечный Fast-Fix мелких неточностей типов/тестов без возврата задачи.

## Автономный цикл реализации

Роли (`architect`, `app-developer`, `reviewer`) работают внутри цикла задачи (`implementation/fixes <-> review`) автономно без передачи промежуточных шагов менеджеру. Project Manager подключается только после закрытия задачи (`Approved` / `done`).

## Рабочие правила

Перед правками определить затронутые файлы и короткий план. Делать самый маленький vertical slice, который закрывает задачу. Использовать существующие абстракции. Сохранять кроссплатформенные границы. Не менять unrelated files и не откатывать чужие изменения.

Проверка:

- Изменения продуктового кода логики/адаптеров (`owner: app-developer`) требуют `npm run typecheck && npm test`.
- Архитектурные задачи с объявлением портов/DTO (`owner: architect`) требуют `npm run typecheck` и проверку markdown/diff consistency; продуктовые тесты (`npm test`) пишутся разработчиком при реализации логики.
- Изменения только чистой документации требуют проверки markdown/diff consistency.
- Project Manager не запускает продуктовые тесты для обычной работы с документацией и планированием.

Общий отчёт исполнителя: `TASK` (Task ID, scope) → `CHANGES` → `BOUNDARIES` → `VERIFICATION` (результаты или `NOT RUN` с причиной) → `RECOMMENDED NEXT GATE` (`reviewer` / `architect` / `blocked` / `done`).
