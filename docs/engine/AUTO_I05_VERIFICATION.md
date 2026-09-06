# AUTO-I05: external-window support implementation

Contract: `PERCEPTION_ENGINE.md` §10 and `MOTION_ENGINE.md` §7.1; prerequisite AUTO-I04
was closed by the manager before implementation. AUTO-I06 target selection is excluded.

Main owns the external observation port and disposes it with the motion loop. On Windows,
the platform factory writes the bundled fixed PowerShell/C# source to an app temp directory
and starts system Windows PowerShell without a shell or execution-policy bypass. Startup
compilation remains unavailable; subsequent observations allow one request in flight at
10 Hz, with a 250 ms deadline and 300 ms request-start freshness limit. Restricted
PowerShell environments fail closed. No dependency or native binary is shipped.

The helper filters top-level windows, tracks lifetime tokens using native events, and
removes any edge intersected by a higher window. Unsupported visible windows still occlude.
Unknown geometry invalidates the full observation. Native handles, process IDs and class
names remain inside the adapter. Only opaque IDs and normalized geometry reach Application.
A frame must intersect exactly one display; each published edge must fit that display's
work area after Electron DIP conversion. A body extending below the desktop or under a taskbar does not remove
an otherwise valid top. Bounds are never clipped. Display topology changes restart the
helper and invalidate attachment IDs.

A gentle user drag release within 12 DIP of a valid top attaches the root. The bounded
Activity performs land, an optional short support-local walk away from the corner, then
sit_edge. Window movement follows the saved local distance once; resizing never scales
or clamps it. Missing/occluded/stale/invalid support wakes semantic sleep and falls from
the last accepted position with locomotion velocity. Recovery never reattaches. Drag wins
over concurrent support loss. Side surfaces are observed and supported by kinematics;
autonomous side/top selection remains AUTO-I06.

## Artwork

Missing: `body_sit_edge`, supplied by the human artist under `public/assets/sprites/`.
Expected four-frame loop: neutral → left leg → neutral → right leg, stable root and face
anchor, no painted ledge. Until supplied, `sit_edge` resolves to existing `body_sit`, then
the established idle/system fallback. This task creates no artwork or manifest entries
pointing at nonexistent files.

## Verification and remaining native gate

Automated coverage includes protocol rejection/private-field filtering, negative-coordinate
DIP conversion at 100/150/200%, spanning/work-area exclusion, helper timeout/cadence/restart,
stale cache, topology invalidation, Linux unsupported fallback, top/side local following,
resize loss, drag priority, single fall/no reattachment, Main land/walk/perch and sleep wake,
and the actual manifest's sit fallback/pivot.

**Windows native smoke: NOT RUN** — implementation environment is Linux, without a Windows
runtime. Automated injected geometry does not verify Win32 enumeration or PowerShell/C#
compilation. Before approval, run the following on Windows:

1. Launch with browser and terminal windows; gently release on each unobstructed top edge.
   Confirm land → optional walk → sit fallback and normal face placement.
2. Move and resize each attached window, including shrinking past the local root distance;
   verify following once, then fall/land on invalid support without teleport or auto-reattach.
3. Minimize, close, cover the occupied edge, and repeat while sleeping. Verify wake/fall/land;
   restoring/reopening a window must not restore the old attachment.
4. Try own Wisp windows, taskbar, menus, dialogs, tooltips and partially covered edges;
   none may become supports. Check unobstructed side observations without autonomous climbing.
5. Repeat at 100%, 150%, 200% DPI and on a negative-origin secondary monitor. Move across
   displays, span displays, and change topology/scaling: invalid support must fall cleanly.
6. Block/terminate the helper and check safe fallback; quit Wisp and confirm helper exit.
   Record OS, PowerShell version, display layout, observed results and any unavailable states.
