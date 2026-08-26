# 20-typescript.md — Стандарты разработки на TypeScript

Правила типизации и стиля написания кода на TypeScript для Project Wisp.

---

## 1. Строгая типизация (Strict Typing)
- Проект компилируется с флагом `"strict": true`.
- Запрещено использование типа `any`. В случаях неизвестного типа используйте `unknown` с последующей проверкой/сужением типа (type guards).
- Запрещено использование оператора ненулевого утверждения (`!`), если валидность значения не доказана непосредственно строкой выше.

---

## 2. Явная типизация публичных контрактов
- Все экспортируемые функции, методы классов и IPC-обработчики обязаны иметь **явные типы аргументов и возвращаемых значений**:
  ```typescript
  // ПРАВИЛЬНО:
  export function calculateNextPosition(current: Position, velocity: Velocity): Position {
    return { x: current.x + velocity.dx, y: current.y + velocity.dy };
  }

  // НЕПРАВИЛЬНО (неявный возврат):
  export function calculateNextPosition(current: any, velocity: any) {
    return { x: current.x + velocity.dx, y: current.y + velocity.dy };
  }
  ```

---

## 3. Использование Discriminated Unions для состояний
- Для стейт-машин, событий и сообщений используйте размеченные объединения с полем-дискриминатором (обычно `type` или `status`):
  ```typescript
  export type PetBehaviorState =
    | { status: 'idle'; durationMs: number }
    | { status: 'walking'; targetX: number; targetY: number; speed: number }
    | { status: 'dragged'; grabOffsetX: number; grabOffsetY: number }
    | { status: 'thinking'; initiatedAt: number };
  ```

---

## 4. Запрет на чрезмерное усложнение типов
- Не создавайте глубоко вложенные условные типы и рекурсивные маппинги, если их сложно читать и поддерживать.
- Типы должны помогать разработчику и IDE находить ошибки, а не превращаться в метапрограммирование ради эстетики.

---

## 5. Асинхронный код и обработка ошибок
- Всегда используйте `async/await` вместо цепочек `.then().catch()`.
- При вызове асинхронных операций, которые могут завершиться сбоем, используйте блоки `try/catch` с типизированной обработкой:
  ```typescript
  try {
    const response = await aiProvider.generateResponse(messages, context);
    return response;
  } catch (error) {
    logger.error('Failed to generate AI response', { error });
    return getFallbackResponse();
  }
  ```

---

## 6. Соглашения об именовании (Naming Conventions)
- `PascalCase` — для интерфейсов, типов, классов, React-компонентов, Enum.
- `camelCase` — для переменных, функций, методов, экземпляров объектов.
- `UPPER_SNAKE_CASE` — для глобальных констант.
- Префиксы интерфейсов: для портов допускается префикс `I` (например, `IAIProvider`, `IMemoryRepository`), для моделей данных префикс опускается (`User`, `ChatMessage`).
