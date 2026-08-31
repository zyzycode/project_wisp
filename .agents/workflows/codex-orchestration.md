# codex-orchestration.md — Регламент управления Codex-агентами

Этот workflow описывает, как Project Manager распределяет работу между базовыми Codex-ролями Project Wisp.

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

Если задача содержит backend/proxy/server implementation, dev/cloud gateway внутри этого repo, прямые LLM SDK, пользовательские AI API-ключи или server auth/billing, Project Manager обязан остановить этот scope и предложить вариант в рамках desktop-first/offline-first клиента. Будущий backend допускается только как отдельный проект с client-side контрактом для `project_wisp`.

Перед назначением агента Project Manager сверяет задачу с [GitHub Issues](https://github.com/zyzycode/project_wisp/issues) и [GitHub Project](https://github.com/users/zyzycode/projects/1). Если пользовательская просьба соответствует крупной roadmap-фазе, Project Manager сначала дробит её на agent-ready Issues и только потом назначает owner role.

---

## 2. Выбор роли

| Тип задачи | Основная роль | Когда подключать Architect |
|---|---|---|
| Roadmap, AGENTS, workflows, task split | `project-manager` | При конфликте архитектурных правил |
| IPC, ports, dependency direction | `architect` | Всегда |
| Main/Preload, Renderer UI, platform adapters, persistence/provider adapters | `app-developer` | Если меняется IPC, ports или state ownership |
| Behavior/Animation FSM, эмоции, физика | `domain-behavior` | Если меняется публичный доменный контракт |
| Review, verification, test strategy, regression checks | `reviewer` | Если findings указывают на архитектурную проблему |

---

## 3. Цикл выполнения

1. **Project Manager** выбирает одну Issue с `Workflow: Ready` без открытых блокеров, переводит её в `In progress` и назначает роль.
2. **Architect** подключается до реализации, если меняются границы слоёв, IPC, порты, `docs/engine/*` или platform contracts.
3. **Feature agent** реализует только свой слой или согласованный вертикальный срез и возвращает результат Project Manager-у.
4. **Reviewer** запускает проверки и/или проверяет diff, если для задачи есть review/test gate.
5. **Project Manager** возвращает confirmed findings текущему owner-агенту как fix-pass или переводит следующий gate в `ready`.
6. **Project Manager** обновляет Workflow и связанные поля Issue в GitHub Project.
7. **Project Manager** проверяет diff consistency и делает git commit связанных изменений, если рабочее дерево содержит только изменения текущего task/gate.

---

## 4. Shared backlog workflow

[GitHub Issues](https://github.com/zyzycode/project_wisp/issues) и [GitHub Project](https://github.com/users/zyzycode/projects/1) являются общей доской задач для всех Codex-ролей.

Правила:

- Все агенты могут читать Issues и Project, чтобы видеть зависимости, текущий owner role и следующий gate.
- Project Manager является основным владельцем изменения Project: Workflow, зависимости, owner role и порядок задач.
- Project Manager делает commit после принятия результата и переключения Workflow задачи; commit должен содержать только связанные изменения текущего task/gate.
- Агент не берёт соседнюю Issue самостоятельно, даже если видит её как `Ready`; назначение делает Project Manager.
- Feature agent не закрывает фазу целиком, а возвращает результат только по своей задаче.
- Reviewer не чинит findings в том же review-pass; он возвращает список проблем и рекомендует fix-pass owner-агенту.
- Owner-agent не расширяет scope во время fix-pass; он чинит только подтверждённые findings.

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
