# Social behavior pack

Этот pack — неканоническое описание attention, SocialBid и dialogue flows. Он не вводит public `social_bid` kind, provider DTO, prompt, threshold, priority или lifecycle rule; authoritative semantics находятся в [engine contracts](../engine/README.md).

## Пользовательская цель

Wisp может ненавязчиво искать контакт и отвечать на него, оставаясь живым полностью offline. Будущий provider/LLM способен предложить candidate, но не становится условием социальной инициативы или владельцем решения.

**SocialBid** — только имя сквозного сценария в этом каталоге: ограниченная локальная попытка привлечь внимание через существующие intents и Activities. Это не DTO, `BehaviorIntentKind`, Activity definition или новый engine capability.

## End-to-end flow

- Application формирует immutable snapshot из Character-owned attention, relationship и tone semantics по [`CHARACTER_ENGINE.md`](../engine/CHARACTER_ENGINE.md#владение).
- Application создаёт явную opportunity и конечный набор локальных candidates по [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#4-p4-opportunity-и-нормализация); autonomy pulse не запускает provider request.
- Локальный SocialBid использует только существующие `idle`, `wander`, `play` или конкретную reaction kind из [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#начальный-каталог), когда их source и context допустимы; `think` и `respond` остаются dialogue flow.
- Optional future provider/LLM добавляет только suggested candidate через тот же Application mapper; provider и local candidate проходят одну boundary по [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#5-допустимые-и-запрещённые-inputs).
- Character Engine выполняет gating/arbitration и возвращает не более одного resolved intent по [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#2-единственная-цепочка-решений); raw provider response и memory text не входят в Utility policy.
- Behavior Brain выбирает Activity только внутри resolved kind, Runner исполняет lifecycle по [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#6-behavior-brain-selection), а visual request обрабатывает [`ANIMATION_ENGINE.md`](../engine/ANIMATION_ENGINE.md#поток-ответственности).
- Пользовательский dialogue input снова входит через Application mapper; `think`/`respond` остаются semantic intents из [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#обязательные-сценарии), а не командами provider-а для UI или Animation.

## Варианты

| Вариант | Сценарная роль | Authoritative owner |
|---|---|---|
| Non-verbal SocialBid | Локальный idle/wander/play вариант, не требующий текста или provider-а | [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#10-coexistence-и-safety-invariants) |
| Attention-aware bid | Character-owned attention влияет на общий gate/snapshot, но pack не задаёт threshold | [`CHARACTER_ENGINE.md`](../engine/CHARACTER_ENGINE.md#2-needs-витальные-потребности) |
| User-started dialogue | User input нормализуется в existing semantic dialogue flow | [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#обязательные-сценарии) |
| Optional provider candidate | Hint конкурирует на тех же локальных условиях и не получает cadence/decision ownership | [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#1-владение) |
| Quiet/sleep suppression | Ненавязчивая инициатива подчиняется Character-owned quiet/sleep semantics | [`CHARACTER_ENGINE.md`](../engine/CHARACTER_ENGINE.md#21-каноническая-семантика-сна-и-пробуждения) |

## Graceful degradation

- При недоступном provider optional candidate просто отсутствует; локальный catalog и arbitration продолжают работать по [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#5-допустимые-и-запрещённые-inputs).
- При отсутствии eligible SocialBid Wisp использует существующий safe fallback, не создавая `social_bid`, по [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#7-scoring-и-arbitration).
- Quiet или sleep подавляет недопустимую инициативу согласно [`CHARACTER_ENGINE.md`](../engine/CHARACTER_ENGINE.md#21-каноническая-семантика-сна-и-пробуждения); provider hint не обходит этот gate.
- Unknown provider hint нормализуется только по действующим правилам [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#правила-принятия), а не интерпретируется внутри pack.
- Если dialogue visual недоступен, Animation fallback не меняет semantic response по [`ANIMATION_ENGINE.md`](../engine/ANIMATION_ENGINE.md).

## Acceptance scenarios

- **Offline initiative:** без provider-а Application формирует только локальные candidates; допустимый SocialBid проходит обычный Character/Activity/Animation flow.
- **Optional LLM hint:** provider candidate не получает отдельный priority path, не запускает Activity напрямую и может быть отклонён Character Engine.
- **User dialogue:** пользовательский input проходит mapper; `think` или `respond` становится visual behavior только после общего semantic resolution.
- **Quiet or sleep:** unsolicited SocialBid не обходит действующие quiet/sleep gates, а direct user input остаётся в общем contract flow.
- **No eligible bid:** отсутствие выбора завершается safe fallback без сети, нового intent kind или второго decision-maker.
