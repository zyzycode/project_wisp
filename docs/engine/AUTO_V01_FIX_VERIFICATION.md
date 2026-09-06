# AUTO-V01 / #43: fixes after Windows review

Date: 2026-09-06. Scope: helper startup/frame failures and routing to elevated windows.
Contracts: [PERCEPTION_ENGINE.md](PERCEPTION_ENGINE.md) §10;
native checklist: [AUTO_I05_VERIFICATION.md](AUTO_I05_VERIFICATION.md) and
[AUTO_I06_VERIFICATION.md](AUTO_I06_VERIFICATION.md).

## Changes

- Removed `-ExecutionPolicy Bypass` from the system PowerShell `-File` launch.
  Host policy is inherited; policy denial still fails closed.
- A missing or empty DWM frame cannot supply a support. Under the existing
  per-monitor-v2 thread context, a valid `GetWindowRect` is used only as a
  conservative occluder. A successfully measured zero-area window is skipped;
  failed or inverted geometry still rejects the observation.
- Existing token cleanup removes identities for windows that lose DWM support.
  No ports, DTOs, dependencies, sprites or process boundaries changed.

## Routing to elevated windows

External top candidates are bounded by the window and the screen root collision
range, rather than the 500 DIP floor-wander radius. Direct jumps still require a
clear ballistic path. If a window blocks the jump from the floor, the route tries
the nearest screen side, then the opposite side: walk along the floor → grab →
existing screen-wall climb → jump onto the near part of the window top → walk to
the selected support-local point. This reuses the screen climb FSM; it does not
invent a window side when that side was not observed.

Every planned approach, climb, jump and support walk is checked against observed
window bodies. Landing uses the real top coordinate. Tops above the inset root
limit (for example y=0 with a 90 DIP top inset) remain unreachable; no clipping or
fictional support is introduced. Direct routes keep priority. Walk deadlines
scale with distance using the existing default wander speed, with the existing
7-second timeout as a minimum.

The screen-climb action can retain its external goal. A missing, stale, moved or
resized goal invalidates the climb before the jump and cancels into ordinary
fall. Once attached, the final walk uses support-local distance and follows
small moves. The route remains a single Explore/Rest Activity with normal user
interruption and existing sprites.

`GetWindowRect` can include invisible resize borders and is DPI-virtualized:
[Microsoft API reference](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowrect).
It is not substituted for DWM support bounds.

## Verification

- Regression first failed with `Frame unavailable`, then passed after the fix.
  The actual bundled C# Sample method runs in PowerShell 5.1 with deterministic
  native-call stubs: successful DWM geometry, failed/empty DWM frame, conservative
  edge occlusion, empty fallback rectangle and unavailable fallback geometry.
- Factory regression checks the exact executable, arguments and process flags.
- See the final verification update below for current full-suite and native results.
  The first full run failed because `python3` resolved to the Windows Store stub;
  the successful run used bundled Python through a temporary PATH shim, removed
  afterward. No project configuration was changed for this environment issue.
- `npm run build` and `git diff --check`: passed.
  The Electron build includes the routing fix and is ready for native verification.
- Routing regressions failed before the fix and now pass. Domain tests cover a
  900×600 window at (300,250) above Wisp at (650,1070), both screen sides,
  obstructed detours, targets beyond 500 DIP, invalid top coordinates, support
  bounds and zero-distance approaches. ActivityRunner with real Motion/Surface
  engines completes Explore and Rest through the detour, cancels on user input
  or target loss during climb, and follows a moved support during the final walk.
- Native system PowerShell `-File`, without policy override: 10 consecutive
  requests returned valid snapshots; stdin EOF produced exit code 0. Repeated
  with a temporary WinForms window: also 10 snapshots and exit code 0.
  Both runs returned zero accepted windows. These checks confirm startup,
  sampling and shutdown, **not successful support discovery**.

## Explorer drag-release fix

Read-only native diagnostics found an Explorer frame at (167,246), 1561×815,
with an available top edge. Its bottom was 1061, below the work-area bottom 1032
on the 1920×1080 display. Normalization rejected the entire frame, so the release
selector never received its top. This failure was reproduced before the fix.

Normalization now checks each complete observed edge against the work area,
preserving the original frame bounds and the single-display requirement. The
available top survives a taskbar overlap at the bottom; obstructed/out-of-area
sides do not. No clipped or synthetic edges are published. Regression coverage
includes a bottom taskbar, a left taskbar, and a release at (310,250) snapping to
the actual Explorer top y=246 and staying attached for subsequent ticks.

The full test suite and Electron build were refreshed. A subsequent native
helper/normalizer smoke returned a normalized top; that snapshot contained a
different fullscreen window, so it is not a manual Explorer landing check.
An already running Wisp process must be restarted to load the rebuilt code.

## Landing after release above a window

