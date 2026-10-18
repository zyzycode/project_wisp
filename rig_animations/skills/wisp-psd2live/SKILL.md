---
name: wisp-psd2live
description: Prepare and edit the Wisp chibi character in user-reviewed stages with pinned PSD2Live 3.5.1 and local MCP. Use for layer plans, masks, Layout manifests, parameter rigs, motions and export checks in rig_animations. Does not integrate a runtime into Wisp or authorize replacement artwork.
---

# Wisp rig authoring — PSD2Live 3.5.1

Work in `/home/zybz/code/project_wisp/rig_animations`. Read its README for the
current verified state and outstanding visual work. The source is
`character_reference.png`; never overwrite it. Keep experiments in `work/`.

## User-controlled stages (current working mode)

The user explicitly replaced the one-prompt full build with review at every
stage. Read the current stage and acceptance record in the workspace README.
Preserve `work/full-rig-v1/` as the prototype; do not run its end-to-end rebuild
commands to implement a new stage.

0. Obtain the user's acceptance of a target image showing the character at the
   end of the intended movement; for a loop returning to its start, use its
   expressive interior pose. Follow "Target image before rigging" below.
1. Propose the part/joint/overlap map for one anatomical area from that target.
2. After map acceptance, prepare that area's layers and neutral reconstruction.
3. After layer acceptance, match the target's static shape with one controller,
   then show the transition, including intermediate and extreme positions.
4. After controller acceptance, check combinations of accepted controls.
5. After combined-pose acceptance, author one motion clip at a time.
6. After clip acceptance, export and compare in the intended player.

At each boundary deliver the actual review artifact, its revision, changes,
known defects and the precise decision needed, then wait for the user's explicit
acceptance. Technical checks, praise for a demo, silence, or permission to start
the workflow do not accept later stages. Corrections stay within the current
stage; keep prior versions. Record accepted scope/revision only after the user
accepts it. Proceed after acceptance of the current stage or explicit scope expansion.

Target-image editing and texture reconstruction are also reviewable. Before
generating/editing a target image or reconstructing hidden artwork, show the
intended change region/mask, method, local/cloud execution, and any download,
upload or cost. Obtain the user's
approval of that concrete plan before running it. Show the resulting alternatives
and an outside-mask comparison. Record whether acceptance concerns a pose reference
or a layer addition; one does not accept the other. Acceptance of a layer map alone
does not approve hidden-surface generation.
Do not implicitly install neural models or upload source art. GPU rendering,
CPU masks and neural inference are distinct; report only observed usage.

For the arm revision, keep shirt body, sleeve, upper arm, forearm, hand and
bracelets distinct in the plan. Elbow movement must not drag the whole shirt;
shoulder movement may deform the sleeve locally. Boundaries are proposals until
reviewed, not extraction masks or approved anatomy.

## Target image before rigging

Use an existing suitable image if provided or already accepted. Otherwise propose
editing a copy of `character_reference.png` into the desired end pose, preserving
identity, proportions, style, shirt print and asymmetric details. The rigger
produces the candidates within the agreed generation scope; the user selects one.
Keep its revision and path with the movement's acceptance record. This is an image
of the intended result, not merely an angle diagram or a render of a rejected rig.

Start and end images suffice for a simple movement. Add an intermediate reference
only when the trajectory, joint shape or overlap change needs clarification. A
loop with identical endpoints needs an expressive interior pose instead. Reuse an
accepted target when its area and range still match; do not generate every frame.

Infer the joints, front/back overlaps and missing surfaces from the accepted target
and the transition. A target is neither an extraction mask nor a replacement layer;
transferring generated pixels into the rig requires acceptance of that addition.
Match the static target before polishing timing. Compare silhouette, joint volume,
seams, cuff edges and folds, then inspect intermediate poses for tears and stretching
at source and display sizes. Valid triangles and neutral pixel equality are not a
visual quality gate. If the target exceeds the drawing or rig's capabilities, show
the limitation and agree on a correction instead of silently changing the target.

## Environment

- `python3 scripts/bootstrap.py` installs the portable Linux editor and official
  Python client using `tools.lock.json` and SHA-256 verification.
- `python3 scripts/editor.py` starts the GUI on the existing X11 desktop.
  GUI/GPU and loopback access may require running outside the Codex sandbox.
- `python3 scripts/mcp.py operations` verifies authenticated MCP discovery.
  The wrapper reads the token from the isolated Java preferences; never print,
  commit, or copy the token into documentation or chat.
- `python3 scripts/mcp.py call workspace_inspect '{"scope":"project"}'`
  reads the actual project and state. Do not overwrite an unsaved user project.
- With no arguments, `scripts/mcp.py` is the upstream stdio MCP bridge. The
  commands above already use MCP over HTTP; host tool registration is optional.
- Programmatic access: put `scripts/` on Python's module path, then
  `from mcp import client`; use `with client() as editor:`.

