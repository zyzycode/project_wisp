# TypeScript

- Сохраняй `strict`-типизацию; вместо `any` используй `unknown` и type guards.
- Не применяй `@ts-ignore`, опасные casts и non-null assertion `!` без локально доказанного invariant.
- Экспортируемые функции, методы, ports, DTO и IPC contracts имеют явные типы аргументов и результата.
- Для состояний, событий и результатов с вариантами используй discriminated unions.
- Предпочитай простые предметные типы глубоко вложенным conditional/mapped types.
- Ошибки на внешних границах преобразуй в типизированный результат или контролируемый fallback; не проглатывай исключения.
- Не логируй secrets, raw private memory и пользовательский ввод без необходимости.
- `PascalCase` — типы, классы и React-компоненты; `camelCase` — значения и функции; `UPPER_SNAKE_CASE` — глобальные константы.
- Префикс `I` допустим для ports (`IAIProvider`, `IMemoryRepository`), но не обязателен для DTO и domain models.
