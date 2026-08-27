# 10-architecture.md — Архитектурные правила и границы ответственности

Правила структурирования кода, направления зависимостей и изоляции модулей в Project Wisp.

---

## 1. Направление зависимостей (Dependency Direction)

Зависимости должны быть направлены строго внутрь к ядру системы:

$$\text{UI / Presentation} \longrightarrow \text{Application (Use Cases)} \longrightarrow \text{Domain (Entities \& State Machines)} \longleftarrow \text{Infrastructure (Adapters)}$$

- **Domain Layer** не зависит ни от чего. Это чистый TypeScript и полностью OS-neutral. В нём нет импортов из `electron`, `react`, `better-sqlite3`, Node.js или сетевых библиотек, а также вызовов `process.platform`.
- **Application Layer** зависит только от Domain и объявляет абстрактные интерфейсы (Ports) для работы с внешним миром (хранилище, AI, платформа).
- **Infrastructure Layer** реализует эти интерфейсы (Adapters) и инкапсулирует вызовы к сторонним библиотекам, базе данных и платформозависимым Electron APIs.
- **UI / Presentation Layer** (Renderer) зависит от контрактов IPC и React, но не имеет прямого доступа к Domain/Infrastructure слоям Main-процесса.

---

## 2. Кроссплатформенная изоляция (Cross-Platform Isolation)
- Все вызовы, зависящие от ОС (управление окнами, прозрачность, Always-On-Top, пути к файлам данных, автозапуск, трей, уведомления), **обязаны быть изолированы за абстракциями `IPlatformAdapter` в слое инфраструктуры**.
- Запрещено использовать `process.platform` напрямую в React, Use Cases или сущностях Domain.
- Подробные правила описаны в [70-cross-platform.md](./70-cross-platform.md).

---

## 3. Изоляция бизнес-логики от UI (No UI Business Logic)
- React-компоненты являются исключительно презентационными.
- Запрещено размещать в компонентах React:
  - Расчёт физики и траекторий движения персонажа.
  - Логику принятия решений поведения (какую анимацию включить, куда пойти).
  - Прямые манипуляции с хранилищем или генерацию ответов AI.
- Компонент React только **отображает переданное состояние** и **диспатчит намерения пользователя** через `window.wispAPI`.

---

## 4. Принцип сменяемости провайдеров (No Provider Leakage)
- Никакие типы данных от конкретных AI SDK (типы сообщений OpenAI, структуры Gemini и т.д.) не должны проникать в Domain, Application или UI слои.
- Provider возвращает semantic DTO по контракту `IAIProvider`, но не управляет UI, DOM, React state, конкретными SVG/sprite assets или animation frames.
- `ProviderResponseIntentMapper` в Application переводит provider DTO во внутренний `BehaviorIntent`.
- Domain/Character Engine принимает behavior decisions и не видит raw provider DTO.
- Текущая реализация — `MockAIProvider`. Будущая внешняя интеграция допускается только как client-side adapter к готовому backend-контракту из отдельного репозитория, например `ExternalAIProviderClient`.
- Запрещено проектировать или реализовывать `WispBackendGateway`, cloud/dev AI gateway, backend/proxy/server implementation, прямые HTTP-клиенты к LLM или хранение пользовательских AI API-ключей в `project_wisp`.

---

## 5. Engine contracts

- `docs/engine/*` являются source of truth для `IAIProvider`, `BehaviorIntent`, `AnimationIntent`, Character Engine, Animation Engine, Render Engine, Memory и Settings contracts.
- Implementer-агенты читают engine contracts и следуют им, но не меняют public contracts без Architect review.
- Render Engine отвечает за visual render props, layers, SVG/sprite sheets, hitbox, visual bounds и scaling. Он не является game engine и не принимает behavior decisions.
- Animation Engine отвечает за animation intents, clips, priority и interrupt rules. Детальные параметры sprite sheet нарезки принадлежат Render Engine / asset contract.

---

## 6. Запрет на God-модули и циклические зависимости
- Модули должны иметь одну чётко выраженную ответственность (Single Responsibility Principle).
- Запрещены циклические зависимости (`A -> B -> A`). Структурируйте код так, чтобы общие типы и контракты лежали в выделенных модулях `shared/`.
- Файлы размером более 300 строк кода должны рассматриваться как кандидаты на декомпозицию.

---

## 7. Правило определения интерфейсов
- Интерфейс объявляется **там, где он используется (потребителем)**, а не там, где он реализуется.
- Интерфейс `IAIProvider` живёт в `application/ports/`, а его реализация `MockAIProvider` — в `infrastructure/ai/`.
- Интерфейс `IPlatformAdapter` живёт в `application/ports/`, а реализации `LinuxPlatformAdapter`, `WindowsPlatformAdapter` — в `infrastructure/platform/`.
