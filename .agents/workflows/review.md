# Review изменений

Workflow для независимой проверки конкретной задачи; reviewer не исправляет findings в том же проходе.

1. Получи Task ID, scope, acceptance criteria, diff и implementer verification report. Без Task ID или diff верни `Blocked`.
2. Начни с diff; открывай связанный код и contracts только когда без них нельзя проверить изменённые строки.
3. Используй инструкцию `reviewer` и релевантные rules. Проверь correctness, scope creep, boundaries, Electron security, cross-platform behavior, strict types, cleanup и достаточность tests.
4. Каждый finding привяжи к строке diff, укажи severity, риск и минимальный путь исправления.
5. Не меняй product code, тесты и Project fields в review-pass.
6. Если findings нет, явно укажи `Approved` и остаточные непроверенные риски.
7. Верни: REVIEW RESULT → TASK → FINDINGS → VERIFICATION → RECOMMENDED NEXT GATE.
