# Asset Pipeline

[Агент](AGENTS.md) → [Стандарты и шаблон промпта](STANDARDS.md) → [Таблица ассетов](ASSETS.md). Конкретная работа задаётся сообщением пользователя.

Пути от корня репозитория: `asset-pipeline/input/` — исходные листы, `references/` внутри пайплайна — референсы, `scripts/` — инструменты. Готовые PNG сразу в `public/assets/sprites/`; `asset-pipeline/output/` — только GIF, кеш и предложения метаданных.

Из корня репозитория, Python с Pillow, NumPy и SciPy. Если библиотеки только в существующей venv, использовать `.venv/bin/python` (Linux/macOS) или `.venv/Scripts/python.exe` (Windows).

| Операция | Команда |
|---|---|
| Пробная нарезка | `python3 asset-pipeline/scripts/process_sprites.py --file asset-pipeline/input/face_gaze.png --dry-run` |
| Записать готовые PNG | Та же команда без `--dry-run`; `npm run sprites:process` обрабатывает всю `input/` |
| GIF рабочих кадров | `npm run sprites:preview -- --all` → `output/previews/`; составного body/face-превью нет |
| Масштабировать рабочие PNG на месте | `python3 asset-pipeline/scripts/scale_overlay.py --folder public/assets/sprites/faces/gaze --scale 0.9` |
| Другие параметры | `scale_overlay.py --help`: внешнему input нужен `--output` рабочей папки; все CLI имеют `--help` |
| Тесты инструментов | `python3 -m unittest discover -s asset-pipeline/tests -p 'test_*.py'` |

`input/` и `output/` не входят в Git, передаются отдельно. Старый `generated_images/` читается через `--file`; перенос не нужен. `references/legacy-sprites-*.json` — неиспользуемые снимки; новые референсы добавлять в Git осознанно.
