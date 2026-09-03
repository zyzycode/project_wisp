# База знаний Project Wisp

Выберите область задачи. Не читайте все документы подряд: инструкции роли, одна карточка и нужные разделы контракта достаточны для начала.

| Вопрос | Основной документ |
|---|---|
| Ограничения и порядок работы | [AGENTS.md](../AGENTS.md) |
| Фазы и активная работа | [ROADMAP.md](../ROADMAP.md), [GitHub Issues](https://github.com/zyzycode/project_wisp/issues), [Project](https://github.com/users/zyzycode/projects/1) |
| Роли основного приложения | [Роли и ссылки на инструкции](../AGENTS.md#роли-агентов) |
| Обзор устройства приложения для людей | [ARCHITECTURE.md](../ARCHITECTURE.md) — объяснения и схемы, не технический контракт |
| Правила слоёв и зависимостей | [10-architecture.md](../.agents/rules/10-architecture.md) |
| Причины архитектурных решений | [Architecture Decision Records](adr/README.md) |
| Состояние и личность персонажа | [CHARACTER_ENGINE.md](engine/CHARACTER_ENGINE.md) |
| Намерения поведения | [BEHAVIOR_INTENTS.md](engine/BEHAVIOR_INTENTS.md) |
| Приоритеты и Utility autonomy | [AUTONOMY_ENGINE.md](engine/AUTONOMY_ENGINE.md) |
| Activity lifecycle, chains и repetition | [ACTIVITY_ENGINE.md](engine/ACTIVITY_ENGINE.md) |
| Физика, surfaces и position orchestration | [MOTION_ENGINE.md](engine/MOTION_ENGINE.md) |
| Gaze, cursor и environment signals | [PERCEPTION_ENGINE.md](engine/PERCEPTION_ENGINE.md) |
| AnimationIntent, FSM и прерывания | [ANIMATION_ENGINE.md](engine/ANIMATION_ENGINE.md) |
| Формат ассетов, anchors, слои и воспроизведение | [RENDER_ENGINE.md](engine/RENDER_ENGINE.md) |
| Меню, чат и остальные элементы интерфейса | [UI_SPEC.md](engine/UI_SPEC.md) |
| Память | [MEMORY_ENGINE.md](engine/MEMORY_ENGINE.md) |
| Граница AI-провайдера | [AI_PROVIDER_CONTRACT.md](engine/AI_PROVIDER_CONTRACT.md) |
| Старые ссылки на смешанную Shimeji specification | [SHIMEJI_SPEC.md](engine/SHIMEJI_SPEC.md) — compatibility index, не source of truth |
| Создание, нарезка и обработка спрайтов | [Asset Pipeline](../asset-pipeline/README.md) — отдельный скоуп и локальный агент |
| Регистрация ассетов и изменения runtime | [GitHub Project](https://github.com/users/zyzycode/projects/1); текущая интеграция Renderer — [#1 P14-P01](https://github.com/zyzycode/project_wisp/issues/1) |

## Два маршрута

- **Приложение:** одна карточка из основной очереди → инструкция назначенной роли → соответствующий контракт и файлы кода. Промпты генерации не нужны.
- **Подготовка ассетов:** запрос пользователя → [локальные инструкции](../asset-pipeline/AGENTS.md) → [стандарт и шаблон промпта](../asset-pipeline/STANDARDS.md) → нужные строки [таблицы ассетов](../asset-pipeline/ASSETS.md). Пайплайн размещает готовые PNG сразу в рабочих папках. Манифест и render contract доступны для чтения; отдельная задача приложения нужна только для изменения регистрации или runtime.

В пайплайне разрешена краткая копия технических требований со ссылкой на render contract. Она не переопределяет его. Этот навигатор указывает документы по областям; он не разрешает уже существующие противоречия между контрактами и не заменяет Architect review.
