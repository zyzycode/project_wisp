# Реализация функциональности

Workflow для минимального vertical slice по назначенной GitHub Issue.

1. Прочитай `AGENTS.md`, инструкцию назначенной роли, Issue, `.agents/rules/10-architecture.md`, rules затронутого слоя и только названные engine contracts.
2. Подтверди Task ID, scope, acceptance criteria, out of scope и закрытые blockers. Если задача не готова или слишком широка, остановись и предложи Project Manager следующий gate.
3. Найди существующие types, ports, utilities и patterns; не создавай параллельную реализацию.
4. Назови затрагиваемые файлы и короткий план.
5. Если меняются contracts, IPC, ports, engine docs или layer boundaries, запроси Architect gate до product code.
6. Реализуй самый маленький рабочий срез только в разрешённом scope.
7. Добавь тесты по риску и выполни gate из `.agents/rules/60-testing.md`.
8. Верни отчёт: TASK → CHANGES → BOUNDARIES → VERIFICATION → RECOMMENDED NEXT GATE.
