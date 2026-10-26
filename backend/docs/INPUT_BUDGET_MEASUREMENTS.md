# Оценка входа и резерв ответа

Канонические правила — [Prompt Engine](CONTEXT_PROMPT_ENGINE.md#openai-ограничение-точности).
Сравнение #118 — [fixture](../tests/fixtures/prompt_inspection/issue118_comparison.json),
исторические измерения — [calibration](../tests/fixtures/prompt_inspection/issue118_calibration.json).
Все новые результаты получены offline из одного текущего post-#120 корпуса и одинаковых
settings. Окна остаются 16384/8192; wire byte/UTF-16 caps не меняются.

## Что измерено

Архив #117 содержит 88 attempts, 87 ответов с endpoint-reported usage и 43 полные
before/after пары. Один RU greeting before завершился timeout: usage неизвестен.
Requested model `gpt-6-sol`, reasoning none, один endpoint, synthetic RU/EN corpus,
по одному ответу на arm/case. Actual upstream model identity, tokenizer version,
raw framing, cached tokens и hidden reasoning breakdown в архиве отсутствуют.
Нельзя выдавать эти числа за текущие модельные измерения или tokenizer truth.

На тех же финальных исторических payloads legacy estimate / input usage:
min 5.434, median 5.541, max 5.734. Новый script-aware candidate: min 3.534,
median 3.654, max 3.836; ни одной недооценки в этих 87 наблюдениях.
Это описательная проверка на доступной выборке, без независимого holdout:
нет универсального верхнего ограничения или обещания точности на новых данных.
Простые bytes/3 и bytes/4 дают меньшие ratios на архиве, но не учитывают scripts
и произвольный Unicode; их не выбираем только ради близости к этим samples.
Короткие ASCII identifiers/random words всё ещё могут недооцениваться.
Длинные ASCII runs, цифры, punctuation и unsupported scripts учитываются побайтно;
20% и framing — осторожная локальная политика, не доказательство token bounds.
Применение ограничено sol/none; Mini/Astra остаются на старом byte fallback.

## Почему резерв не уменьшен

Output reserve — минимум server setting и scenario cap; он также отправляется как
provider output limit и целиком вычитается из локального окна. Официальный
[Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
определяет `max_completion_tokens` как общий предел visible output и reasoning tokens;
это контракт API, не измерение Astra на нашем endpoint. Operator setting может
уменьшить его, но selector никогда не уменьшает cap ради добавления optional блока.
Сохраняем текущие значения, а не подгоняем их под короткие исторические ответы:

| Scenario | gpt-6-sol/none | gpt-4.1-mini | gpt-6-astra/low | Основание и неизвестное |
|---|---:|---:|---:|---|
| Chat | 4096 | 4096 | 4096 | text до 2000 UTF-16, JSON/appraisal/decision, до 3 memory quotes и beverage proposal; Astra cap включает hidden reasoning |
| Touch/event/observation | 1024 | 1024 | 1024 | text до 240 UTF-16 плюс JSON/appraisal; observation и reasoning не измерены |
| Summary generation | 512 | 512 | 512 | Сохранён существующий cap, до 1200 UTF-16 semantic text; нет samples, нет гарантии размещения предельного ответа |

Исторические output tokens: chat n75 median81/p95 114.3/max163;
touch n4 median44.5/max46; event n8 median22/max28. Нет summary/observation samples,
вариативности длинных ответов, текущего profile/beverage quality или Astra reasoning.
Output usage отражает весь reported output, не только длину `text`; raw breakdown
не сохранён и не считается нулём. Значения cap не гарантируют, что любой валидный
ответ максимальной длины поместится. `finish_reason=length` остаётся безопасной
ошибкой с известным paid usage, без публикации частичного JSON или автоповтора.

## Воспроизведение и границы

`test_input_budget_experiment.py` пересобирает compact before с явно закреплённым
legacy estimator и after с реальным runtime routing через существующий inspector.
Fixture содержит settings, methods, required/selected units, полные history pairs,
reserve, payload hashes, block hashes и точные source/provenance deltas каждой сцены.
`test_openai_budget.py` проверяет Unicode, escapes, identifiers/random ASCII, пустой
payload, equality и mandatory overflow без сети. Existing provider tests покрывают
длинный/incomplete output, JSON/schema, paid usage, deadline и cancellation.
Gemini runtime использует прежний countTokens с исходным deadline; offline preview
по-прежнему byte-based и не называется модельным count.
Conditional beverage JSON schema учитывается в финальном payload; её token usage
не измерялся в #117 и здесь проверяется только offline.
Архивы #117/#123/#114 не перезаписываются. Их replay явно использует legacy estimator;
актуальный runtime и новый выбор контекста проверяются отдельно. Нет новых provider
calls, tokenizer dependency, увеличения окна, history capacity или prompt voice edits.