## Discover the installed contract

Do not copy old Live2D agent-kit scripts into this version. Compact profile
publishes family tools; the official client routes operations and waits for jobs.

1. `workspace_list_operations` with a focused `query` and pagination discovers
   operation IDs. `workspace_get_operation` with `id` returns the complete schema.
   Read `request_schema`; inspect/list pagination has a maximum `limit` of 64.
2. Read schemas before constructing requests. Use `workspace_inspect` for actual
   layer/mesh/deformer IDs and `state`; never guess those IDs.
3. `editor.edit(operation, **request)` supplies a fresh state. It does not grant
   permission to discard work. Save before switching projects.
4. A `state_conflict` requires re-inspection and reconciliation. A failed job is
   a failure even if the enclosing query succeeded. The official client checks
   terminal status; don't treat a queued export as a completed file.
5. Render after each meaningful geometry change. Keep intermediate projects and
   compare neutral, extreme, and combined poses before adding complexity.

## Source-preserving preparation

The existing `python3 scripts/prepare_mask_test.py` demonstrates binary masks
on the original irises and verifies exact neutral reconstruction. These are
visible-only trial contours, not a production eye rig.

- Prefer pixel masks and small contour corrections. SAM 2 is optional and is
  not installed by this workflow; GPU availability alone does not prove model
  inference works. Do not install/download neural models implicitly.
- Distinguish visible extraction from reconstruction of hidden regions. A mask
  cannot invent the sclera behind an iris, skin behind bangs, or joint overlaps.
- Matte cleanup and complete sclera/eyelid masks are necessary before gaze/blink.
  Inspect the face at both source resolution and the intended screen size.
- Keep the asymmetric blue/white hair, clips, bracelets, golden irises, shirt
  print and original proportions. Left/right tags mean the character's side.
- Compare composited neutral pixels and alpha before rigging; review mask edges
  visually. A zero neutral difference does not prove moving parts are correct.
- Don't generate the animation frame by frame; the accepted target-image stage
  supplies a reference, not a rendered clip. Don't claim that translating a flat
  cutout is a finished facial/walking animation or use whole-eye squash for a blink.

## Import and author

Use the versioned [Layout specification](https://github.com/tsunehimatoi/psd2live/blob/v3.5.1/docs/en/spec/LAYOUT_MANIFEST.md).
Manifest: `format=psd2live-layout`, `version=1`, integer canvas size, PNG layers
with relative paths, exact image sizes, canvas rectangles and tags. Layers run
back to front. `reference:true` layers never enter the rig/export.

`project_import_layout` opens an ungenerated workspace. Inspect composition,
configure generation, then `rig_generate`. Use real discovered IDs for geometry
and keys. `author_axis` can compile a custom parameter and deformation; inspect
its schema and optionally `author_compile` before committing. `rig_deform`
uses normalized bounds, while layout rectangles use canvas pixels. Never mix
these coordinate spaces. Prefer facial controls before body/feet unless the user
has selected a different area.

For limbs, inspect the native `skeleton_*` contract before inventing per-vertex
rotation recipes. PSD2Live supports bone proposals, bindings and FK/IK posing;
use discovered schemas and actual IDs. Bones position the limb; weights, local
deformers and corrective keyforms must still reproduce the target's shape. A single
mesh can span a joint with suitable topology and weights; do not assume every bone
requires its own PNG. Sleeve front/back overlaps and hidden skin remain artwork
tasks. Neural segmentation provides masks; generated layer decompositions provide
candidates, not accepted anatomy or a finished rig. Neither installs nor full-frame
video generation are implied by choosing this workflow.

## Acceptance and limits

Run `python3 scripts/smoke_test.py` only against the isolated test workspace;
read its refusal if another project has unsaved changes. Require all of:

1. MCP discovery and real project mutation succeed.
2. A saved `.psd2live` reopens with the same model structure and authored keys.
3. Neutral/changed pose renders agree before and after reopening.
4. Export files and their referenced textures exist; read warnings/loss reports.
5. An exported model is reopened/loaded where supported. Label internal export
   validation separately from verification in official Cubism or Wisp runtime.

Version-specific export pitfall: `meshOnly=true` omits motion3 even with
`exportMotions=true`. Keep `meshOnly=false` when exporting authored motions;
disable unwanted generators individually. The smoke test checks the referenced
motion3 and calls the bundled Cubism Core's `csmHasMocConsistency` on the actual
exported MOC3. This is a consistency check, not external runtime visual QA.

Never equate `.psd2live.json` diagnostic output with an editable project, or a
single exported PNG with a model. Record unsupported export/runtime checks
honestly. Keep credentials, binaries, caches and generated projects ignored.
No frontend/backend imports, dependencies or runtime integration in this scope.

Reference: [3.5.1 MCP contract](https://github.com/tsunehimatoi/psd2live/blob/v3.5.1/docs/en/agent/MCP_AUTHORING.md).
