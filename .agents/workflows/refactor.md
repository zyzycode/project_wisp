# Рефакторинг без изменения поведения

Workflow для явно назначенного refactor scope.

1. Подтверди Task ID, текущее поведение, scope, acceptance criteria и out of scope.
2. Проверь покрытие изменяемого поведения; добавь characterization test в разрешённом scope или сообщи blocker.
3. Для changes в contracts, IPC, ports или layer boundaries сначала получи Architect gate.
4. Назови затрагиваемые файлы и раздели работу на маленькие обратимые шаги.
5. Не добавляй новую функциональность и не исправляй несвязанные дефекты.
6. Запускай targeted checks по необходимости; обязательного полного прогона после каждого микрошага нет.
7. Перед завершением выполни полный gate из `.agents/rules/60-testing.md` и проверь отсутствие scope creep/cycles.
8. Верни: TASK → PRESERVED BEHAVIOR → CHANGES → BOUNDARIES → VERIFICATION → RECOMMENDED NEXT GATE.
