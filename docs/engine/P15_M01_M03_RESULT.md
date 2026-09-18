# P15-M01–M03 — локальная память и восстановление

**TASK:** [#6](https://github.com/zyzycode/project_wisp/issues/6), [#7](https://github.com/zyzycode/project_wisp/issues/7), [#8](https://github.com/zyzycode/project_wisp/issues/8), 2026-09-18. Основание — [P15-A01](P15_A01_RESULT.md). Независимое review временно отменено пользователем; ручная Windows-приёмка передана ему.

**CHANGES:** SQLite worker, schema v1/migrations и пять adapters; durable complete dialogue pairs и реальные terminal game episodes; bounded Mock hydration. Facts и dynamic Character snapshot сохраняются/восстанавливаются; первый человеческий ввод отменяет запоздалое startup restore. Dirty checkpoint, bounded graceful shutdown, atomic reset и generation/receipt barriers включены через Main и typed Memory IPC/Preload.

**BOUNDARIES:** Domain не зависит от SQLite/Node; нет embeddings, сетевой синхронизации и новой графики. Backend v1 использует прежний volatile context; передача сохранённой памяти — отдельная #56. Memory status доступен typed getter без нового Settings UI. Ограниченный package/lock/vite scope согласован пользователем; build не запускался.

**SPRITES:** none.

**VERIFICATION:** общий финальный gate persistence + [#54](P17_I02_VERIFICATION.md): `npm run typecheck` PASS → `npm test` **858 PASS, 2 SKIP** (108 файлов PASS, 2 SKIP), diff PASS. Проверены real-worker lock, SQLite restart → history/facts/Character restore → reset → restart, lifecycle deadlines, early input, rollback/late callbacks, strict snapshot и IPC. Windows dev/portable smoke — NOT RUN агентом, пользователь проверяет позже.

**RECOMMENDED NEXT GATE:** done для #6–#8; [P15-A02](P15_A02_RESULT.md) → #56/#57 для recall/extraction и адаптации. Исторический `loveUnlocked` сохраняется при restore; regression нового unlock/current consent относится к #57.
