# CURSOR-GAME-V1 — 2026-09-08

Готовы и зарегистрированы два набора: [cursor_caught](../../public/assets/sprites/body/cursor_caught/)
и [cursor_missed](../../public/assets/sprites/body/cursor_missed/). По 6 кадров PNG RGBA 512×512,
каждый 100 ms, клип 600 ms. Референс внешности и геометрии —
[body_cursor_play_00.png](../../public/assets/sprites/body/cursor_play/body_cursor_play_00.png).

Генерация выполнена встроенным image_gen; [промпты](cursor-game-prompts.json).
[Исходники](../generated_images/cursor_game/) сохранены вместе с попытками. RGB-варианты
с нарисованной сеткой не использованы: приняты листы с настоящим alpha после удаления фона image_gen.
Нарезка скриптом разделяет по три силуэта в каждом из двух рядов, сохраняет исходное сглаживание.
Единый масштаб внутри набора рассчитан по медианной высоте стоящего персонажа относительно референса;
положение выровнено по тёмным подошвам, а не центру силуэта с вытянутой рукой.

Радость: завершить хватательный жест → улыбнуться → радостно закрыть глаза → нейтральная поза.
Промах: посмотреть вслед цели → лёгкое удивление → опустить руки → нейтральная поза.
Системный курсор, опора и фон не нарисованы. Лицо встроено: `baked_in`, `fallback: none`.
Pivot и root всех кадров `(256,460)`; нижняя граница подошв Y=462 соответствует референсу.
Центр подошв X=256 с округлением до 0.5 px; изменение их ширины внутри клипа не более 3 px.
Это проверка размещения растровых кадров, не проверка сценической логики игры.

## Воспроизведение

Из корня проекта (Linux/macOS: `.venv/bin/python`):

```powershell
$env:PYTHONUTF8='1'
.\.venv\Scripts\python.exe asset-pipeline/scripts/export_cursor_game.py
.\.venv\Scripts\python.exe -m unittest discover -s asset-pipeline/tests -p test_export_cursor_game.py
.\.venv\Scripts\python.exe scripts/validate_manifest.py --check --strict --json
```

Экспорт меняет только PNG этих двух наборов и `output/cursor_game/`; регистрация выполнена
отдельно в [манифесте](../../public/assets/sprites/manifest.json) с сохранением остальных записей.
Автоматически проверяются формат, прозрачность, отсутствие обрезки, положение подошв и длительность.
Регрессионный тест проверяет, что вытянутая рука не сдвигает стопы при выравнивании.
Визуально просмотрены все 12 кадров на светлом и тёмном фоне.

Итог проверок: локальный тест выравнивания — OK; manifest-loader/asset-resolver — 69 тестов
прошли; `npm run typecheck` — OK. Строгий валидатор: 48 анимаций, 200 PNG, ноль ошибок
и предупреждений. Ссылки документации и `git diff --check` проверены.

- [Тёмный лист](../output/cursor_game/contact-dark.png), [светлый лист](../output/cursor_game/contact-light.png).
- [Радость GIF](../output/cursor_game/body_cursor_caught.gif), [промах GIF](../output/cursor_game/body_cursor_missed.gif).
- [Измерения](../output/cursor_game/verification.json), [метаданные](../output/cursor_game/manifest-proposal.json).

Новые ключи доступны загрузчику. Выбор опциональных клипов вместо общих `happy_reaction` /
`confused_reaction` остаётся отдельным изменением приложения; FSM и resolver этой задачей не менялись.
