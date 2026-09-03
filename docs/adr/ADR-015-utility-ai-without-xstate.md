# ADR-015: Utility AI без XState

- Status: Accepted
- Decision source: [`AUTO-A01`](https://github.com/zyzycode/project_wisp/issues/22)
- Published result: [`ARCHITECT RESULT`](https://github.com/zyzycode/project_wisp/issues/22#issuecomment-5514776530)
- Contract: [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md)

## Context

Будущей offline autonomy нужен один testable механизм semantic arbitration, который сосуществует с Character Engine, Activity Runner, Motion Engine и Animation FSM. Рассматривался XState как новая runtime dependency для state orchestration.

На дату review 2026-09-02 проверена `xstate@5.32.6`: MIT, zero runtime dependencies, ESM/CJS exports, `sideEffects: false`, 132 package files и около 2.29 MB unpacked.

## Decision

Dependency Review verdict: **rejected для текущего autonomy boundary**. XState не устанавливается.

Character Engine остаётся единственным owner semantic gating, P4 Utility arbitration и resolved behavior. Utility выражается pure TypeScript policy. Application сериализует opportunities и нормализует boundary inputs. Существующие Activity Runner и Animation FSM сохраняются без параллельной actor/statechart orchestration.

## Dependency Review rationale

| Критерий | Оценка |
|---|---|
| Необходимость | TypeScript discriminated unions, pure reducers и существующие lifecycle/FSM boundaries покрывают текущие сценарии; Utility scoring не требует statecharts/actors. |
| Пропорциональность | Actor runtime, effects и orchestration шире задачи и создают риск второго lifecycle owner. |
| Operational surface | Supply-chain характеристики приемлемы, но остаются новый runtime, bundle/packaging surface и upgrade risk behavior/type changes. |
| Архитектурная изоляция | Даже при будущем review XState может быть только заменяемой Application detail, а не owner Domain state, physics, Renderer, shared DTO или provider contract. |
| Альтернатива | Pure TypeScript Utility policy плюс текущие Activity Runner и Animation FSM меньше, детерминированы и тестируются без actor clock. |

## Consequences

- Provider остаётся optional candidate source и не требуется для local offline autonomy.
- Utility policy не вводит новый public intent kind или второй decision owner.
- Cadence принадлежит Application, scoring — Character Engine, execution — существующим Activity/Animation boundaries.
- Package/config/runtime не получают новую dependency.

## Reconsideration trigger

Повторный Dependency Review допустим только при двух подтверждённых сценариях, требующих hierarchical/parallel statecharts, actor supervision или model-based path traversal и не выражающихся существующими FSM без дублирования.

Даже после такого review XState не может владеть Needs, Utility score, physics, animation frames, Renderer, shared DTO или provider decisions.
