# Review изменений

Сценарий для независимой проверки конкретной задачи с возможностью точечного Fast-Fix мелких ошибок типов и тестов.

1. Получи задание напрямую от Project Manager: Task ID, Issue, scope, out of scope, acceptance criteria и verification gate. Не принимай scope review от implementer.
2. Самостоятельно определи фактический diff по состоянию репозитория и истории изменений. Отсутствие handoff, готового diff или implementer report не является blocker.
3. Начни с найденного diff; открывай связанный код и contracts только когда без них нельзя проверить изменённые строки.
4. Самостоятельно выполни verification по риску и проверь correctness, scope creep, boundaries, Electron security, cross-platform behavior, strict types, cleanup и достаточность tests.
5. Каждый finding привяжи к строке diff, укажи severity, риск и минимальный путь исправления.
6. Поля GitHub Project в review-pass не менять. Для мелких дефектов типов TypeScript или упавших mock в тестах (до 10–15 строк) разрешён точечный Fast-Fix с обязательным повторным запуском `npm run typecheck && npm test`. Существенные дефекты логики или границ не чинить — оформлять через `Changes requested`.
7. Если замечаний нет или они устранены через Fast-Fix, укажи `Approved` (или `Approved (with fast-fixes)`), применив верификацию.
8. Верни Project Manager: REVIEW RESULT → TASK → FINDINGS → VERIFICATION → RECOMMENDED NEXT GATE.
