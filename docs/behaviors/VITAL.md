# Vital behavior pack

Этот pack — неканоническое описание сценария. DTO, thresholds, priorities и transitions принадлежат [engine contracts](../engine/README.md), а не этому файлу.

## Пользовательская цель

Wisp естественно отдыхает, засыпает и просыпается, не путая потребность в комфорте с самим сном и не игнорируя прямое взаимодействие пользователя.

## End-to-end flow

- Application создаёт opportunity и передаёт неизменяемый snapshot и существующие candidates по [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#4-p4-opportunity-и-нормализация).
- Character Engine единолично интерпретирует energy/comfort, quiet и semantic sleep/wake state, применяя [`CHARACTER_ENGINE.md`](../engine/CHARACTER_ENGINE.md#21-каноническая-семантика-сна-и-пробуждения).
- Candidate использует только существующие `sleep`, `wake`, `quiet` или `idle`; их public смысл определён в [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#начальный-каталог).
- После gating Character Engine публикует не более одного resolved intent по [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#2-единственная-цепочка-решений).
- Для Activity-backed intent Behavior Brain выбирает только совместимую Rest/Sleep Activity, а Runner исполняет её lifecycle по [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#5-начальные-chains).
- Runner выпускает semantic visual requests; sleep/wake presentation и interrupt rules остаются в [`ANIMATION_ENGINE.md`](../engine/ANIMATION_ENGINE.md#витальный-сон-и-пробуждение).
- Завершение или отмена Activity создаёт следующую opportunity через Application cadence из [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#4-p4-opportunity-и-нормализация), не через render tick.

## Варианты

| Вариант | Сценарная роль | Authoritative owner |
|---|---|---|
| Rest before sleep | Activity-вариант внутри уже resolved behavior, не новый intent | [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#6-behavior-brain-selection) |
| Semantic sleep | Решение Character Engine; visual sleep не принимает его заново | [`CHARACTER_ENGINE.md`](../engine/CHARACTER_ENGINE.md#21-каноническая-семантика-сна-и-пробуждения) |
| Wake | Разрешённый semantic выход из sleep state | [`CHARACTER_ENGINE.md`](../engine/CHARACTER_ENGINE.md#21-каноническая-семантика-сна-и-пробуждения) |
| Quiet comfort | Подавление навязчивой активности без неявного сна | [`BEHAVIOR_INTENTS.md`](../engine/BEHAVIOR_INTENTS.md#правила-принятия) |
| Drag while sleeping | Forced position отменяет Activity; semantic и visual части не становятся вторым physics owner | [`MOTION_ENGINE.md`](../engine/MOTION_ENGINE.md#8-forced-motion-и-position-authority) |

## Graceful degradation

- Если совместимая Activity отсутствует, Behavior Brain возвращает отсутствие выбора; safe semantic fallback остаётся в [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#2-поток-activity) и [`AUTONOMY_ENGINE.md`](../engine/AUTONOMY_ENGINE.md#7-scoring-и-arbitration).
- Если специализированный visual недоступен, Animation Controller сохраняет semantic sleep/wake state и применяет свой fallback из [`ANIMATION_ENGINE.md`](../engine/ANIMATION_ENGINE.md).
- Если direct input или forced motion прерывает отдых, Runner выполняет cancel по [`ACTIVITY_ENGINE.md`](../engine/ACTIVITY_ENGINE.md#10-interruption-и-cancel), а Motion остаётся единственным owner позиции.
- `quiet` без resolved `sleep` не запускает sleep lifecycle согласно [`CHARACTER_ENGINE.md`](../engine/CHARACTER_ENGINE.md#21-каноническая-семантика-сна-и-пробуждения).

## Acceptance scenarios

- **Autonomous sleep:** при Character-owned условии сна и отсутствии запрещающего более сильного взаимодействия появляется один resolved `sleep`; выбирается совместимая Activity, затем Animation FSM показывает sleep lifecycle.
- **Comfort without sleep:** при resolved `quiet` Wisp остаётся в спокойном допустимом состоянии и не начинает sleep lifecycle только из-за quiet.
- **Wake:** допустимое wake-событие проходит общий Character gate; visual wake начинается только после resolved `wake`.
- **Drag interruption:** начало drag во время сна отменяет активную Activity, Motion получает forced authority, а visual path следует общему Motion/Animation flow.
- **Missing specialization:** отсутствие подходящей Activity или visual не создаёт новый intent и не оставляет второй активный lifecycle owner.
