# ADR-014: Lightweight motion solver для native window

Status: Accepted. Источник: P14-A02. Контракт: [Motion Engine](../engine/MOTION_ENGINE.md).

## Decision

Сохранить pure TypeScript fixed-step solver (`MotionEngine` + `SurfaceKinematics`), детерминированный относительно explicit state/input/config, без game/physics engine. Main/Application владеет clock и оркестрацией; Infrastructure применяет root position через `BrowserWindow.setPosition`. Renderer не управляет world position.

## Rationale

Текущий workload — один state и ограниченный набор чисел на шаг. Полный engine добавляет clock, body registry, collision world и scene ownership, но всё равно требует bridge к системному окну. Свой solver сохраняет воспроизводимость независимо от Renderer FPS. Это архитектурная оценка, не benchmark.

## Reconsideration trigger

Новый physics workload требует измерений, нового ADR и Dependency Review. PixiJS/WebGL решает отдельную задачу: optional View-adapter оправдан после профилирования frame budget или появления GPU-композиции многих слоёв, частиц, масок/фильтров, high-DPI sprite batching. Он требует отдельного architecture/dependency review, получает presentation state, не импортирует domain motion, не вызывает IPC и не меняет world/window position.
