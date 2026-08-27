# 50-state-and-data.md — Управление состоянием и персистентность данных

Правила классификации состояния, персистентности в SQLite и синхронизации между процессами.

---

## 1. Классификация типов состояния

| Тип состояния | Где живёт | Примеры | Жизненный цикл |
|---|---|---|---|
| **Local UI State** | React компонент (`useState`) | Текст в input, hover-эффект | До размонтирования компонента |
| **Global UI State** | Renderer Zustand Store | Открыто ли окно настроек, текущий масштаб | Время работы текущей сессии |
| **Domain State** | Main Process (State Machines) | Текущее действие, настроение, координаты | Сессия + сохранение ключевых параметров в SQLite |
| **Persistent State** | SQLite Database (Main Process) | История диалогов, воспоминания, настройки | Постоянно между перезапусками |

---

## 2. Абстракция хранилища SQLite
- Все обращения к SQLite происходят **строго в Main-процессе** через интерфейсы репозиториев (`IMemoryRepository`, `ISettingsRepository`).
- Renderer-процесс не знает о существовании SQLite и не выполняет SQL-запросов.
- Все операции с базой данных инкапсулируются в адаптеры (например, `SQLiteMemoryRepository`).

---

## 3. Сериализация и передача данных
- Данные, передаваемые через IPC, должны быть чистыми DTO (Data Transfer Objects):
  - Примитивные типы (`string`, `number`, `boolean`).
  - Простые структуры и массивы без методов, прототипов и циклических ссылок.
  - Даты передаются в виде временных меток (`timestamp: number` в миллисекундах) или ISO 8601 строк.

---

## 4. Схема базы данных и миграции
- Таблицы именуются в `snake_case` в множественном числе: `settings`, `chat_messages`, `memories`.
- Для версионирования схемы используется прагма SQLite: `PRAGMA user_version`.
- Каждая миграция представляет собой детерминированную транзакционную функцию.
- Пример структуры миграций:
  ```typescript
  const MIGRATIONS = [
    {
      version: 1,
      up: (db: Database) => {
        db.exec(`
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE messages (id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL);
          CREATE TABLE memories (id TEXT PRIMARY KEY, key TEXT NOT NULL, value TEXT NOT NULL, confidence REAL NOT NULL);
        `);
      }
    }
  ];
  ```

---

## 5. Долгосрочная память компаньона (Memory Domain)
- Память персонажа состоит из:
  1. **Диалоговой памяти (Short-term context):** Последние $N$ сообщений для сохранения нити разговора.
  2. **Семантической памяти (Long-term facts):** Факты о пользователе (имя, любимые темы, предпочтения), извлекаемые и сохраняемые в таблицу `memories`.
- Структура памяти должна быть полностью независима от LLM-провайдера.
- Память хранится локально и не синхронизируется с облаком или внешним backend без отдельного будущего контракта и Architect review.
- Пользователь должен иметь возможность полностью очистить историю, факты и relationship state.
- Ручное редактирование отдельных memory entries не входит в scope: память считается внутренним состоянием Wisp.
- Renderer может показывать только безопасный краткий статус памяти и вызывать clear action через typed boundary; SQL, filesystem и raw memory internals остаются в Main/Application.
