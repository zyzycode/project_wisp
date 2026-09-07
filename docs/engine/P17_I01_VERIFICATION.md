# P17-I01 (#44): dialogue runtime cutover

Prerequisite: P17-A02 (#19) closed as completed; contract in AI_PROVIDER_CONTRACT.md.

## Implementation

- Main owns one DialogueRuntime and MockAIProvider for the app lifecycle, using the
  existing CharacterStateService. Window close/reload detaches or replaces the stream;
  pending provider execution remains guarded across window recreation.
- Application admits exact typed commands, consumes sequence once, enforces a shared
  15-second deadline, normalizes provider responses and stores three complete context pairs.
- Semantic stimuli, reply/context and presentation commit inside the existing Brain
  transaction. Dialogue changes are semantic for publisher backpressure; no separate stream.
- Main checks trusted sender; Preload validates commands, receipts and full snapshots.
- Renderer owns only draft/admission transport state and renders Brain dialogue.
  Receipt cannot complete thinking; duplicate revisions cannot repeat a reply.
- Main tracks dialogue-owned visual episodes. Terminal/reset releases only that waiting
  episode; newer user input, sleep, activities and forced Motion keep priority.
- Old processDialogueTurn/animation-dispatch helper and Renderer provider lifecycle
  were removed. Their legacy tests were migrated to runtime/context and transport regressions.
- No external provider, network setup, persistence, credentials, settings UI, new IPC
  state stream, dependencies or sprite changes.

## Automated coverage

- Admission, duplicate/busy sequence, malformed payload and trusted sender.
- Both await-stage timeouts, exact deadline, late rejection/success, reset/reload/dispose,
  execution guard through stream replacement, fallback and error without partial context.
- Main Character snapshot, six-message context bound, response validation, reply limit,
  fallback hints ignored, one provider stimulus/candidate per successful turn.
- Shared Brain publisher ordering/deduplication; Preload validation in both directions.
- Renderer receipt/snapshot ordering, local submission lock, rejection/transport errors,
  stale stream receipt, and no retry.
- Main thinking cleanup, late reply after user interaction/drag, and user sleep protection.

Native interactive chat verification is not claimed by these deterministic tests.
Next gate: reviewer.

Verification completed: `npm run typecheck`, `npm test` (599 passed, 2 skipped),
`npm run build`, and `git diff --check` passed. Standard-suite skips remain the
existing platform-specific factory case and opt-in native window smoke.
