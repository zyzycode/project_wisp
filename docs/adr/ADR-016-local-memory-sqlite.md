# ADR-016: Локальная память MVP и SQLite-драйвер

Status: architect accepted; independent review temporarily waived by user for the current execution batch, 2026-09-18. Task: [P15-A01 / #21](https://github.com/zyzycode/project_wisp/issues/21). [ARCHITECT RESULT и Implementation consequences](../engine/P15_A01_RESULT.md).

## Decision

Выбран `better-sqlite3@13.0.3`: файловые транзакции/WAL и обновление SQLite независимо от Electron. Пакет содержит SQLite 3.53.4 и N-API prebuilds, включая Windows x64. Синхронные операции исполняет Infrastructure worker под управлением Main; [ownership](../engine/MEMORY_ENGINE.md#1-границы-владение-и-источник-истины).

## Alternatives

- **`node:sqlite`, без новой зависимости:** установленный Electron 43.4.1 / Node 24.18.1 содержит SQLite 3.53.1. Исправления High CVE-2026-11822/11824 начинаются с [3.53.2](https://www.sqlite.org/cves.html). Условия эксплуатации запрещены контрактом; выбран уже исправленный SQLite без обновления Electron. Повторное рассмотрение — после проверки встроенной версии целевого Electron.
- **`sql.js@1.13.0`:** MIT/WASM, без runtime dependencies, 21.71 MB unpacked. Стандартный [import/export всей БД](https://github.com/sql-js/sql.js) потребует дополнительного файлового протокола для durability; не выбран.
- **Собственный TS/JSON:** транзакции и crash recovery не заменяются 50–100 строками; небольшая обёртка драйвер не устраняет.

## Dependency Review

**Verdict 2026-09-18: approved** для отдельной установки exact `better-sqlite3@13.0.3`, dev-only `@types/better-sqlite3@9.6.0`; lock resolution `node-addon-api@8.9.2`, существующий `@types/node@26.3.0`. Иные версии/transitives требуют актуализации review.

| Критерий | Оценка |
|---|---|
| Лицензии | Драйвер, addon-api, typings — MIT; SQLite — public domain. |
| Размер/transitives | Драйвер: 11.40 MB tarball / 27.30 MB unpacked, Windows x64 binary 1.99 MB. Единственный runtime transitive addon-api: 0.42 MB, своих зависимостей нет. Typings: 9.55 KB, только @types/node. Прирост installer не измерен. |
| Maintenance | Драйвер выпущен 2026-08-05, addon-api — 2026-08-12, typings — 2026-08-01; maintenance за последний год подтверждён. |
| CVE | OSV exact-version queries по четырём версиям выше и [upstream advisories](https://github.com/WiseLibs/better-sqlite3/security/advisories) без найденных уязвимостей; известных открытых Critical не обнаружено. SQLite 3.53.4 включает упомянутые исправления. |
| Electron/native | [N-API v13](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0) сокращает зависимость от Electron ABI; worker/ASAR compatibility требует Windows-приёмки. JS/WASM альтернатива оценена выше. |

Первичные metadata: [driver](https://registry.npmjs.org/better-sqlite3/13.0.3), [addon-api](https://registry.npmjs.org/node-addon-api/8.9.2), [typings](https://registry.npmjs.org/@types/better-sqlite3/9.6.0). SQLite version/binaries проверены в опубликованном driver tarball; security verdict датирован и не гарантирует отсутствия неизвестных CVE.

## Consequences

Добавляются native binary и packaging responsibility. Dependency approval не разрешает package/lock/config edits; отдельный scope и Windows/capability gates — [Memory §8](../engine/MEMORY_ENGINE.md#8-integration-scope-и-платформенная-приёмка). Runtime downgrade/download/rebuild на машине пользователя не допускаются.

[Schema/retention](../engine/MEMORY_ENGINE.md#2-схема-sqlite-v1), [lifecycle/errors](../engine/MEMORY_ENGINE.md#4-lifecycle-restore-и-деградация), [reset](../engine/MEMORY_ENGINE.md#6-полный-reset-и-защита-от-поздних-записей) определены в контракте. Исполнимые формы: [ports](../../src/application/ports/memory-repository.interface.ts), [snapshot](../../src/application/ports/character-memory-snapshot.ts), [IPC DTO](../../src/shared/ipc-contracts.ts).
