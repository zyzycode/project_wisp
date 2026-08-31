# Задачи Project Wisp

Исполнимые задачи, их статусы, приоритеты, зависимости и owner-role ведутся только в GitHub.

- [Все Issues](https://github.com/zyzycode/project_wisp/issues)
- [Project Wisp — Задачи](https://github.com/users/zyzycode/projects/1)

---

## 🗺️ Тематические треки бэклога

Треки сохраняют тематическую навигацию и краткую историю; они не содержат исполнимых карточек.

| Трек | Файл | Направление |
|---|---|---|
| 🐾 **Shimeji & Autonomy** | [`tracks/shimeji.md`](./tracks/shimeji.md) | Стабилизация физики, интеграция FSM с Renderer, взгляд, редизайн меню |
| 🖥️ **UI & Desktop** | [`tracks/ui-desktop.md`](./tracks/ui-desktop.md) | Контекстное меню, чат-облачко, инспектор анимаций в Debug HUD |
| 🧠 **Memory & AI** | [`tracks/memory-ai.md`](./tracks/memory-ai.md) | SQLite память, диалоги, факты, AI-провайдеры (Next) |

Здесь только задачи приложения. Подготовка изображений и их готовность — в отдельном [Asset Pipeline](../../asset-pipeline/README.md).

---

## 🚦 Правила передачи задач агентам

1. Агенту в prompt передаётся **только одна назначенная GitHub Issue**.
2. Первая строка в `Читать:` — всегда `.agents/agents/<роль>/agent.md`.
3. Агент читает **только назначенную Issue** и нужные разделы `docs/engine/*.md`.
4. Менеджер формирует сразу **пару промптов: Исполнитель + Ревьюер**.

---

## Работа с очередью

Manager выбирает задачу с `Workflow: Ready`, у которой нет открытых блокеров и обязательного architect gate. Затем учитывает Phase, Priority и дату перехода в `Ready`. Исполнитель и reviewer не меняют поля Project и не берут соседние Issues самостоятельно.

| Поле Project | Назначение |
| --- | --- |
| `Workflow` | Backlog → Ready → In progress → In review → Done; при препятствии — Blocked. |
| `Status` | Канбан GitHub: Todo, In Progress, Done. |
| `Priority` | P0 Critical, P1 High, P2 Normal, P3 Low. |
| `Phase`, `Track`, `Owner role`, `Size` | Планирование, маршрутизация и контроль размера. |

Labels отмечают техническую область и обязательный architect gate. Блокеры указаны в разделе `Blocked by` соответствующей Issue.
