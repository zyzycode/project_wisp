# Exploration behavior pack

Этот pack — неканоническое описание сценария. Он не владеет DTO, Utility tuning, priorities, motion rules или animation transitions; они читаются только в [engine contracts](../engine/README.md).

## Пользовательская цель

В спокойные периоды Wisp выглядит живым: умеет оставаться в idle, ненавязчиво исследовать доступное пространство и иногда переходить к более энергичной игре без хаотичных повторов.

## End-to-end flow

- Application создаёт автономную opportunity и конечный набор существующих candidates по [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#4-p4-opportunity-и-нормализация).
- Character Engine применяет semantic gates и Utility arbitration, не передавая scoring в Behavior Brain; ownership закреплён в [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#1-владение).
- Resolved behavior использует существующие `idle`, `wander` или `play` из [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#начальный-каталог).
- Behavior Brain выбирает совместимую Activity внутри resolved kind: Explore и Zoomies остаются Activity concepts, а не public intents, по [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#6-behavior-brain-selection).
- Activity Runner ведёт один run, chain, cooldown и repetition по [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#7-lifecycle-одного-run).
- Perception предоставляет только normalized environment/cursor observations по [`PERCEPTION_ENGINE.md`](../engine/PERCEPTION_ENGINE.md#7-normalized-environment-signals); feasibility и voluntary locomotion выполняются через границу [`MOTION_ENGINE.md`](../engine/MOTION_ENGINE.md).
- Runner выпускает `AnimationIntent`, а visual transitions и interrupt policy применяет [`ANIMATION_ENGINE.md`](../engine/ANIMATION_ENGINE.md#поток-ответственности).

## Варианты

| Вариант | Сценарная роль | Authoritative owner |
|---|---|---|
| Idle | Safe спокойное поведение без активной цели | [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#начальный-каталог) |
| Wander | Semantic намерение ненавязчивого перемещения | [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#начальный-каталог) |
| Explore | Activity chain внутри resolved `wander`, не новый public kind | [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#5-начальные-chains) |
| Zoomies | Энергичный Activity-вариант внутри совместимого resolved behavior | [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#6-behavior-brain-selection) |
| Cursor-aware exploration | Fresh signal влияет только на eligibility, не создавая intent внутри Perception | [`PERCEPTION_ENGINE.md`](../engine/PERCEPTION_ENGINE.md#6-freshness-dwell-и-reaction-signal) |

## Graceful degradation

- При отсутствии пригодной среды candidate отсекается или Activity не выбирается по [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#6-eligibility) и [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#6-behavior-brain-selection); координаты не угадываются.
- При отсутствии eligible autonomous candidate применяется существующий safe fallback из [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#7-scoring-и-arbitration).
- Cooldown и repetition не копируются в pack и остаются независимыми механизмами [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#11-cooldown) и [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#12-repetition).
- Forced motion отменяет exploration run по [`MOTION_ENGINE.md`](../engine/MOTION_ENGINE.md#8-forced-motion-и-position-authority), не превращаясь в новый autonomous decision.
- Недоступный visual деградирует по правилам [`ANIMATION_ENGINE.md`](../engine/ANIMATION_ENGINE.md), не меняя resolved behavior.

## Acceptance scenarios

- **Idle fallback:** если подходящее исследование не разрешено, Wisp остаётся в safe idle без скрытого Activity или второго resolved intent.
- **Wander to Explore:** resolved `wander` ограничивает выбор совместимой Explore Activity; Runner последовательно исполняет один chain.
- **Play to Zoomies:** Zoomies рассматривается только как eligible Activity-вариант совместимого resolved behavior и соблюдает Activity-owned cooldown/repetition.
- **Environment unavailable:** отсутствие normalized geometry не приводит к guessed target или OS discovery в Domain.
- **Forced interruption:** drag, fall или потеря support отменяет exploration run, после чего position и visual state идут через общий Motion/Animation path.
