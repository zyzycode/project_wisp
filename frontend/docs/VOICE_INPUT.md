# Локальный голосовой ввод

Под подписью Wisp находится кнопка **«Включить микрофон»**. Выберите RU/EN и включите
режим; при первом включении система может запросить доступ к микрофону. После этого
говорите обычными короткими фразами: пауза примерно 800 мс завершает реплику, текст
распознаётся локально и автоматически отправляется существующему диалогу. Текстовый
чат можно закрыть — режим продолжит работать. Ответ Wisp пока только текстовый.

Статус под кнопкой показывает прослушивание, распознавание, отправку или паузу.
Во время распознавания и занятости диалога новый звук не накапливается: дождитесь
«слушаю» перед следующей фразой. Кнопка **«Выключить микрофон»** сразу прекращает
захват. После перезапуска, сброса диалога, блокировки/сна системы режим нужно включить
снова; автоматического возобновления нет. Ручной черновик голосом не заменяется.

Фраза ограничена 15 секундами; более длинная речь разделяется на фрагменты.
Результат длиннее 240 символов не обрезается и не отправляется: скажите короче.
Тишина и короткие щелчки отбрасываются. Сегментация использует энергию звука,
а не отдельный классификатор человеческой речи: громкий фон может мешать. Точность
и задержка зависят от микрофона, шума и CPU; это распознавание законченных фраз,
без показа промежуточного текста по каждому слову.

## Модель и поставка

Multilingual `onnx-community/whisper-tiny`, q8, revision
`ff4177021cc41f7db950912b73ea4fdf7d01d8e7` входит в приложение. Размеры и SHA256:
[model-manifest.ts](../src/infrastructure/voice/model-manifest.ts). Всего 43 613 734 байта.
Пользователь ничего не скачивает из интерфейса; runtime не обращается за моделью
в сеть. При отсутствии или повреждении ресурса переустановите Wisp; текстовый ввод
и локальный runtime персонажа продолжают работать.

Vite до dev-запуска/компиляции запускает
[prepare-voice-model.mjs](../scripts/prepare-voice-model.mjs): проверка pinned файлов
в `frontend/.cache/voice-models/<revision>`, при необходимости HTTPS-загрузка с
ограничением размера, allowlist redirects и проверкой SHA256. Это подготовка на
машине разработчика/сборки, не действие пользователя установленного приложения.
Неполная подготовка блокирует запуск tooling. Для offline dev заранее подготовьте
модель командой `node frontend/scripts/prepare-voice-model.mjs` из корня.
Electron-builder переносит ровно семь manifest-файлов в
`<resources>/voice-models/<revision>`. Проверенные файлы читаются непосредственно
из ресурса, без копирования в userData и без скрытого сетевого fallback.

`@huggingface/transformers@4.3.2` и prebuilt `onnxruntime-node` исполняют CPU inference
в отдельном Main-owned worker с двумя intra-op потоками. Worker сохраняет модель
между репликами; отмена/таймаут завершают его. Main остаётся отзывчивым.
Remote model access и FS cache SDK выключены, `ORT_DISABLE_TELEMETRY=1`
устанавливается до загрузки native runtime. Аудио и transcript не сохраняются и
не логируются адаптером; автоматически отправленный текст подчиняется обычным
правилам истории диалога. Канонический контракт:
[UI_SPEC](engine/UI_SPEC.md#локальный-голосовой-ввод).

CPU binary входит в npm package (`frontend/.npmrc`: `onnxruntime-node-install=skip`).
У onnxruntime-node 1.30.0 нет darwin/x64 prebuilt; macOS Intel здесь unavailable.
macOS arm64 и подписанные Windows/macOS packages требуют нативной проверки.
Electron-builder распаковывает `onnxruntime-node`, `sharp`, `@img` из ASAR;
macOS имеет microphone usage description и audio-input entitlement.

## Проверки

Адресные tests: `node scripts/wisp.mjs test:frontend tests/voice tests/renderer/continuous-voice tests/renderer/voice-activity-detector`.
Полные gates: `node scripts/wisp.mjs typecheck`, затем `node scripts/wisp.mjs test:frontend`.
Desktop smoke использует синтетический микрофон, реальные capture/VAD/IPC/permissions
и тестовое распознавание. Реальный микрофон автоматически не записывается.

CPU probe публичного [jfk.wav](https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav)
без сетевого доступа в одном worker дал успешное распознавание за ~1.43 s и ~0.66 s
при повторе; таймер Main продолжал работать. Это результат одной Linux-машины,
не гарантия задержки. Живой русский микрофон требует отдельной пользовательской проверки.

Provenance: [OpenAI Whisper](https://github.com/openai/whisper) — MIT,
[ONNX export](https://huggingface.co/onnx-community/whisper-tiny), Transformers — Apache-2.0,
ONNX Runtime — MIT.
