# Маршрутизация задачи по ролям

Короткий workflow для Project Manager: превратить запрос в одну управляемую задачу и подготовить передачу исполнителю и reviewer.

1. Прочитай `AGENTS.md`, инструкцию `project-manager`, актуальную GitHub Issue и только нужные источники.
2. Нормализуй запрос: goal, scope, constraints, acceptance criteria, out of scope и blockers.
3. Если запрос соответствует большой фазе roadmap, предложи разбиение на маленькие Issues; не используй фазу как готовую задачу.
4. Выбери owner role по затронутому слою. Для contracts, IPC, ports, `docs/engine/*` или layer boundaries сначала назначь Architect gate.
5. Подготовь два коротких промпта: исполнителю и независимому reviewer. В обоих укажи Task ID, разрешённые файлы, нужные документы и проверяемый результат.
6. Не передавай весь markdown и не добавляй соседние задачи в scope.
7. Верни: выбранную Issue/предлагаемую карточку, owner, blockers, оба промпта и recommended next gate.
