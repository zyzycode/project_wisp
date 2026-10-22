# Asset Pipeline

[Агент](AGENTS.md) → [Стандарты и шаблон промпта](STANDARDS.md) → [Таблица ассетов](ASSETS.md). Конкретная работа задаётся сообщением пользователя.

Все команды ниже выполняются из `frontend/` (из корня репозитория сначала `cd frontend`). Пути от этого каталога: `asset-pipeline/generated_images/` — исходные листы, `references/` внутри пайплайна — референсы, `scripts/` — инструменты. Готовые PNG сразу в `public/assets/sprites/`; `asset-pipeline/output/` — только GIF, кеш и предложения метаданных.

У пайплайна собственное окружение `frontend/asset-pipeline/.venv/` с Python 3.12, Pillow, NumPy и SciPy. Оно независимо от `backend/.venv/`; корневые `.venv/` и `frontend/.venv/` для пайплайна не используются. Само окружение исключено из Git.

Установка окружения на Windows из `frontend/`:

```powershell
py -3.12 -m venv asset-pipeline/.venv
.\asset-pipeline\.venv\Scripts\python.exe -m pip install -r asset-pipeline/requirements.txt
.\asset-pipeline\.venv\Scripts\python.exe -m unittest discover -s asset-pipeline/tests -p 'test_*.py'
```

Linux/macOS, также из `frontend/`:

```bash
python3.12 -m venv asset-pipeline/.venv
asset-pipeline/.venv/bin/python -m pip install -r asset-pipeline/requirements.txt
asset-pipeline/.venv/bin/python -m unittest discover -s asset-pipeline/tests -p 'test_*.py'
```

Версии зависимостей закреплены в [requirements.txt](requirements.txt). Активация не обязательна: вызывайте Python из `asset-pipeline/.venv` явно. Для активации на Linux/macOS: `source asset-pipeline/.venv/bin/activate`; в PowerShell: `.\asset-pipeline\.venv\Scripts\Activate.ps1`.
При переносе окружения создавайте его заново по requirements: простое перемещение venv оставляет абсолютные пути в служебных файлах. Исторические команды в отчётах `references/` следует запускать с интерпретатором из этого раздела.

Семь наборов AUTO-I04/I05/I06 и #48 имеют ручную разметку масштаба и контактов в
[рецепте экспорта](references/requested-sprites-export.json). Их повторная сборка из сохранённых исходников:

```powershell
$env:PYTHONUTF8='1'
.\asset-pipeline\.venv\Scripts\python.exe asset-pipeline/scripts/export_requested.py --recipe asset-pipeline/references/requested-sprites-export.json
.\asset-pipeline\.venv\Scripts\python.exe asset-pipeline/scripts/verify_requested.py
```

Первая команда записывает 28 рабочих PNG и предложение метаданных, вторая проверяет кадры,
стыки и формирует светлый/тёмный контактные листы и семь GIF. Подробности —
[отчёт приёмки](references/REQUESTED_SPRITES_QA.md). Обычный `process_sprites.py`, в том числе
с `--force`, пропускает ключи из этого рецепта, чтобы не потерять выверенное размещение.
На Linux/macOS использовать `asset-pipeline/.venv/bin/python`; для тестов на Windows также задать `PYTHONUTF8=1`.

После приёмки художник регистрирует назначенные наборы в
[public/assets/sprites/manifest.json](../public/assets/sprites/manifest.json): переносит
соответствующие записи `entries` из предложения, сохраняя остальные записи манифеста.
Проверка: `asset-pipeline/.venv/Scripts/python.exe scripts/validate_manifest.py --check --json` из `frontend/`,
затем `npm run test -- tests/renderer/manifest-loader.test.ts tests/renderer/asset-resolver.test.ts`.
Экспорт и проверка PNG сами по себе манифест не изменяют.

Нормализация размеров/совмещения **SPRITE-NORMALIZE-2026-09**:

```bash
asset-pipeline/.venv/bin/python asset-pipeline/scripts/normalize_reviewed.py
asset-pipeline/.venv/bin/python asset-pipeline/scripts/normalize_reviewed.py --apply
asset-pipeline/.venv/bin/python asset-pipeline/scripts/normalize_reviewed.py --check
```

