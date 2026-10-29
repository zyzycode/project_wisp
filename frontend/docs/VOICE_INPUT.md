# Локальный голосовой ввод

В чате нажмите подготовку модели и дождитесь окончания загрузки, затем выберите RU/EN,
начните запись и остановите её. Через 30 секунд запись остановится автоматически.
Результат появляется в редактируемом черновике; отправка всегда ручная. Изменение
черновика, отмена или закрытие чата отменяет подстановку. Текст длиннее 240 символов
не обрезается: сократите запись и повторите. Разрешение микрофона нужно только для записи.

Используется multilingual `onnx-community/whisper-tiny`, q8, revision
`ff4177021cc41f7db950912b73ea4fdf7d01d8e7`. Манифест с размерами и SHA256 каждого файла:
[model-manifest.ts](../src/infrastructure/voice/model-manifest.ts). Всего 43 613 734 байта
модели, tokenizer и конфигурации. Загрузка явная, HTTPS, с проверкой перенаправлений,
ограничением размера и десятиминутным deadline. Частичные файлы не используются.
После подготовки распознавание работает без сети, backend и API-ключей.

Кеш: `<Electron userData>/voice-models/<revision>`. Его можно удалить при закрытом
приложении, чтобы освободить место. Повреждённый кеш потребует повторной подготовки.
Перед каждым распознаванием проверяется целостность. Записи и распознанный текст
не сохраняются адаптером на диск и не логируются. До запуска native runtime адаптер
устанавливает `ORT_DISABLE_TELEMETRY=1`: отключены ORT uploader, события и persistent ID
([ORT Privacy](https://github.com/microsoft/onnxruntime/blob/main/docs/Privacy.md)). Добавленный пользователем в чат
текст далее подчиняется обычным правилам истории чата.

## Runtime и поставка

`@huggingface/transformers@4.3.2` использует CPU prebuilt `onnxruntime-node` в отдельном
Main-owned worker с двумя intra-op потоками. Native SDK загружается лениво; недоступный
binary возвращает безопасную ошибку, не останавливает персонажа. Сборка native runtime
на машине пользователя не предусмотрена. Для установки CPU-зависимостей без загрузки
ненужного CUDA payload в `frontend/.npmrc` закреплён `onnxruntime-node-install=skip`
(CPU уже в npm package; эквивалент `ONNXRUNTIME_NODE_INSTALL=skip`).
У транзитивного onnxruntime-node 1.30.0 нет darwin/x64 prebuilt: macOS Intel
в этой поставке считается unavailable, arm64 требует отдельной нативной проверки.

Worker включён в Vite и desktop smoke entries. Electron-builder явно распаковывает
`onnxruntime-node`, `sharp`, `@img` из ASAR. macOS конфигурация содержит
`NSMicrophoneUsageDescription` и `com.apple.security.device.audio-input`; camera
permission не запрашивается. Основание: [Electron media permissions](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesaskformediaaccessmediatype-macos).
Подписанная сборка macOS и её системный permission prompt требуют проверки на macOS.

Размер модели не равен размеру приложения или памяти: в Linux probe установленный
`onnxruntime-node` занимал 288 MiB, Transformers — 16 MiB (не полный размер зависимостей
или installer). Процесс во время CPU sample smoke показывал RSS около 582 MB.

## Проверка

Адресные tests: `node scripts/wisp.mjs test:frontend tests/voice` из корня.
Полные gates: `node scripts/wisp.mjs typecheck`, затем `node scripts/wisp.mjs test:frontend`.
Desktop smoke использует test-only fake microphone, без записи настоящего микрофона.

Реальный CPU probe: публичный [jfk.wav из whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav),
11 секунд mono PCM16/16 kHz. После загрузки и проверки модели запуск без сетевого
доступа вернул корректный английский текст за ~1.37 секунды, включая загрузку worker;
таймер основного процесса продолжал работать (135 ticks по 10 ms). Это наблюдение на
одной Linux-машине, не гарантия задержки. Реальный русский sample и подписанные
Windows/macOS packages в этой проверке не запускались; RU routing покрыт unit tests.

Provenance: исходная [OpenAI Whisper](https://github.com/openai/whisper) — MIT,
[ONNX export](https://huggingface.co/onnx-community/whisper-tiny) ссылается на неё без
отдельной license metadata; Transformers — Apache-2.0, ONNX Runtime — MIT.
