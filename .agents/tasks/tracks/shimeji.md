# Трек: Shimeji & Advanced Autonomy (Phase 14 / Stabilization & Polish)

Тематическая навигация поведения, локомоции, физики, анимаций и UX персонажа на рабочем столе. Исполнимые карточки находятся в [GitHub Project](https://github.com/users/zyzycode/projects/1).
Архитектурная спецификация: [`docs/engine/SHIMEJI_SPEC.md`](../../../docs/engine/SHIMEJI_SPEC.md)
Спецификация рендера: [`docs/engine/RENDER_ENGINE.md`](../../../docs/engine/RENDER_ENGINE.md)

---

## 1. Текущий статус

- [x] **P14-S01..P14-S05b:** Архитектура, математика Shimeji, FSM, Gaze Engine, Surface Kinematics. (`done`)
- [x] **P14-G01 (a, b, c, REV):** Перенос физического цикла в Main Process и очистка Renderer. (`done`)
- [#1 P14-P01 — Интеграция FSM с Renderer и управление взглядом](https://github.com/zyzycode/project_wisp/issues/1) — `In progress`.
- [#2 P14-P02 — Калибровка физики и настройка движения](https://github.com/zyzycode/project_wisp/issues/2) — блокируется #1.
- [#3 P14-P03 — Расширение пула реплик и мыслей](https://github.com/zyzycode/project_wisp/issues/3) — `Ready`.
- [#4 P14-P04 — Редизайн контекстного меню](https://github.com/zyzycode/project_wisp/issues/4) — `Ready`.
- [#5 P14-P-REV — Review-gate Shimeji Polish и UX](https://github.com/zyzycode/project_wisp/issues/5) — ожидает #1–#4.

---

## 2. Карточки перенесены в GitHub

Полные цель, scope, зависимости, критерии приёмки и out of scope живут в связанных Issues. Таблица FSM ниже сохранена как справочный материал для реализации P14-P01.

#### Соответствия FSM → анимация для P14-P01

Таблица задаёт соответствия для реализации; она не подтверждает, что интеграция уже завершена.

| Состояние / алиасы | Ключ анимации в манифесте |
|---|---|
| `idle` / `rest` | `body_idle` |
| `walk` / `wander` | `body_walk` |
| `run` / `sprint` | `body_run` |
| `fall` / `falling` / `drop` | `body_fall` |
| `land` / `landing` | `body_land` |
| `crash` / `splat` / `crash_landing` | `body_crash_splat` |
| `sit` | `body_sit` |
| `stand_up` / `get_up` | `body_stand_up` |
| `lie` / `lie_down` | `body_lie` |
| `sleep_start` / `sleep_transition` | `body_sleep_trans` |
| `sleep` / `sleep_loop` | `body_sleep` |
| `climb_wall` | `body_climb_wall` |
| `ceiling_hang` / `hang_ceiling` | `body_ceiling_hang` |
| `jump` | `body_jump` |
| `petting` / `pet` | `body_petting` |
| `dragged` / `drag` | `body_dragged` |
| `wave` | `body_wave` |
| `celebrate` | `body_celebrate` |
| `scared` | `body_scared` |
| `bored` | `body_bored` |
| `thinking` | `body_thinking` |
