# Interaction behavior pack

Этот pack — неканоническое описание click, pet, drag и cursor-play flows. Формы input/DTO, priorities, thresholds, physics и visual transitions принадлежат [engine contracts](../engine/README.md).

## Пользовательская цель

Wisp немедленно и предсказуемо реагирует на прямое взаимодействие: замечает click и pet, безопасно переносится drag-жестом и может играть с курсором, не отдавая Renderer контроль над поведением или позицией.

## End-to-end flow

- Renderer-origin input нормализуется Application boundary в semantic candidate или physical fact по [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#поток-ответственности); Renderer не принимает решение.
- Click/pet candidates проходят Character gating и становятся не более чем одним resolved behavior по [`CHARACTER_ENGINE.md`](../engine/CHARACTER_ENGINE.md#владение) и [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#2-единственная-цепочка-решений).
- Petting и завершённый cursor-play feedback мапятся и дедуплицируются Application по [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#13-feedback-boundary); только Character Engine меняет Needs/Relationship.
- Drag является forced physical path: Motion принимает валидный input, отменяет Activity и владеет позицией по [`MOTION_ENGINE.md`](../engine/MOTION_ENGINE.md#8-forced-motion-и-position-authority).
- Cursor proximity и gaze вычисляются как observations/presentation output по [`PERCEPTION_ENGINE.md`](../engine/PERCEPTION_ENGINE.md#2-поток-perception); свежий signal лишь участвует в eligibility Activity.
- Behavior Brain выбирает совместимую reaction/play Activity, Runner исполняет один lifecycle по [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#2-поток-activity), а visual request направляется в единый [`ANIMATION_ENGINE.md`](../engine/ANIMATION_ENGINE.md#поток-ответственности).

## Варианты

| Вариант | Сценарная роль | Authoritative owner |
|---|---|---|
| Click | Direct semantic input; может привести к существующей реакции или wake после Character gate | [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#правила-принятия) |
| Pet | Direct interaction и отдельный canonical feedback outcome | [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#13-feedback-boundary) |
| Drag and release | Forced position, release, airborne/landing facts и возврат authority | [`MOTION_ENGINE.md`](../engine/MOTION_ENGINE.md) |
| Gaze | Presentation offset без semantic или Activity decision | [`PERCEPTION_ENGINE.md`](../engine/PERCEPTION_ENGINE.md#4-gaze-normalization) |
| Cursor play / Swat | Fresh proximity signal → eligible play Activity; `Swat` не public intent | [`PERCEPTION_ENGINE.md`](../engine/PERCEPTION_ENGINE.md#6-freshness-dwell-и-reaction-signal) и [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#6-behavior-brain-selection) |

## Graceful degradation

- Invalid, stale или foreign drag input не меняет physics согласно [`MOTION_ENGINE.md`](../engine/MOTION_ENGINE.md#10-typed-ipc).
- Missing или stale cursor observation сбрасывает реактивный signal по [`PERCEPTION_ENGINE.md`](../engine/PERCEPTION_ENGINE.md#6-freshness-dwell-и-reaction-signal); Activity не запускается из старого dwell.
- Если pupil layer несовместим, gaze может стать visual no-op, но proximity ownership не меняется по [`PERCEPTION_ENGINE.md`](../engine/PERCEPTION_ENGINE.md#4-gaze-normalization).
- Если reaction/play Activity не выбрана, semantic fallback остаётся в общем [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#7-scoring-и-arbitration), без синтеза нового intent в UI.
- Missing visual не отменяет physical fact и обрабатывается [`ANIMATION_ENGINE.md`](../engine/ANIMATION_ENGINE.md).

## Acceptance scenarios

- **Click reaction:** click создаёт один нормализованный candidate; Character решает его допустимость, а UI не выбирает Activity или clip.
- **Pet feedback:** подтверждённый pet outcome применяется к Character не более одного раза; pointer events и frames не размножают stimulus.
- **Drag authority:** после валидного begin drag активная Activity отменена, Motion единолично ведёт position до устойчивого возврата voluntary authority.
- **Cursor play:** только fresh compatible proximity signal может участвовать в выборе Swat/play Activity; Gaze Engine сам Activity не запускает.
- **Stale input:** stale cursor или drag message не изменяет текущий behavior/motion state и не создаёт feedback.
