# Исправление ошибки

Workflow для пользовательского bug report или подтверждённого review finding.

1. Подтверди Task ID/finding, ожидаемое и фактическое поведение, scope и owner role.
2. Воспроизведи проблему или зафиксируй, почему воспроизведение недоступно.
3. Локализуй процесс и модуль, затем сформулируй root cause; не маскируй симптом.
4. Если исправление меняет contract, IPC, port или layer boundary, остановись на Architect gate.
5. Внеси минимальный fix без соседнего refactor и расширения scope.
6. Добавь regression test по `.agents/rules/60-testing.md` и выполни проверки по риску.
7. Верни: TASK/FINDING → ROOT CAUSE → FIX → BOUNDARIES → VERIFICATION → RECOMMENDED NEXT GATE.
