# review.md — Регламент проведения код-ревью

Чек-лист и стандарт анализа изменений перед интеграцией в кодовую базу Project Wisp. Review всегда привязывается к конкретному `Task ID` из shared backlog [.agents/tasks/README.md](../tasks/README.md).

> [!IMPORTANT]
> **Принцип Diff-Only Review:**
> Reviewer смотрит **исключительно в diff** (предоставленный патч / изменения), а **НЕ** читает весь проект или файлы вне зоны изменений. Reviewer не исправляет код, не меняет статусы backlog и не закрывает задачу вместо Project Manager. Его результат — findings по diff, оценка риска и recommended next gate.

---

## 1. Вход ревью

Перед анализом Reviewer должен получить:

- `Task ID` (цель, scope, acceptance criteria);
- owner-agent, который выполнял задачу;
- **diff / git diff** (список и текст изменённых строк/файлов);
- implementer verification report, если он есть.

Если `Task ID` не указан или diff отсутствует, Reviewer помечает ревью как `Blocked`.

---

## 2. Направления проверки diff

0. **Task scope и shared backlog:**
   - Соответствует ли diff конкретному `Task ID`?
   - Выполнены ли acceptance criteria?
   - Не затронут ли out of scope?
1. **Корректность и логика (Correctness):**
   - Соответствует ли код в diff заявленной цели задачи?
   - Нет ли состояний гонки (race conditions) в асинхронных операциях?
2. **Архитектурные границы (Architecture):**
   - Не проникли ли Node.js/Electron API в Renderer?
   - Не размещена ли бизнес-логика компаньона в React-компонентах?
   - Соблюдается ли независимость от AI-провайдера?
3. **Кроссплатформенность и изоляция платформ (Cross-Platform):**
   - Нет ли размазанных по кодовой базе проверок `process.platform`?
   - Изолирована ли платформозависимая логика за интерфейсами `IPlatformAdapter`?
   - Совместимы ли пути (`path.join()`) и регистрозависимость файлов с Linux (Ubuntu)?
4. **Безопасность Electron (Security):**
   - Включена ли изоляция контекста (`contextIsolation: true`)?
   - Нет ли передачи «сырого» `ipcRenderer`?
   - Валидируются ли входящие аргументы IPC и внешние URL?
5. **Типизация TypeScript:**
   - Отсутствуют ли типы `any` и неявные `unknown`?
6. **Состояние и производительность:**
   - Нет ли утечек памяти в подписках `useEffect`?
   - Очищаются ли таймеры и IPC-листенеры?
7. **Наличие тестов:**
   - Покрыты ли новые переходы стейт-машин юнит-тестами?
8. **Scope Creep & Hard Constraints:**
   - Нет ли лишних абстракций вне текущей задачи?
   - Нет ли backend/proxy/server implementation в `project_wisp`?
   - Нет ли прямых LLM SDK или пользовательских AI API-ключей в desktop-клиенте?
   - Не появилась ли серверная auth/billing логика?

---

## 3. Градация замечаний по уровню критичности (Severity)

- **Critical:** Уязвимости безопасности Electron, падения приложения, утечка Node API в Renderer, нарушение IPC/security contracts, backend/proxy/server implementation в repo.
- **High:** Нарушение архитектурных границ, логика поведения в UI, прямой AI SDK/API key path, размазывание `process.platform`, race condition, невыполненные acceptance criteria.
- **Medium:** Missing tests для сложной логики, избыточное усложнение типов, неоптимальные ререндеры, дублирование кода, scope creep без немедленной поломки.
- **Low:** Именование, локальная читаемость, мелкая документационная неоднозначность.

---

## 4. Правила findings

Finding должен быть actionable:
- указывать файл и строку в diff;
- объяснять, почему это проблема;
- описывать минимальный путь исправления.

---

## 5. Формат отчёта Code Review

```markdown
REVIEW RESULT
- Approved / Changes requested / Blocked

TASK
- Task ID:
- Owner:
- Scope checked:

FINDINGS
- [Severity] `path/to/file.ts:line` — описание проблемы, риск и минимальное исправление.

VERIFICATION
- Reviewer checked:
- Relied on implementer report:
- Not checked:

RECOMMENDED NEXT GATE
- `done` / `app-developer` / `domain-behavior` / `architect` / `blocked`
```

---

## 6. Routing

- `done` — findings нет, acceptance criteria выполнены, остаточный риск приемлем.
- `app-developer` — нужен fix-pass в Main/Preload/Renderer/platform/persistence/provider/packaging зоне.
- `domain-behavior` — нужен fix-pass в behavior/animation/domain зоне.
- `architect` — затронуты contracts, layer boundaries, IPC, ports, `docs/engine/*` или есть архитектурный конфликт.
- `blocked` — не хватает task ID, контекста, diff, результатов проверки или задача оказалась слишком широкой.