The release-only snap previously required the root to be within 12 DIP of a top
at pointer-up. Ordinary airborne physics checked the screen floor but never
window tops, so releases 20 or 80 DIP above a valid window fell through it. Both
cases were reproduced as failing regression tests before implementation.

`ReleasedWindowLanding` captures valid observed tops at user release and tests
downward swept root segments during that fall. The first crossed top supplies
the contact coordinate; an end-of-step position outside the window does not
hide a crossing. Upward crossings and paths beside the window do not attach.
Candidates lost, invalidated, moved or resized during flight are removed for
that release; recovery cannot reintroduce them. Attachment, floor landing, a
new drag or shutdown clears this release's candidates. A support-lost fall
does not arm a new landing selection.

Integration coverage includes actual MainAutonomyComposition event handlers,
MotionEngine, SurfaceKinematics and Main autonomy: release above the
window → fall → one landing → one attachment → ordinary autonomy. Observer input is
injected; this is not a claim of manual native verification. The user runs
`npm run dev`; restart its Main process to load the updated source.

## Visible top with an off-desktop window body

AUTO-V01 extends display ownership from full-frame containment to intersection
with exactly one physical display. This permits a complete visible top when the
bottom of Explorer/Discord extends below the desktop. Frames intersecting two
actual displays remain excluded before DIP conversion. Each published edge
still fits the work area in full; geometry is never clipped, and hidden tops
are not reintroduced. A partially offscreen top and y=0 above the root inset
remain unavailable as supports.

Regressions use the observed Explorer frame (207,425,1561,756) and Discord frame
(486,512,1282,721). Both previously produced no normalized surfaces and now pass
normalization → real Motion/Surface engines → Main autonomy with one landing and
stable attachment. Lower-monitor spanning and entirely offscreen frames remain
negative cases.

The opt-in `tests/infrastructure/native-window-landing.smoke.test.ts` creates an
isolated empty Electron window, runs the unmodified system PowerShell helper
without policy bypass, consumes live observations through WindowsWindowSurfaces,
and executes release, falling contact and attachment with the real motion
orchestrator. This native test passed on the single 1920×1080 / 96 DPI display.
It verifies the helper and movement together; it does not simulate a Renderer
pointer gesture on the user's Explorer/Discord windows. UI access to those
windows was blocked by automatic review, so that manual claim is not made.

Run this separate gate with `WISP_NATIVE_SMOKE=1` and
`npm test -- tests/infrastructure/native-window-landing.smoke.test.ts`.
Normal unit runs skip it; no windows open during the standard test suite.

Final verification: `npm run typecheck`, `npm test` (545 passed, 2 skipped),
`npm run build`, `git diff --check`: passed. The explicit native smoke also
passed separately. Standard-suite skips are the non-Windows factory case and
the opt-in native smoke. The existing Vite dev session restarted its Electron
Main process after the normalization source changed, so it loaded this fix.

## Remaining native gate

The review environment reports Windows 10.0.26200 / PowerShell 5.1, one
1920×1080 display at 96 DPI. The subsequent reviewer report confirms native window
discovery and identifies routing as the remaining blocker. The new route is
verified by deterministic integration tests; interactive browser/terminal
attach/follow, support_lost, Explore and Rest require a fresh native check.
Mixed-DPI and multi-monitor checks remain NOT RUN; no such configuration was
available. Issue #43 is not complete. Next gate: reviewer.

## Common behavior on horizontal supports

User correction: window tops use the same behavior and pose selection as the floor.
Removed window_perch, idle-to-sit_edge substitution, seated sleep, and window
selection bonuses. Attaching preserves an active autonomous route; manual landing
resumes the common scheduler. Ordinary wandering uses the support height and extent.
Regression checks cover scheduler recovery, sleep parity, walking on a narrow
window, common Explore pose weights, attachment and support loss.
Latest verification: typecheck and full suite passed (547 tests, 2 skipped).
Native interactive behavior and mixed-DPI/multiple displays were not rechecked.

## Architect contract implementation: layout and wander ownership

The shared presentation layout now supplies Main window dimensions and pivot,
Renderer character origin/size, and canonical viewport/root. Projection is pure
shared code; the native position adapter only translates, rounds and commits.
Per-frame pivots align to the canonical root; source canvas size remains local
to each render layer. Menu expansion keeps the same character origin.

AutonomyCoordinator passes actual screen/support data to Domain planWanderTarget.
Domain intersects the support with screen collision bounds, rejects invalid or
empty geometry, and preserves the two-value PRNG policy. Explicit route targets
bypass random planning. Earlier reduced autonomy cadence remains 5–11 seconds.

Verification: typecheck, full suite (562 passed, 2 skipped), build passed.
Native interactive and mixed-DPI/multi-monitor checks were not repeated.
Next gate: reviewer for runtime implementation; this does not close all #43 DoD.
