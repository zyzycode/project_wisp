---
name: wisp-psd2live
description: Prepare and edit the Wisp chibi character with pinned PSD2Live 3.5.1 through its authenticated local MCP, preserving source pixels. Use for layer masks, Layout manifests, parameter rigs, motions, save/reopen/export checks in rig_animations. Does not integrate a runtime into Wisp or generate replacement artwork.
---

# Wisp rig authoring — PSD2Live 3.5.1

Work in `/home/zybz/code/project_wisp/rig_animations`. Read its README for the
current verified state and outstanding visual work. The source is
`character_reference.png`; never overwrite it. Keep experiments in `work/`.

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

Start with `python3 scripts/prepare_mask_test.py`. It demonstrates binary masks
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
- Don't regenerate whole frames or claim that translating a flat cutout is a
  finished facial/walking animation. Don't use whole-eye squash for a blink.

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
these coordinate spaces. Author facial controls first, then body/feet.

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
