# Asset Pipeline

[Агент](AGENTS.md) → [Стандарты и шаблон промпта](STANDARDS.md) → [Таблица ассетов](ASSETS.md). Конкретная работа задаётся сообщением пользователя.

Пути от корня репозитория: `asset-pipeline/generated_images/` — исходные листы, `references/` внутри пайплайна — референсы, `scripts/` — инструменты. Готовые PNG сразу в `public/assets/sprites/`; `asset-pipeline/output/` — только GIF, кеш и предложения метаданных.

Из корня репозитория, Python с Pillow, NumPy и SciPy. Если библиотеки только в существующей venv, использовать `.venv/bin/python` (Linux/macOS) или `.venv/Scripts/python.exe` (Windows).

Установка окружения (Python 3.12, команды из корня проекта):

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r asset-pipeline/requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s asset-pipeline/tests -p 'test_*.py'
```

Linux/macOS: `python3.12 -m venv .venv`, затем `.venv/bin/python -m pip install -r asset-pipeline/requirements.txt`.
Версии зависимостей закреплены в [requirements.txt](requirements.txt). Активация не обязательна: вызывайте Python из `.venv` явно.

Семь наборов AUTO-I04/I05/I06 и #48 имеют ручную разметку масштаба и контактов в
[рецепте экспорта](references/requested-sprites-export.json). Их повторная сборка из сохранённых исходников:

```powershell
$env:PYTHONUTF8='1'
.\.venv\Scripts\python.exe asset-pipeline/scripts/export_requested.py --recipe asset-pipeline/references/requested-sprites-export.json
.\.venv\Scripts\python.exe asset-pipeline/scripts/verify_requested.py
```

Первая команда записывает 28 рабочих PNG и предложение метаданных, вторая проверяет кадры,
стыки и формирует светлый/тёмный контактные листы и семь GIF. Подробности —
[отчёт приёмки](references/REQUESTED_SPRITES_QA.md). Обычный `process_sprites.py`, в том числе
с `--force`, пропускает ключи из этого рецепта, чтобы не потерять выверенное размещение.
На Linux/macOS использовать `.venv/bin/python`; для тестов на Windows также задать `PYTHONUTF8=1`.

После приёмки художник регистрирует назначенные наборы в
[public/assets/sprites/manifest.json](../public/assets/sprites/manifest.json): переносит
соответствующие записи `entries` из предложения, сохраняя остальные записи манифеста.
Проверка: `.venv/Scripts/python.exe scripts/validate_manifest.py --check --json` из корня проекта,
затем `npm run test -- tests/renderer/manifest-loader.test.ts tests/renderer/asset-resolver.test.ts`.
Экспорт и проверка PNG сами по себе манифест не изменяют.

| Операция | Команда |
|---|---|
| Пробная нарезка | `python3 asset-pipeline/scripts/process_sprites.py --file asset-pipeline/generated_images/face_gaze.png --dry-run` |
| Записать готовые PNG | Та же команда без `--dry-run`; `npm run sprites:process` обрабатывает листы непосредственно в `generated_images/` |
| GIF рабочих кадров | `npm run sprites:preview -- --all` → `output/previews/`; составного body/face-превью нет |
| Масштабировать рабочие PNG на месте | `python3 asset-pipeline/scripts/scale_overlay.py --folder public/assets/sprites/faces/gaze --scale 0.9` |
| Другие параметры | `scale_overlay.py --help`: внешнему input нужен `--output` рабочей папки; все CLI имеют `--help` |
| Тесты инструментов | `python3 -m unittest discover -s asset-pipeline/tests -p 'test_*.py'` |

Корневая `generated_images/` и прежняя `asset-pipeline/input/` объединены в `asset-pipeline/generated_images/`. Исходники из старой корневой папки отслеживались Git; новый каталог не исключён из Git. Промежуточные варианты хранятся в `generated_images/attempts/`: автоматическая обработка не обходит вложенные папки. Любой отдельный лист можно передать через `--file`. `output/` не входит в Git. `references/legacy-sprites-*.json` — неиспользуемые снимки; новые референсы добавлять в Git осознанно.
