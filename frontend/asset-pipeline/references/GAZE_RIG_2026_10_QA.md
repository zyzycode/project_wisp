# Gaze rig audit — 2026-10-06

## Existing assets

Inspected the manifest, standards, asset readiness table and actual PNGs.

- `pupils_normal`: four RGBA 512×512 PNGs in `public/assets/sprites/faces/pupils/`;
  alpha bounds `(199,152)-(314,209)`. These are full colored irises with highlights,
  without eye whites, lashes, mouth or eyebrows. They are substantially larger
  than the irises inside `face_gaze`; direct superposition would produce duplicate eyes.
- `face_gaze`: four full faces, directions left/right/up/down, explicit pivot `(256,180)`.
  The eyes include their own irises. These images are suitable for discrete gaze;
  moving the entire face would also move lashes, eyebrows, mouth and nose.
- `body_idle`: faceless body, allows `face_gaze`, face anchor `(256,180)`.
- No registered `face_blink` or matching pupil-free face base exists in the input manifest.
- `body_walk_03.png` already ends in a stable side-facing stance. Walk faces left;
  `body_run_00.png` and `body_run_03.png` face right. Shared velocity-only mirroring
  therefore needs to account for each clip's native facing.
- `body_run_03.png` remains a running pose, not a braking/standing pose.
  No dedicated walk/run start/stop keys are registered.
- `body_land_03.png` is a neutral frontal standing pose with a baked-in face.
- `body_climb_wall`, walk/run and existing gestures use baked-in faces;
  the new frontal gaze pair must not be attached to those bodies.

## Accepted minimal asset pair

| Key | Content | Canvas / pivot | Playback |
|---|---|---|---|
| `face_gaze_base` | Stationary whites, lashes, brows, nose, mouth; no irises | 512×512 / (256,180) | Four identical static frames |
| `pupils_gaze` | Matching irises only | 512×512 / (256,180) | Four identical static frames; continuous runtime translation |

Accepted offset envelope is **±2 source pixels horizontally and ±1 vertically**.
The initial ±3/±2 envelope touched the lower eyelid and was rejected.
Matching body/face anchors
remain mandatory. This pair does not replace emotional face overrides.

## Generation provenance and current status

The user explicitly permitted this separate agent to create graphics for this task.
Built-in ImageGen was used; no external API/CLI or paid provider integration was installed.

- Edit reference: `public/assets/sprites/faces/gaze/face_gaze_00.png`.
- Saved source: `asset-pipeline/generated_images/face_gaze_base_v1.png`.
- Actual result: RGBA 1254×1254, despite the requested 512×512.
- Visible bounds at alpha >16: `(484,365)-(772,514)`; lower-opacity stray pixels exist outside.
- The user directed technical processing through the existing pipeline. The existing
  `normalize_reviewed.py` functions `place` and `compose` were reused without changing
  them. Their function bodies were loaded with Python AST because importing the whole
  module requires unavailable SciPy; no dependency was installed.
- Generated alpha below 15 was cleared, matching the existing processor threshold.
  Base normalization: scale `512/1254`, origin/destination `(0,0)`.
  Original `face_gaze_00` nose/mouth rectangle `(247,194)-(267,214)` was retained.
- Pupil source: `pupils_normal_00`, left crop `(199,152)-(250,209)`, right crop
  `(262,152)-(314,209)`. Each iris was uniformly scaled by `0.36`, centered at
  `(223,185)` and `(286,185)`. No original working asset was changed.
- Eight new working PNGs are registered: four identical static frames for each key.
  Paths: `public/assets/sprites/faces/gaze_base/face_gaze_base_00.png` through `_03`,
  and `public/assets/sprites/faces/pupils_gaze/pupils_gaze_00.png` through `_03`.
- Base bounds `(195,147)-(318,209)`; pupil bounds `(214,175)-(296,196)`.

Prompt used:

> Precise sprite edit. Edit target is provided 512x512 transparent Wisp face sprite.
> Create a matching stationary neutral eye-base asset for a separable pupil rig.
> Change ONLY the colored irises and black pupils inside both eyes: remove them
> and fill their old area with the same white sclera. Keep both eye outlines,
> upper lashes, eyebrows, tiny nose and mouth EXACTLY in their present shape,
> position, size and palette. Keep all exterior pixels transparent. Preserve the
> original canvas size 512x512 and placement near x200..313,y150..211. No iris or
> pupil, no sparkle inside eyes, no body, no text. This is one still face-base layer,
> both blank white eyes visible. Do not enlarge or recenter the face.

## Verification

Inspected 72 composites: center/eight extremes × four idle frames × light/dark backgrounds.
No pupil crossing of the eyelid was observed at the accepted envelope. Previews:
`output/gaze_rig/all_idle_light.png`, `all_idle_dark.png`, `extremes_zoom_dark.png`.
All new PNGs are RGBA 512×512 with true transparency. Manifest check: 208 files,
50 animations, zero errors/warnings. Manifest loader/resolver: 78 tests passed.

SHA-256 (frames within each static set are identical):

- Source base: `914ab8f45731099d0c4c29b891bba4ff9233689ca88131844b496836d7a81bec`.
- Exported base: `2d6a1a8129aa225056d89d04312f4616db88fba89d6b0cfaedaa4cb1d9defa3c`.
- Exported pupils: `d848e25b3b18b622dffeb3628ae22ba9535c290cd5fd781f0cc4f7c2ca76daac`.

## Remaining optional art

Neutral blink is a separate missing four-frame open/half/closed/open sequence.
It is optional after the matching gaze pair. New locomotion graphics are not required
to use the existing walk terminal stance; a dedicated run braking pose remains missing.
