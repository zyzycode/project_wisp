# Маршрутизация задачи по ролям

Короткий сценарий для Project Manager: определить следующую работу, напрямую назначить implementer и reviewer, затем зафиксировать итог.

1. `SYNC` — прочитай фактический Status ближайших задач, назначенную Issue и только нужные источники.
2. `PLAN` — выбери одну задачу и нормализуй outcome, owner-role, scope, constraints, acceptance criteria, out of scope, blockers и verification.
3. `HANDOFF` — установи `Status: In progress` и напрямую выдай два независимых задания: owner-role и reviewer. Implementer не формирует reviewer prompt и не определяет scope review.
4. После handoff не управляй внутренним циклом `implementation → review → fixes → repeated review`.
5. `RESULT` — по финальному reviewer verdict проверь acceptance criteria, verification и отсутствие открытых findings/blockers.
6. `UPDATE` — зафиксируй итог в Issue/Project и обнови только Status. Следующую задачу не выбирай; новый проход начинается с `SYNC`.
