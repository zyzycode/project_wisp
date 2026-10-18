// Verify independent, rigid horizontal irises in the actual exported PSD2Live WASM rig.
// Optional argument: path to another revision, e.g. rig_animations/work/gaze-01/r02.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const directory = process.argv[2]
  ? path.resolve(process.argv[2])
  : fileURLToPath(new URL('../work/gaze-01/r03/', import.meta.url));
const file = name => path.join(directory, name);
const tolerance = 1e-3;
const objects = JSON.parse(fs.readFileSync(file('objects.json'), 'utf8')).items;
const movingLayers = ['iris_left', 'iris_right'];
const movingIds = movingLayers.map(layer => {
  const matches = objects.filter(item => item.layerId === layer && item.target?.startsWith('mesh:'));
  assert.equal(matches.length, 1, `Expected one independent moving mesh for ${layer}`);
  return matches[0].target.slice(5);
});
assert.notEqual(movingIds[0], movingIds[1], 'Each iris must have its own mesh');

const { instance } = await WebAssembly.instantiate(fs.readFileSync(file('web/p2l_runtime.wasm')), {});
const runtime = instance.exports;
const bytes = fs.readFileSync(file('web/layout.p2lrt'));
const input = runtime.p2l_alloc(bytes.length);
const error = runtime.p2l_alloc(512);
new Uint8Array(runtime.memory.buffer, input, bytes.length).set(bytes);
function string(pointer) {
  const data = new Uint8Array(runtime.memory.buffer, pointer);
  const end = data.indexOf(0);
  assert(end >= 0, 'Runtime string must be terminated');
  return new TextDecoder().decode(data.subarray(0, end));
}
const rig = runtime.p2l_rig_load(input, bytes.length, error, 512);
assert(rig, string(error));
runtime.p2l_behaviors(rig, 0);
const parameters = Array.from({ length: runtime.p2l_parameter_count(rig) }, (_, i) => string(runtime.p2l_parameter_id(rig, i)));
const parameter = parameters.indexOf('ParamGazeX');
assert(parameter >= 0, 'Export must include ParamGazeX');
const meshes = Array.from({ length: runtime.p2l_mesh_count(rig) }, (_, i) => string(runtime.p2l_mesh_id(rig, i)));
for (const id of movingIds) assert(meshes.includes(id), `Export is missing iris mesh ${id}`);
assert(meshes.length > 2, 'Export must also contain the stationary character');
const scratch = runtime.p2l_alloc(4);
function vertices(index) {
  const count = runtime.p2l_mesh_vertex_count(rig, index);
  assert(count >= 3, `Mesh ${meshes[index]} must have at least three vertices`);
  const points = Array.from(new Float32Array(runtime.memory.buffer, runtime.p2l_mesh_vertices(rig, index), count * 2));
  assert(points.every(Number.isFinite), `Nonfinite mesh vertices: ${meshes[index]}`);
  return points;
}
function area(points, a, b, c) {
  return (points[b * 2] - points[a * 2]) * (points[c * 2 + 1] - points[a * 2 + 1])
    - (points[b * 2 + 1] - points[a * 2 + 1]) * (points[c * 2] - points[a * 2]);
}
runtime.p2l_set_parameter(rig, parameter, 0);
runtime.p2l_update(rig, 0);
const baseline = meshes.map((_, i) => vertices(i));
const topology = meshes.map((mesh, index) => {
  const pointer = runtime.p2l_mesh_indices(rig, index, scratch);
  const count = new Uint32Array(runtime.memory.buffer, scratch, 1)[0];
  assert(count > 0 && count % 3 === 0, `Invalid triangle count: ${mesh}`);
  const indices = Array.from(new Uint32Array(runtime.memory.buffer, pointer, count));
  assert(indices.every(i => i < baseline[index].length / 2), `Invalid triangle indices: ${mesh}`);
  return indices;
});
const irisReports = Object.fromEntries(movingIds.map((id, i) => [id, {
  layer: movingLayers[i], maximum_translation_variation: 0,
  maximum_vertical_displacement: 0, maximum_pairwise_distance_change: 0, extremes: {},
}]));
let flips = 0;
let staticDelta = 0;
for (let pose = -10; pose <= 10; pose++) {
  runtime.p2l_set_parameter(rig, parameter, pose / 10);
  runtime.p2l_update(rig, 0);
  meshes.forEach((mesh, index) => {
    const points = vertices(index);
    const neutral = baseline[index];
    assert.equal(points.length, neutral.length, `Vertex count changed: ${mesh}`);
    const iris = irisReports[mesh];
    if (iris) {
      const dx = points[0] - neutral[0];
      for (let i = 0; i < points.length; i += 2) {
        const variation = Math.abs(points[i] - neutral[i] - dx);
        const vertical = Math.abs(points[i + 1] - neutral[i + 1]);
        iris.maximum_translation_variation = Math.max(iris.maximum_translation_variation, variation);
        iris.maximum_vertical_displacement = Math.max(iris.maximum_vertical_displacement, vertical);
        assert(variation <= tolerance, `${iris.layer} deforms horizontally at pose ${pose / 10}`);
        assert(vertical <= tolerance, `${iris.layer} moves vertically at pose ${pose / 10}`);
        for (let j = i + 2; j < points.length; j += 2) {
          const before = Math.hypot(neutral[j] - neutral[i], neutral[j + 1] - neutral[i + 1]);
          const after = Math.hypot(points[j] - points[i], points[j + 1] - points[i + 1]);
          const difference = Math.abs(after - before);
          iris.maximum_pairwise_distance_change = Math.max(iris.maximum_pairwise_distance_change, difference);
          assert(difference <= tolerance, `${iris.layer} changes size at pose ${pose / 10}`);
        }
      }
      if (Math.abs(pose) === 10) {
        assert(Math.abs(dx) >= 6 && Math.abs(dx) <= 10, `${iris.layer} extreme displacement must be 6–10 px; got ${dx}`);
        assert(Math.sign(dx) === Math.sign(pose), `${iris.layer} moves in the wrong direction`);
        iris.extremes[String(pose / 10)] = dx;
      }
    } else {
      points.forEach((value, i) => { staticDelta = Math.max(staticDelta, Math.abs(value - neutral[i])); });
    }
    const indices = topology[index];
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3);
      if (area(points, a, b, c) * area(neutral, a, b, c) < 0) flips++;
    }
  });
}
assert.equal(staticDelta, 0, 'All meshes other than the two irises must remain stationary');
assert.equal(flips, 0, 'No triangle may flip from neutral');
const report = {
  runtime_load: true, poses_checked: 21, independent_iris_layers: movingLayers,
  rigid_horizontal_translation: true, pairwise_size_preserved: true,
  tolerance_px: tolerance, new_triangle_flips: flips,
  static_mesh_count: meshes.length - movingIds.length,
  static_context_max_vertex_displacement: staticDelta,
  irises: Object.values(irisReports),
};
fs.writeFileSync(file('runtime-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
