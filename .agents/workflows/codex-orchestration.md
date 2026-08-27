# codex-orchestration.md — Регламент управления Codex-агентами

Этот workflow описывает, как Project Manager распределяет работу между специализированными Codex-ролями Project Wisp.

---

## 1. Вход задачи

Project Manager сначала нормализует задачу:

```markdown
Goal:
Context:
Constraints:
Acceptance criteria:
Out of scope:
Suggested agent:
```

Если задача содержит backend, cloud AI gateway, auth, billing или пользовательские AI API-ключи, Project Manager обязан остановить этот scope и предложить desktop-only альтернативу.

Перед назначением агента Project Manager сверяет задачу с [.agents/tasks/README.md](../tasks/README.md). Если пользовательская просьба соответствует крупной roadmap-фазе, Project Manager сначала дробит её на agent-ready задачи и только потом назначает owner-agent.

---

## 2. Выбор роли

| Тип задачи | Основная роль | Когда подключать Architect |
|---|---|---|
| Roadmap, AGENTS, workflows, task split | `project-manager` | При конфликте архитектурных правил |
| IPC, ports, dependency direction | `architect` | Всегда |
| React Renderer, visual UI, chat/settings UI | `ui-specialist` | Если меняется IPC или state ownership |
| BrowserWindow, Preload, Main, platform adapters | `electron-platform` | Если меняется контракт между слоями |
| Behavior/Animation FSM, эмоции, физика | `domain-behavior` | Если меняется публичный доменный контракт |
| SQLite, repositories, migrations, memory | `data-memory` | Если меняется модель памяти или persistence contract |
| `IAIProvider`, `MockAIProvider`, локальные ответы | `mock-ai-provider` | Если меняется контракт AI-порта |
| Независимое ревью | `code-reviewer` | При архитектурных findings |
| Исправление findings | `fixer` | Если finding требует перепроектирования |
| Проверка и тестовая стратегия | `tester` | Если падение указывает на архитектурную проблему |

---

## 3. Цикл выполнения

1. **Project Manager** выбирает одну задачу из `.agents/tasks/README.md`, переводит её в `ready` / `in_progress` и назначает роль.
2. **Architect** подключается до реализации, если меняются границы слоёв, IPC, порты, `docs/engine/*` или platform contracts.
3. **Feature agent** реализует только свой слой или согласованный вертикальный срез и возвращает результат Project Manager-у.
4. **Tester** запускает проверки, соответствующие риску изменения, если для задачи есть test gate.
5. **Code Reviewer** проверяет diff и формирует findings, если для задачи есть review gate.
6. **Fixer** исправляет только подтверждённые findings, если review/test gate нашёл проблему.
7. **Project Manager** обновляет статус задачи в `.agents/tasks/README.md`, переводит следующий gate в `ready` или возвращает задачу на нужный этап.

---

## 4. Shared backlog workflow

`.agents/tasks/README.md` является общей доской задач для всех Codex-ролей.

Правила:

- Все агенты могут читать backlog, чтобы видеть зависимости, текущий owner-agent и следующий gate.
- Project Manager является основным владельцем изменения backlog: статусы, зависимости, owner-agent и порядок задач.
- Агент не берёт соседнюю задачу самостоятельно, даже если видит её как `ready`; назначение делает Project Manager.
- Feature agent не закрывает фазу целиком, а возвращает результат только по своей задаче.
- Reviewer не чинит findings; он возвращает список проблем и рекомендует `fixer` gate.
- Fixer не расширяет scope; он чинит только подтверждённые findings.
- Tester не реализует продуктовую функциональность; он подтверждает сценарии и сообщает, можно ли закрывать задачу.

Минимальная передача между агентами:

```markdown
Task ID:
Status:
Owner:
Touched files:
Decisions:
Verification:
Open questions / blockers:
Recommended next gate:
```

---

## 5. Правила передачи контекста

- Передача между агентами должна быть короткой: goal, touched files, decisions, open questions, verification status.
- Нельзя передавать “весь проект” вместо конкретного контекста.
- Если агент обнаружил чужую ответственность, он не чинит её сам, а возвращает задачу Project Manager-у с предложением роли.

---

## 6. Финальный отчёт Project Manager

```markdown
RESULT
- Что завершено.

AGENTS USED
- Роль → вклад.

FILES
- Изменённые файлы.

VERIFICATION
- Что запускалось / что не запускалось и почему.

NEXT
- Следующий логичный шаг.
```
