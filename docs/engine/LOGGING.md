# Архитектурный контракт Structured Logging & Telemetry (LOGGING.md)

`LOGGING.md` — единый источник истины (source of truth) для подсистемы структурированного логирования, аудита и рантайм-телеметрии Project Wisp. Документ специфицирует контракт порта `ILogger`, уровни детализации, контексты подсистем, формат записей и контракт кольцевого буфера (`ILogBuffer`) для Live Debug HUD (`Ctrl+D`).

Документ является архитектурным стандартом ядра. Implementer-агенты не меняют этот контракт без согласования с Architect.

---

## 1. Назначение и принципы логирования

1. **Единый фасад:** все подсистемы Main-процесса и Renderer-процесса используют интерфейс `ILogger` через Dependency Injection.
2. **Структурированность:** логи содержат строгий контекст (`LogContext`), уровень (`LogLevel`) и опциональный типизированный payload (`LogPayload`), пригодный для фильтрации и инспекции.
3. **Безопасность и приватность (Zero Leakage):**
   - Запрещено логировать токены, API-ключи, сырые персональные данные пользователя.
   - Диалоговые реплики в логах обрезаются или маскируются при отправке в персистентные хранилища.
4. **Неблокирующая телеметрия:** логирование не должно вызывать лагов основного потока (UI) или стейт-машины (FSM).
5. **In-Memory Ring Buffer:** буфер с фиксированным лимитом записей обеспечивает мгновенный доступ к последним событиям для оверлея отладки (`Live Debug HUD`).

---

## 2. Спецификация контракта порта `ILogger`

Интерфейс порта располагается в Application Layer (`src/application/ports/logger.interface.ts`).

```typescript
/**
 * Уровни детализации логирования (в порядке возрастания важности)
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Контексты модулей и подсистем Project Wisp
 */
export type LogContext =
  | 'FSM'
  | 'CharacterEngine'
  | 'Needs'
  | 'AIProvider'
  | 'AnimationController'
  | 'AnimationPlayer'
  | 'FallbackResolver'
  | 'RenderEngine'
  | 'IPC'
  | 'Autonomy'
  | 'Platform'
  | 'Persistence';

/**
 * Структурированные метаданные лог-события
 */
export type LogPayload = Record<string, unknown>;

/**
 * Неизменяемая запись лога
 */
export interface LogEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly context: LogContext;
  readonly message: string;
  readonly payload?: LogPayload;
}

/**
 * Слушатель потока новых записей телеметрии
 */
export type LogListener = (entry: LogEntry) => void;

/**
 * Контракт кольцевого буфера логов в памяти (для Live Debug HUD)
 */
export interface ILogBuffer {
  /** Максимальная емкость буфера (по умолчанию 200 записей) */
  readonly capacity: number;
  /** Добавить запись в буфер (с вытеснением старых по FIFO) */
  push(entry: LogEntry): void;
  /** Получить текущие записи в хронологическом порядке */
  getEntries(): readonly LogEntry[];
  /** Очистить буфер */
  clear(): void;
  /** Подписаться на поступление новых записей */
  subscribe(listener: LogListener): () => void;
}

/**
 * Порт структурированного логгера Application Layer
 */
export interface ILogger {
  debug(context: LogContext, message: string, payload?: LogPayload): void;
  info(context: LogContext, message: string, payload?: LogPayload): void;
  warn(context: LogContext, message: string, payload?: LogPayload): void;
  error(context: LogContext, message: string, error?: Error | unknown, payload?: LogPayload): void;
  /** Установка минимального активного уровня логирования */
  setLevel(level: LogLevel): void;
  /** Получение доступа к кольцевому буферу телеметрии для Live Debug HUD */
  getBuffer(): ILogBuffer;
}
```

---

## 3. Правила уровней логирования

| Уровень | Когда использовать | Поведение в Production |
|---|---|---|
| `debug` | Внутренние тики таймеров, смены кадров `AnimationPlayer`, детальный DTO-маппинг. | Подавляется (не выводится в `console`), но доступно в `ILogBuffer` при включенном флаге Debug. |
| `info` | Смена высокоуровневого состояния FSM, запуск сна/пробуждения, успешный AI-ответ, инициализация рендерера. | Выводится в консоль/буфер. |
| `warn` | Срабатывание Fallback-резолвинга (Level 2/3), пропуск кадра, неожиданный приоритет прерывания. | Всегда фиксируется в буфере и консоли разработчика. |
| `error` | Ошибка загрузки текстуры/манифеста, сбой IPC, падение провайдера, исключение в адаптере. | Фиксируется со stack trace, не должна приводить к падению UI. |
| `silent` | Полное отключение вывода логгера (для бенчмарков и unit-тестов). | Логи не генерируются. |

---

## 4. Границы Clean Architecture

- `ILogger` и `ILogBuffer` являются **чистыми интерфейсами Application Layer**.
- Адаптер реализации (`AppLogger`) находится в слое Infrastructure (`src/infrastructure/logging/`).
- Никакие платформенные вызовы (например, запись в файл через `fs` или IPC-эмиссия) не проникают в Domain или Core Presentation логику.
