# AUTO-I06 verification

Prerequisites #34, #35, #36, #38 and #41 were verified CLOSED with final Done receipts;
AUTO-I05 has Approved at commit `de23966`. Brain owns selection, route and phase deadlines;
AUTO-A08 has no Body/Skin completion handshake. No dependency, IPC protocol or OS observer
change is introduced. The existing single opportunity cadence retains state/user-inactivity
adaptation; Explore/Rest reuse bounded target/route/action history.

Automated integration runs ActivityRunner against the real Motion/Surface engines for
external scoring → jump → attachment → inspection or nap. It covers moving attached
support, disappearing airborne goals, route cancellation and no reattachment; Main tests
cover nap wake, stable critical sleep, energy recovery and existing click/drag/menu/disable/
shutdown cancellation. Domain tests cover window priority, narrow seated sleep, floor
fallback, route obstruction and repetition penalties.

Linux desktop Electron smoke: passed, primary work area 1920×1035, native position commits,
walk → prepare → settle → sleep → wake. Existing first-frame snapshots of lie_down,
sleep_loop and wake_up were visually inspected. This is a bounded desktop harness;
it does not substitute for Windows observer or full animated Skin playback verification.

Windows browser/terminal smoke: **NOT RUN** (Linux host). Before approval, verify autonomous
Explore and Rest selection on unobstructed windows, small movement during rest, resize,
minimize/close while routing/sleeping, mixed DPI and multi-monitor loss. An airborne moving
target intentionally cancels to fall; a small move after attachment follows locally.
Repeat with external observation unavailable to confirm screen-only Explore and Rest.

Missing artwork and temporary sit/settle/seated-sleep treatment are recorded in
[SPRITE_REQUESTS.md](../art/SPRITE_REQUESTS.md). Existing sit, lie, sleep and wake clips remain
registered; no nonexistent paths or newly generated PNGs were added to the manifest.
