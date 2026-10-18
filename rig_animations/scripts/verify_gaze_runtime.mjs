// Validate the actual exported PSD2Live WASM rig, without a browser or Wisp runtime.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('../work/gaze-01/r02/', import.meta.url));
const { instance } = await WebAssembly.instantiate(fs.readFileSync(directory + 'web/p2l_runtime.wasm'), {});
const runtime = instance.exports;
const bytes = fs.readFileSync(directory + 'web/layout.p2lrt');
const input = runtime.p2l_alloc(bytes.length);
const error = runtime.p2l_alloc(512);
new Uint8Array(runtime.memory.buffer, input, bytes.length).set(bytes);
function string(pointer) {
  const data = new Uint8Array(runtime.memory.buffer, pointer);
  return new TextDecoder().decode(data.subarray(0, data.indexOf(0)));
}
const rig = runtime.p2l_rig_load(input, bytes.length, error, 512);
assert(rig, string(error));
runtime.p2l_behaviors(rig, 0);
const parameters = Array.from({ length: runtime.p2l_parameter_count(rig) }, (_, i) => string(runtime.p2l_parameter_id(rig, i)));
const parameter = parameters.indexOf('ParamGazeX');
assert(parameter >= 0);
const meshes = Array.from({ length: runtime.p2l_mesh_count(rig) }, (_, i) => string(runtime.p2l_mesh_id(rig, i)));
const objects = JSON.parse(fs.readFileSync(directory + 'objects.json')).items;
const staticMesh = objects.find(item => item.layerId === 'character_original').target.slice(5);
assert(meshes.includes(staticMesh), 'Export must include the stationary original mesh');
assert.equal(meshes.length, 3);
const scratch = runtime.p2l_alloc(4);
function vertices(index) {
  return Array.from(new Float32Array(runtime.memory.buffer, runtime.p2l_mesh_vertices(rig, index), runtime.p2l_mesh_vertex_count(rig, index) * 2));
}
function area(points, a, b, c) {
  return (points[b*2]-points[a*2])*(points[c*2+1]-points[a*2+1]) - (points[b*2+1]-points[a*2+1])*(points[c*2]-points[a*2]);
}
runtime.p2l_set_parameter(rig, parameter, 0);
runtime.p2l_update(rig, 0);
const baseline = meshes.map((_, i) => vertices(i));
let flips = 0, staticDelta = 0, maximumDelta = 0;
for (let pose = -10; pose <= 10; pose++) {
  runtime.p2l_set_parameter(rig, parameter, pose / 10);
  runtime.p2l_update(rig, 0);
  meshes.forEach((mesh, index) => {
    const points = vertices(index);
    assert(points.every(Number.isFinite));
    const delta = Math.max(...points.map((p, i) => Math.abs(p-baseline[index][i])));
    if (mesh === staticMesh) staticDelta = Math.max(staticDelta, delta);
    else maximumDelta = Math.max(maximumDelta, delta);
    const pointer = runtime.p2l_mesh_indices(rig, index, scratch);
    const count = new Uint32Array(runtime.memory.buffer, scratch, 1)[0];
    const indices = new Uint32Array(runtime.memory.buffer, pointer, count);
    for (let i = 0; i < count; i += 3) {
      const [a,b,c] = indices.slice(i, i+3);
      if (area(points,a,b,c)*area(baseline[index],a,b,c) < -0.01) flips++;
    }
  });
}
assert.equal(staticDelta, 0);
assert.equal(flips, 0);
assert(maximumDelta > 0 && maximumDelta <= 4.01);
const report = { runtime_load: true, poses_checked: 21, new_triangle_flips: flips,
  static_body_context_max_vertex_displacement: staticDelta, maximum_displacement_from_neutral: maximumDelta };
fs.writeFileSync(directory + 'runtime-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(report);
