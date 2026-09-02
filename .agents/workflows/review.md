# Review изменений

Сценарий для независимой проверки конкретной задачи; reviewer не исправляет findings в том же проходе.

1. Получи задание напрямую от Project Manager: Task ID, Issue, scope, out of scope, acceptance criteria и verification gate. Не принимай scope review от implementer.
2. Самостоятельно определи фактический diff по состоянию репозитория и истории изменений. Отсутствие handoff, готового diff или implementer report не является blocker.
3. Начни с найденного diff; открывай связанный код и contracts только когда без них нельзя проверить изменённые строки.
4. Самостоятельно выполни verification по риску и проверь correctness, scope creep, boundaries, Electron security, cross-platform behavior, strict types, cleanup и достаточность tests.
5. Каждый finding привяжи к строке diff, укажи severity, риск и минимальный путь исправления.
6. Не меняй product code, тесты и поля GitHub Project в review-pass.
7. Если findings нет, явно укажи `Approved` и остаточные непроверенные риски.
8. Верни Project Manager: REVIEW RESULT → TASK → FINDINGS → VERIFICATION → RECOMMENDED NEXT GATE.
