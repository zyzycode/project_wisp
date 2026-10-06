# AGENTS: Desktop Wisp

Применяется ко всему `frontend/`, включая код, тесты, ассеты и desktop tooling; [tests/AGENTS.md](tests/AGENTS.md) и [public/AGENTS.md](public/AGENTS.md) распространяют эти правила на тесты и ассеты. Общие правила и роли — в [корневом AGENTS.md](../AGENTS.md). Общие launcher scripts в корневом `scripts/` — host tooling, вне desktop runtime; они могут определять ОС для управления собственными процессами. Это исключение не разрешает ОС-логику вне platform adapters в коде приложения.

## 1. Автономность и платформа

- Desktop-клиент с локальным автономным runtime: Electron + React + TypeScript, собственный FSM персонажа в `frontend/src/domain/character/`, отображение через Renderer/PixiJS.
- Backend — часть целевой архитектуры; серверы, серверные БД и при обоснованной необходимости микросервисы допустимы. Offline-first относится к локальному runtime персонажа и локальным данным (SQLite/config files); сетевые функции могут требовать подключения. Недоступность backend не останавливает локальные FSM, Motion и ввод.
- Первая целевая платформа и приоритет приёмки — Windows (Windows-first). Linux (Ubuntu, Wayland/X11) и macOS сохраняются как целевые платформы с capability fallback. Файловые пути собирать через `path.join`; соблюдать точный регистр файлов и импортов.
- ОС-специфика и `process.platform` — исключительно в `frontend/src/infrastructure/platform/` за `IPlatformAdapter`.

## 2. Архитектура и контракты

| Слой | Владеет | Граница |
|---|---|---|
| Domain | Бизнес-логика, Needs/Mood, FSM, кинематика, правила анимации | Чистый детерминированный TS; без React/DOM, Electron, Node.js, SQLite, AI SDK. Время, RNG, события — явные входы; без системных таймеров, `Date.now()` и `Math.random()`. |
| Application | Use cases, команды/запросы, оркестрация, порты | Платформенно-нейтрален, без UI/SQL и семантических решений за Domain. Порт объявляет потребитель в `frontend/src/application/ports/`. |
| Infrastructure | Реализации портов | Инкапсулирует Electron, ОС, файловую систему, SQLite, AI-провайдеры. |
| Main | Окна, IPC handlers, DI, оркестрация use cases | Единственный владелец внешних сетевых вызовов desktop-клиента через Infrastructure adapters. |
| Renderer | Presentation и пользовательский ввод | Не владеет бизнес-логикой, FSM или физикой. |

- **Contracts-first:** объявить/обновить порты в `frontend/src/application/ports/` и DTO в `frontend/src/shared/ipc-contracts.ts` **до** реализации сервисов/адаптеров.
- `IAIProvider` возвращает семантический DTO, не знает React/DOM, стили и кадры. Render владеет visual props/слоями/геометрией, Animation — клипами/приоритетами/прерываниями.
- Правила движка — в его канонической [спецификации](../docs/engine/README.md), формы типов — в коде. При конфликте не выбирать удобную версию: остановить затронутую часть и запросить `architect`.

## 3. Безопасность Electron и IPC

- Все `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer обращается к Main только через typed `window.wispAPI` из `frontend/src/preload/`; прямые `ipcRenderer.send/invoke` со строковыми каналами запрещены.
- Main валидирует все входы IPC до обработки. Renderer не выполняет сетевых запросов и не получает Node.js/persistence/provider internals.
- Provider credentials сервера не передаются в desktop; клиентская сессия и секреты инкапсулируются вне Renderer.

## 4. UI и производительность

React отображает presentation state и передаёт действия в IPC. Избегать лишних ререндеров; анимации — `requestAnimationFrame`/CSS transforms (`translate3d`). Перемещение окна — IPC-батчами, без частых попиксельных синхронных вызовов.

## 6. TypeScript и код

Strict mode; запрет `any`, двойных приведений `as unknown as T`, `@ts-ignore`. Использовать `unknown` с guards; `@ts-expect-error` — только с причиной. IPC/события/сущности строго типизированы, свойства `readonly` по умолчанию. Явные имена, без мёртвого кода/неиспользуемых импортов; ориентир — до 300 строк реализации на файл.

## 7. Тестирование и рефакторинг

Багфикс начинается с воспроизведения и падающего регрессионного теста. Рефакторинг сохраняет поведение, опирается на тесты и не смешивается с фичами. Unit-тесты мокают внешние адаптеры; таймеры — через Vitest fake timers.

## Ассеты и проверки

Готовые ассеты — только `frontend/public/assets/sprites/`, манифест — `frontend/public/assets/sprites/manifest.json`. Если ассета нет: fallback/заглушка/алиас в коде; в отчёте задачи указать ключ, fallback и требования к кадрам/движению. Ключи указать в `SPRITES` отчёта.

Для desktop-реализации: `node scripts/wisp.mjs typecheck`, затем `node scripts/wisp.mjs test:frontend` из корня; при изменении обеих частей — `node scripts/wisp.mjs test`. Таймеры — через Vitest fake timers. `npm run build` запрещён всем ролям. Использовать скрипты `frontend/package.json` и корневой Node CLI.