Первая команда готовит сравнения «до/после», GIF и предложение в
`output/normalization/`; `--apply` устанавливает только изменившиеся проверенные
PNG и метаданные из рецепта; `--check` проверяет результат без записи.
Для новых исправлений графики порядок такой: сначала полный пак в
`generated_images/`, затем проверка исходника, нарезка и проверка рабочих PNG.
Сохранены промпты [surface_touch](references/surface-touch-faces-v2.prompt.txt)
и [look_around](references/look-around-faces-v2.prompt.txt).
Новый исходный пак проверяется по SHA-256 перед экспортом. Старые
исходные PNG читаются из Git-ревизии, зафиксированной в
[рецепте](references/normalization-2026-09.json), поэтому требуется доступная
история Git. Повторный запуск не масштабирует уже обработанные картинки.
Неизвестные изменения рабочих PNG отклоняются. Обычный `process_sprites.py`
сохраняет разметку наборов этого рецепта даже с `--force`.
`body_surface_touch` и `body_look_around` нарезаются из готовых паков
[body_surface_touch_faces_v2.png](generated_images/body_surface_touch_faces_v2.png)
и [body_look_around_faces_v2.png](generated_images/body_look_around_faces_v2.png)
с уже нарисованными лицами; дополнительные face-слои к ним не применяются.
Аналогично перегенерированы `body_lie`, `body_crouch_examine`, `body_sit`,
`body_sit_edge` и `body_stand_up`: [исходники, промпты и QA](references/FIVE_POSES_V2_QA.md).
Все семь наборов зарегистрированы как `baked_in`, без приклеивания face_*.
Исторический `requested-sprites-export.json` содержит заменённый `body_sit_edge`
и помечен `supersededBy`; `export_requested.py` отклоняет весь такой пакет до
записи PNG, чтобы не восстановить старый дефектный набор. Для текущих паков
использовать `normalize_reviewed.py --apply`.
[Разбор дефектов и приёмка](references/NORMALIZATION_2026_09_QA.md).

| Операция | Команда |
|---|---|
| Пробная нарезка | `asset-pipeline/.venv/bin/python asset-pipeline/scripts/process_sprites.py --file asset-pipeline/generated_images/face_gaze.png --dry-run` |
| Записать готовые PNG | Та же команда без `--dry-run`; `npm run sprites:process` обрабатывает листы непосредственно в `generated_images/` |
| GIF рабочих кадров | `npm run sprites:preview -- --all` → `output/previews/`; составного body/face-превью нет |
| Масштабировать рабочие PNG на месте | `asset-pipeline/.venv/bin/python asset-pipeline/scripts/scale_overlay.py --folder public/assets/sprites/faces/gaze --scale 0.9` |
| Другие параметры | `scale_overlay.py --help`: внешнему input нужен `--output` рабочей папки; все CLI имеют `--help` |
| Тесты инструментов | `asset-pipeline/.venv/bin/python -m unittest discover -s asset-pipeline/tests -p 'test_*.py'` |

CURSOR-GAME-V1: два шестикадровых набора пересобираются командой
`asset-pipeline/.venv/bin/python asset-pipeline/scripts/export_cursor_game.py` из исходников в
`generated_images/cursor_game/`. Скрипт сохраняет PNG по папкам, формирует GIF и метаданные
в `output/cursor_game/`. [Промпты, приёмка и проверки](references/CURSOR_GAME_QA.md).

Корневая `generated_images/` и прежняя `asset-pipeline/input/` объединены в `asset-pipeline/generated_images/`. Исходники из старой корневой папки отслеживались Git; новый каталог не исключён из Git. Промежуточные варианты хранятся в `generated_images/attempts/`: автоматическая обработка не обходит вложенные папки. Любой отдельный лист можно передать через `--file`. `output/` не входит в Git. `references/legacy-sprites-*.json` — неиспользуемые снимки; новые референсы добавлять в Git осознанно.

## Монорепозиторий

Pipeline находится в `frontend/asset-pipeline/` и сохраняет отдельный scope. Существующие команды этого документа выполнять из `frontend/`: относительные `public/`, `src/` и `asset-pipeline/` относятся к desktop. Общие docs находятся в корневом `docs/`, выше frontend. Скрипты определяют frontend root по расположению pipeline; runtime/создание графики не относятся к общим dev/test-командам.
