# Архитектурные границы

## Направление зависимостей

```text
Renderer -> typed preload/IPC -> Application -> Domain
Infrastructure adapters -> Application ports
```

- Domain — чистый TypeScript без React, Electron, Node.js, SQLite, сети и `process.platform`.
- Application зависит от Domain, содержит use cases и объявляет порты для внешнего мира.
- Infrastructure реализует порты и инкапсулирует Electron, persistence, provider и OS APIs.
- Main владеет окнами, IPC handlers, use cases и оркестрацией состояния.
- Preload предоставляет только минимальный типизированный `window.wispAPI`.
- Renderer отображает presentation state и отправляет пользовательские intents; бизнес-логики и прямого доступа к Main/хранилищу в нём нет.

## Контракты и границы

- Интерфейс объявляет потребитель: application port живёт рядом с use case, adapter — в Infrastructure.
- Public contracts, IPC, ports, `docs/engine/*` и границы provider/render/behavior меняются только после Architect review.
- Не допускай циклических зависимостей и общих модулей без одной понятной ответственности.
- OS-specific поведение находится за platform adapters; `process.platform` допустим только внутри Infrastructure.

## Provider и движки

- Provider возвращает semantic DTO по `IAIProvider` и не управляет React, DOM, ассетами или animation frames.
- Application переводит provider DTO во внутренние intents; Domain не видит raw provider response.
- `docs/engine/*` — source of truth для engine DTO, приоритетов и переходов.
- Render Engine отвечает за visual props, layers, hitbox, bounds и scaling, но не принимает behavior decisions.
- Animation Engine отвечает за clips, priority и interrupt rules, но не за нарезку ассетов.

## Размер контрактов

- Цель для `docs/engine/*.md` — 250–400 строк, жёсткий предел — 450.
- В контракте оставляй DTO, формулы, переходы и компактные таблицы; не дублируй соседние документы.
