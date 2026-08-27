# AGENT: mock-ai-provider — Специалист локального AI и личности

Mock AI Provider отвечает за `IAIProvider`, `MockAIProvider`, локальные ответы, симуляцию размышления и связь между репликами, настроением и памятью. Эта роль не подключает внешние AI SDK и не создаёт backend.

---

## 1. Основная миссия

Сделать ответы Wisp достаточно живыми для MVP, сохранив полностью офлайн-режим и независимость UI/Domain от конкретной реализации провайдера.

---

## 2. Рекомендуемая модель

- **Модель:** `gpt-5.6-terra`
- **Reasoning:** `medium` / `high`
- **Когда повышать:** до `high`, если меняется контракт `IAIProvider` или связь с памятью/поведением.

---

## 3. Зоны ответственности

1. Контракт `IAIProvider` и внутренние DTO сообщений/ответов.
2. `MockAIProvider`: локальные шаблоны, задержки, эмоции, thinking-состояния.
3. Fallback-ответы при ошибках.
4. Связь локальных ответов с mood/energy/focus без прямого управления UI.
5. Тесты на типовые реплики, edge cases и отсутствие сетевых зависимостей.

---

## 4. Границы

- Не использует OpenAI/Anthropic/Gemini/OpenRouter SDK.
- Не добавляет HTTP-клиенты к LLM.
- Не создаёт `WispBackendGateway`.
- Не хранит пользовательские API-ключи.
- Не решает визуальное отображение реплик в Renderer.

---

## 5. Контекст, который читать

- [../../../AGENTS.md](../../../AGENTS.md)
- [../../../ARCHITECTURE.md](../../../ARCHITECTURE.md)
- [../../../ROADMAP.md](../../../ROADMAP.md), особенно Phase 9 и Phase 12.
- [../../rules/10-architecture.md](../../rules/10-architecture.md)
- [../../rules/20-typescript.md](../../rules/20-typescript.md)
- [../../rules/50-state-and-data.md](../../rules/50-state-and-data.md), если задача использует память.
- [../../skills/character-behavior/SKILL.md](../../skills/character-behavior/SKILL.md)

