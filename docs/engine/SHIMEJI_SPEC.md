# Контракт Shimeji Engine

Compatibility index: этот legacy path сохранён для совместимости ссылок после D1 migration. Он больше не является source of truth и не дублирует DTO, thresholds, formulas, priorities или lifecycle rules.

Новые authoritative contracts:

- autonomy и P0–P5 — [`AUTONOMY_ENGINE.md`](./AUTONOMY_ENGINE.md);
- Activity definitions/lifecycle — [`ACTIVITY_ENGINE.md`](./ACTIVITY_ENGINE.md);
- physics, surfaces и position orchestration — [`MOTION_ENGINE.md`](./MOTION_ENGINE.md);
- gaze, cursor и environment — [`PERCEPTION_ENGINE.md`](./PERCEPTION_ENGINE.md).

Существующие внешние ссылки могут продолжать указывать на headings ниже. Каждая legacy область перенаправляет к единственному актуальному владельцу.

## 1. Границы и поток данных

Перенесено в ownership и flow разделы [`AUTONOMY_ENGINE.md`](./AUTONOMY_ENGINE.md#1-владение), [`ACTIVITY_ENGINE.md`](./ACTIVITY_ENGINE.md#1-владение), [`MOTION_ENGINE.md`](./MOTION_ENGINE.md#1-владение-и-поток) и [`PERCEPTION_ENGINE.md`](./PERCEPTION_ENGINE.md#1-владение). Общая матрица находится в [`README.md`](./README.md#3-граф-зависимостей-и-поток-данных-между-движками).

## 2. Координаты и Motion Engine

Authoritative contract: [`MOTION_ENGINE.md`](./MOTION_ENGINE.md#2-координаты-и-базовые-dto).

### 2.1. Sliding-window throw vector

Authoritative contract: [`MOTION_ENGINE.md`](./MOTION_ENGINE.md#4-sliding-window-throw-vector).

### 2.2. Fixed-step semi-implicit Euler

Authoritative contract: [`MOTION_ENGINE.md`](./MOTION_ENGINE.md#5-fixed-step-integration).

### 2.3. Collision, bounce, landing

Authoritative contract: [`MOTION_ENGINE.md`](./MOTION_ENGINE.md#6-collision-bounce-и-landing).

## 3. Forced motion, FSM и приоритеты

Physical authority перенесён в [`MOTION_ENGINE.md`](./MOTION_ENGINE.md#8-forced-motion-и-position-authority), P0–P5 — в [`AUTONOMY_ENGINE.md`](./AUTONOMY_ENGINE.md#3-safety-order-p0p5), visual transitions — в [`ANIMATION_ENGINE.md`](./ANIMATION_ENGINE.md).

## 4. Activity Runner, repetition и cooldown

Authoritative contract: [`ACTIVITY_ENGINE.md`](./ACTIVITY_ENGINE.md).

## 5. Gaze, cursor и environment

Authoritative contract: [`PERCEPTION_ENGINE.md`](./PERCEPTION_ENGINE.md).

## 6. Character Engine: Needs, Mood, Stimuli

Needs, tone, sleep/wake thresholds и quiet semantics остаются только в [`CHARACTER_ENGINE.md`](./CHARACTER_ENGINE.md). Activity feedback boundary находится в [`ACTIVITY_ENGINE.md`](./ACTIVITY_ENGINE.md#13-feedback-boundary).

### 6.1. Feedback stimuli

Authoritative contracts: lifecycle/mapping boundary — [`ACTIVITY_ENGINE.md`](./ACTIVITY_ENGINE.md#13-feedback-boundary), `StimulusDto` и Character mutation — [`CHARACTER_ENGINE.md`](./CHARACTER_ENGINE.md).

## 7. ADR-014: выбор движка для системного окна

Причины решения перенесены в [`ADR-014`](../adr/ADR-014-native-window-motion.md); исполнимый motion contract находится в [`MOTION_ENGINE.md`](./MOTION_ENGINE.md).

## 8. `ShimejiMotionOrchestrator` — Main/Application contract

Authoritative contract: [`MOTION_ENGINE.md`](./MOTION_ENGINE.md#9-shimejimotionorchestrator).

## 9. Typed IPC contract

Drag/presentation IPC находится в [`MOTION_ENGINE.md`](./MOTION_ENGINE.md#10-typed-ipc), environment IPC — в [`PERCEPTION_ENGINE.md`](./PERCEPTION_ENGINE.md#8-environment-ipc-boundary).

## 10. Animation, Render и изоляция

Visual priorities/transitions остаются в [`ANIMATION_ENGINE.md`](./ANIMATION_ENGINE.md), presentation/assets — в [`RENDER_ENGINE.md`](./RENDER_ENGINE.md). Domain/Application isolation распределён по разделам изоляции новых профильных contracts.

## 11. AUTO-A01: Utility AI и state orchestration

Authoritative contract: [`AUTONOMY_ENGINE.md`](./AUTONOMY_ENGINE.md). Причины dependency verdict находятся в [`ADR-015`](../adr/ADR-015-utility-ai-without-xstate.md).

### 11.1. Dependency Review: XState

Decision rationale и неизменный verdict: [`ADR-015`](../adr/ADR-015-utility-ai-without-xstate.md).

### 11.2. Единственный semantic decision owner

Authoritative ownership: [`AUTONOMY_ENGINE.md`](./AUTONOMY_ENGINE.md#1-владение) и public intent flow в [`BEHAVIOR_INTENTS.md`](./BEHAVIOR_INTENTS.md#поток-ответственности).

### 11.3. Cadence, safety и coexistence

Authoritative contract: [`AUTONOMY_ENGINE.md`](./AUTONOMY_ENGINE.md#4-p4-opportunity-и-нормализация), [`AUTONOMY_ENGINE.md`](./AUTONOMY_ENGINE.md#10-coexistence-и-safety-invariants).
