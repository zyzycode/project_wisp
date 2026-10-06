# AGENTS: Desktop Wisp

Применяется к desktop-коду в `src/`; [tests/AGENTS.md](../tests/AGENTS.md) и [public/AGENTS.md](../public/AGENTS.md) распространяют эти правила на тесты и ассеты. Общие правила и роли — в [корневом AGENTS.md](../AGENTS.md). Для desktop tooling в корне читать этот файл до изменений.

## 1. Автономность и платформа

- Desktop-клиент с локальным автономным runtime: Electron + React + TypeScript, собственный FSM персонажа в `src/domain/character/`, отображение через Renderer/PixiJS.
- Backend — часть целевой архитектуры; серверы, серверные БД и при обоснованной необходимости микросервисы допустимы. Offline-first относится к локальному runtime персонажа и локальным данным (SQLite/config files); сетевые функции могут требовать подключения. Недоступность backend не останавливает локальные FSM, Motion и ввод.
- Первая целевая платформа и приоритет приёмки — Windows (Windows-first). Linux (Ubuntu, Wayland/X11) и macOS сохраняются как целевые платформы с capability fallback. Файловые пути собирать через `path.join`; соблюдать точный регистр файлов и импортов.
- ОС-специфика и `process.platform` — исключительно в `src/infrastructure/platform/` за `IPlatformAdapter`.

## 2. Архитектура и контракты

| Слой | Владеет | Граница |
|---|---|---|
| Domain | Бизнес-логика, Needs/Mood, FSM, кинематика, правила анимации | Чистый детерминированный TS; без React/DOM, Electron, Node.js, SQLite, AI SDK. Время, RNG, события — явные входы; без системных таймеров, `Date.now()` и `Math.random()`. |
| Application | Use cases, команды/запросы, оркестрация, порты | Платформенно-нейтрален, без UI/SQL и семантических решений за Domain. Порт объявляет потребитель в `src/application/ports/`. |
| Infrastructure | Реализации портов | Инкапсулирует Electron, ОС, файловую систему, SQLite, AI-провайдеры. |
| Main | Окна, IPC handlers, DI, оркестрация use cases | Единственный владелец внешних сетевых вызовов desktop-клиента через Infrastructure adapters. |
| Renderer | Presentation и пользовательский ввод | Не владеет бизнес-логикой, FSM или физикой. |

- **Contracts-first:** объявить/обновить порты в `src/application/ports/` и DTO в `src/shared/ipc-contracts.ts` **до** реализации сервисов/адаптеров.
- `IAIProvider` возвращает семантический DTO, не знает React/DOM, стили и кадры. Render владеет visual props/слоями/геометрией, Animation — клипами/приоритетами/прерываниями.
- Правила движка — в его канонической [спецификации](../docs/engine/README.md), формы типов — в коде. При конфликте не выбирать удобную версию: остановить затронутую часть и запросить `architect`.

## 3. Безопасность Electron и IPC

- Все `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer обращается к Main только через typed `window.wispAPI` из `src/preload/`; прямые `ipcRenderer.send/invoke` со строковыми каналами запрещены.
- Main валидирует все входы IPC до обработки. Renderer не выполняет сетевых запросов и не получает Node.js/persistence/provider internals.
- Provider credentials сервера не передаются в desktop; клиентская сессия и секреты инкапсулируются вне Renderer.

## 4. UI и производительность

React отображает presentation state и передаёт действия в IPC. Избегать лишних ререндеров; анимации — `requestAnimationFrame`/CSS transforms (`translate3d`). Перемещение окна — IPC-батчами, без частых попиксельных синхронных вызовов.

## 6. TypeScript и код

Strict mode; запрет `any`, двойных приведений `as unknown as T`, `@ts-ignore`. Использовать `unknown` с guards; `@ts-expect-error` — только с причиной. IPC/события/сущности строго типизированы, свойства `readonly` по умолчанию. Явные имена, без мёртвого кода/неиспользуемых импортов; ориентир — до 300 строк реализации на файл.

## 7. Тестирование и рефакторинг

Багфикс начинается с воспроизведения и падающего регрессионного теста. Рефакторинг сохраняет поведение, опирается на тесты и не смешивается с фичами. Unit-тесты мокают внешние адаптеры; таймеры — через Vitest fake timers.

## Ассеты и проверки

Готовые ассеты — только `public/assets/sprites/`, манифест — `public/assets/sprites/manifest.json`. Если ассета нет: fallback/заглушка/алиас в коде + запись в [SPRITE_REQUESTS](../docs/art/SPRITE_REQUESTS.md): Task ID, ключ, fallback, требования к кадрам/движению. Ключи указать в `SPRITES` отчёта.

Для desktop-реализации: `npm run typecheck`, затем `npm test` из корня. Таймеры — через Vitest fake timers. Независимый reviewer выполняет typecheck и аудит diff; `npm test` ему запрещён. `npm run build` запрещён всем ролям. Использовать существующие скрипты `package.json`.
