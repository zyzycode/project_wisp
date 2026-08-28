# Project Wisp

**Project Wisp** — интерактивный desktop AI-компаньон для Linux, Windows и macOS. Wisp живёт на рабочем столе в прозрачном Electron-окне, реагирует на действия пользователя, выражает эмоции через анимации, ведёт локальный диалог и постепенно получает офлайн-память.

Текущий репозиторий `project_wisp` — только desktop-клиент. Backend, dev proxy, auth/billing server logic и реальные AI SDK здесь не реализуются. На текущем этапе AI-поведение имитируется через `MockAIProvider`; будущая реальная AI-интеграция может подключаться только как client-side adapter к внешнему backend-контракту из отдельного проекта.

---

## Текущий фокус

- Desktop-first / offline-first MVP.
- Один основной персонаж Wisp с поведением, эмоциональным тоном, анимациями и props.
- SVG сейчас; sprite sheets и будущий rigging должны идти через общий render contract, когда `RENDER_ENGINE.md` будет создан.
- Локальная persistence принадлежит Main-процессу; полноценная память через SQLite запланирована отдельной фазой.
- Строгая изоляция Renderer от Node.js, Electron Main и SQLite.

---

## Документация

- [AGENTS.md](AGENTS.md) — главные правила разработки и ограничения репозитория.
- [ROADMAP.md](ROADMAP.md) — фазовый план работ и ведущие агенты по фазам.
- [ARCHITECTURE.md](ARCHITECTURE.md) — слои, процессы Electron, provider/intent/render boundaries.
- [.agents/](.agents/) — правила, роли агентов, workflows и предметные skills.
- `docs/engine/` — спецификации движков и индекс готовых/planned contract-документов.

---

## Требования к окружению

- **Node.js:** `v20+` (рекомендуется `v22.x`)
- **npm:** `v10+`
- **ОС:** Ubuntu Linux (X11 / Wayland), Windows 10/11, macOS

---

## Установка

```bash
npm install
```

---

## Команды разработки

Запуск в режиме разработки:

```bash
npm run dev
```

Запуск тестов:

```bash
npm test
```

Запуск тестов в watch-режиме:

```bash
npx vitest
```

Проверка типов:

```bash
npm run typecheck
```

Проверка типов Main / Preload / tooling:

```bash
npm run typecheck:node
```

Проверка типов Renderer:

```bash
npm run typecheck:web
```

Production build:

```bash
npm run build
```

Очистка артефактов сборки:

```bash
npm run clean
```
