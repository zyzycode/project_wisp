# P15-M05 — постепенная адаптация

**TASK:** [#57](https://github.com/zyzycode/project_wisp/issues/57), 2026-09-18, по [P15-A02](P15_A02_RESULT.md). Независимое review временно отменено пользователем; Windows-приёмка выполняется им вручную.

**CHANGES:** отдельные пятиминутные gates для изменения axes и preferences, ограниченный шаг/caps и conservative startup/reset. Character service принимает только verified persisted like/dislike через callback #56, сохраняет learned affinity существующим checkpoint. Новый unlock и положительный рост love требуют current consent; исторические latch/love при restore сохраняются.

**BOUNDARIES:** Domain остаётся детерминированным; время задаётся входом, модель не назначает числовые изменения. Schema/snapshot/dependencies не менялись. Применение learned affinity к выбору игры — обязательная отдельная #59, см. [P17-A04](P17_A04_RESULT.md).

**SPRITES:** none.

**VERIFICATION:** два consent regression tests сначала воспроизвели дефекты, затем прошли. Проверены gate boundaries, bounded learning, разные histories, real SQLite restart/reset и отказ retired callback после вытеснения из кэша. Общий gate #56/#57: `npm run typecheck` PASS → `npm test` **934 PASS, 2 SKIP** (115 файлов PASS, 2 SKIP). Build не запускался, Windows manual — NOT RUN агентом.

**RECOMMENDED NEXT GATE:** done для формирования/сохранения адаптации; #59 завершает использование предпочтений в локальном поведении.
