# ADR-014: Lightweight motion solver для native window

- Status: Accepted
- Decision source: P14-A02
- Contract: [`MOTION_ENGINE.md`](../engine/MOTION_ENGINE.md)

## Context

Wisp перемещается как системное окно. Authoritative output физики — root position, которую Infrastructure в итоге применяет через `BrowserWindow.setPosition`, а не положение тела внутри scene graph или DOM/canvas node.

Нужно было выбрать между текущей fixed-step TypeScript кинематикой, полноценным game/physics engine и GPU-oriented rendering runtime.

## Decision

Сохранить чистый TypeScript discrete solver (`MotionEngine` + `SurfaceKinematics`) для domain motion. Не добавлять game/physics engine.

Solver остаётся детерминированным относительно explicit state/input/config. Main/Application владеет clock, accumulator и position orchestration; Infrastructure изолирует native-window commit. Renderer не получает authority над world position.

PixiJS/WebGL не является motion dependency. Такой runtime может рассматриваться отдельно только как optional Renderer View-adapter после подтверждённой потребности и нового dependency/architecture review.

## Rationale

Текущий workload — один state и ограниченный набор чисел на fixed step. Game/physics engine добавил бы собственные clock, body registry, collision world и scene ownership, но всё равно потребовал бы отдельный bridge к native-window position.

Lightweight solver имеет меньшую operational surface и сохраняет воспроизводимость при нестабильном Renderer FPS и фоновых окнах. Это архитектурная оценка, не benchmark; новый workload требует измерений.

GPU compositor решает другую задачу. Он становится пропорциональным только если профилирование покажет, что React/CSS renderer не выдерживает visual frame budget, либо появится необходимость в GPU-композиции многих слоёв, частицах, масках/фильтрах или high-DPI sprite batching.

## Consequences

- Motion/Surface Kinematics остаются pure TypeScript Domain services.
- Main/Application владеет fixed-step orchestration и единственным commit path.
- Electron/platform API остаются за Infrastructure adapter.
- Optional Renderer runtime, если будет одобрен отдельно, получает presentation state, но не импортирует domain motion, не вызывает IPC и не меняет world/window position.
- Добавление physics или rendering dependency требует нового ADR, измерений и Dependency Review.
