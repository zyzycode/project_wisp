# review.md — Регламент проведения код-ревью

Чек-лист и стандарт анализа изменений перед интеграцией в кодовую базу Project Wisp. Review всегда привязывается к конкретному `Task ID` из shared backlog [.agents/tasks/README.md](../tasks/README.md).

Code Reviewer не исправляет код, не меняет статусы backlog и не закрывает задачу вместо Project Manager. Его результат — findings, оценка риска и recommended next gate.

---

## 1. Вход ревью

Перед анализом Reviewer должен получить или восстановить:

- `Task ID` из [.agents/tasks/README.md](../tasks/README.md);
- owner-agent, который выполнял задачу;
- diff / список изменённых файлов;
- implementer self-check и verification report, если они есть;
- acceptance criteria и out of scope текущей задачи.

Если `Task ID` не указан и его нельзя однозначно определить, Reviewer помечает ревью как `Blocked` и просит Project Manager уточнить задачу.

---

## 2. Направления проверки

0. **Task scope и shared backlog:**
   - Соответствует ли diff конкретному `Task ID`?
   - Выполнены ли acceptance criteria?
   - Не затронут ли out of scope?
   - Все ли зависимости (`Depends on`) были закрыты до выполнения задачи?
   - Не нужно ли вернуть задачу Project Manager-у для дробления?
1. **Корректность и логика (Correctness):**
   - Соответствует ли код заявленной цели задачи?
   - Нет ли состояний гонки (race conditions) в асинхронных операциях?
2. **Архитектурные границы (Architecture):**
   - Не проникли ли Node.js/Electron API в Renderer?
   - Не размещена ли бизнес-логика компаньона в React-компонентах?
   - Соблюдается ли независимость от AI-провайдера?
   - Не изменены ли public contracts, `docs/engine/*`, IPC, ports или provider/render/behavior boundaries без Architect review?
3. **Кроссплатформенность и изоляция платформ (Cross-Platform):**
   - Нет ли размазанных по кодовой базе проверок `process.platform`?
   - Изолирована ли платформозависимая логика за интерфейсами `IPlatformAdapter` в `infrastructure/platform/`?
   - Совместимы ли пути (`path.join()`) и регистрозависимость файлов с Linux (Ubuntu)?
4. **Безопасность Electron (Security):**
   - Включена ли изоляция контекста (`contextIsolation: true`)?
   - Нет ли передачи «сырого» `ipcRenderer`?
   - Валидируются ли входящие аргументы IPC и внешние URL?
5. **Типизация TypeScript:**
   - Отсутствуют ли типы `any` и неявные `unknown`?
   - Корректно ли используются Discriminated Unions для стейтов?
6. **Состояние и производительность:**
   - Нет ли избыточных ререндеров или утечек памяти в подписках `useEffect`?
   - Очищаются ли таймеры и IPC-листенеры?
7. **Наличие тестов:**
   - Покрыты ли новые переходы стейт-машин юнит-тестами?
8. **Scope Creep & Overengineering:**
   - Нет ли лишних абстракций или функционала вне текущей задачи?
   - Нет ли backend/proxy/server implementation в `project_wisp`?
   - Нет ли прямых LLM SDK или пользовательских AI API-ключей в desktop-клиенте?
   - Не появилась ли серверная auth/billing логика?

---

## 3. Review modes

Reviewer выбирает один или несколько режимов проверки:

- **`ui`:** Renderer isolation, Render Engine, visual state, no business logic in React.
- **`platform`:** Electron security, Preload, IPC, OS adapters, Linux X11/Wayland constraints.
- **`domain`:** Character Engine, `BehaviorIntent`, `AnimationIntent`, FSM transitions, quiet/sleep mode.
- **`data`:** SQLite, repositories, migrations, memory privacy, settings persistence.
- **`provider`:** `IAIProvider`, `ProviderResponseIntentMapper`, `MockAIProvider`, future `ExternalAIProviderClient` boundary.
- **`docs`:** `AGENTS.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `.agents/**`, `docs/engine/*` consistency.

Если finding относится к public contract или architecture boundary, recommended next gate должен быть `architect`, а не `fixer`, пока Architect не подтвердит решение.

---

## 4. Градация замечаний по уровню критичности (Severity)

- **Critical:** Уязвимости безопасности Electron, падения приложения, утечка Node API в Renderer, нарушение IPC/security contracts, backend/proxy/server implementation в repo.
- **High:** Нарушение архитектурных границ, логика поведения в UI, прямой AI SDK/API key path, размазывание `process.platform`, race condition, невыполненные acceptance criteria.
- **Medium:** Missing tests для сложной логики, избыточное усложнение типов, неоптимальные ререндеры, дублирование кода, scope creep без немедленной поломки.
- **Low:** Именование, локальная читаемость, мелкая документационная неоднозначность.

---

## 5. Правила findings

Finding должен быть actionable:

- указывать файл и строку, если это возможно;
- объяснять, почему это проблема для задачи или проекта;
- описывать минимальный путь исправления;
- не смешивать несколько разных проблем в один пункт;
- не требовать фичи вне текущего task scope.

Если замечание является вкусовым и не влияет на correctness, security, architecture, maintainability или acceptance criteria, оно не должно блокировать задачу.

---

## 6. Формат отчёта Code Review

```markdown
REVIEW RESULT
- Approved / Changes requested / Blocked

TASK
- Task ID:
- Owner:
- Review mode:
- Scope checked:

FINDINGS
- [Severity] `path/to/file.ts:line` — описание проблемы, риск и минимальное исправление.

VERIFICATION
- Reviewer checked:
- Relied on implementer/tester report:
- Not checked:

RECOMMENDED NEXT GATE
- `done` / `fixer` / `tester` / `architect` / `blocked`
```

Если findings нет, Reviewer явно пишет: `No blocking findings found`.

---

## 7. Routing

- `done` — findings нет, acceptance criteria выполнены, остаточный риск приемлем.
- `fixer` — есть точечные confirmed findings, не требующие нового architecture decision.
- `tester` — реализация выглядит корректной, но не хватает verification.
- `architect` — затронуты contracts, layer boundaries, IPC, ports, `docs/engine/*` или есть архитектурный конфликт.
- `blocked` — не хватает task ID, контекста, diff, результатов проверки или задача оказалась слишком широкой.

Reviewer предлагает gate, но статус в shared backlog обновляет Project Manager.
