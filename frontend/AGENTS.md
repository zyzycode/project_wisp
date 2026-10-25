# AGENTS: Desktop Wisp

Правила для всего `frontend/`: кода, тестов, ассетов и desktop tooling. Дополнительные правила — в [tests/AGENTS.md](tests/AGENTS.md) и [public/AGENTS.md](public/AGENTS.md); общие правила и роли — в [корневом AGENTS.md](../AGENTS.md).

Корневые launcher scripts в `scripts/` работают вне desktop runtime и могут определять ОС для управления своими процессами. В коде приложения ОС-логика разрешена только в platform adapters.

## 1. Автономность и платформа

- Desktop-клиент с локальным автономным runtime: Electron + React + TypeScript, собственный FSM персонажа в `frontend/src/domain/character/`, отображение через React/SVG Renderer.
- В целевой архитектуре допустимы серверы, серверные БД и, при обоснованной необходимости, микросервисы.
- Приёмка в первую очередь на Windows. Linux (Ubuntu, Wayland/X11) и macOS — целевые платформы с capability fallback. Файловые пути собирать через `path.join`; соблюдать точный регистр файлов и импортов.
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
- Правила движка — в канонических [спецификациях](docs/engine/README.md), формы типов — в коде; общие wire-контракты — в [docs/contracts/](../docs/contracts/README.md).

## 3. Безопасность Electron и IPC

- Все `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer обращается к Main только через typed `window.wispAPI` из `frontend/src/preload/`; прямые `ipcRenderer.send/invoke` со строковыми каналами запрещены.
- Main валидирует все входы IPC до обработки. Renderer не выполняет сетевых запросов и не получает Node.js/persistence/provider internals.

## 4. UI и производительность

React отображает presentation state и передаёт действия в IPC. Избегать лишних ререндеров; анимации — `requestAnimationFrame`/CSS transforms (`translate3d`). Перемещение окна — IPC-батчами, без частых попиксельных синхронных вызовов.

## 5. TypeScript и код

Strict mode; запрет `any`, двойных приведений `as unknown as T`, `@ts-ignore`. Использовать `unknown` с guards; `@ts-expect-error` — только с причиной. IPC/события/сущности строго типизированы, свойства `readonly` по умолчанию.

## 6. Тестирование и рефакторинг

Тестирование и рефакторинг — по [корневому AGENTS.md §7](../AGENTS.md#7-тестирование-и-рефакторинг); таймеры в тестах — через Vitest fake timers.

## 7. Ассеты и проверки

Готовые ассеты — только `frontend/public/assets/sprites/`, манифест — `frontend/public/assets/sprites/manifest.json`. При отсутствии ассета использовать fallback/заглушку/алиас в коде; в `SPRITES` отчёта указать ключ, выбранный fallback и требования к кадрам/движению.

Обязательные проверки и команды — в [корневом AGENTS.md §11](../AGENTS.md#11-план-верификация-и-отчёт).
