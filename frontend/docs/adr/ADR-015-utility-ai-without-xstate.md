# ADR-015: Utility AI без XState

Status: Accepted. Источник: [AUTO-A01 / #22](https://github.com/zyzycode/project_wisp/issues/22), [ARCHITECT RESULT](https://github.com/zyzycode/project_wisp/issues/22#issuecomment-5514776530). Контракт: [Autonomy Engine](../engine/AUTONOMY_ENGINE.md).

## Decision

XState **отклонён для текущего autonomy boundary**. Utility scoring — pure TypeScript policy Character Engine, единственного владельца semantic gating и resolved behavior. Application нормализует/сериализует inputs и владеет cadence; существующие Activity Runner и Animation FSM исполняют решения. Новый public intent kind и второй decision owner не вводятся; provider — optional candidate source для offline autonomy.

## Dependency Review

Review от 2026-09-02: `xstate@5.32.6`, MIT, без runtime dependencies, ESM/CJS, `sideEffects: false`, 132 файла / около 2.29 MB unpacked. Supply-chain характеристики признаны приемлемыми; отказ обусловлен отсутствием необходимости:

- Discriminated unions, pure reducers и текущие FSM покрывают сценарии без actor clock.
- Actor runtime/effects шире задачи, добавляют bundle/packaging и upgrade risks, создают риск второго lifecycle owner.

## Reconsideration trigger

Нужны два подтверждённых сценария hierarchical/parallel statecharts, actor supervision или model-based path traversal, не выражающихся текущими FSM без дублирования, затем новый Dependency Review. Даже при одобрении XState допустим только как заменяемая Application detail: без владения Domain state, Needs, Utility score, physics, animation frames, Renderer, shared DTO и provider decisions.
