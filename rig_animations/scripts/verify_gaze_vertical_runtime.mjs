// Verify independent, rigid two-axis iris translations in the exported PSD2Live WASM rig.
// Optional argument: another revision directory. Positive ParamGazeY means downward motion.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const directory = process.argv[2]
  ? path.resolve(process.argv[2])
  : fileURLToPath(new URL('../work/gaze-01/r04/', import.meta.url));
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
const parameterX = parameters.indexOf('ParamGazeX');
const parameterY = parameters.indexOf('ParamGazeY');
assert(parameterX >= 0, 'Export must include ParamGazeX');
assert(parameterY >= 0, 'Export must include ParamGazeY');
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
runtime.p2l_set_parameter(rig, parameterX, 0);
runtime.p2l_set_parameter(rig, parameterY, 0);
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
  maximum_pairwise_distance_change: 0, maximum_additivity_error: 0, endpoints: {},
}]));
let flips = 0;
let staticDelta = 0;
const translations = new Map();
for (let gridY = -5; gridY <= 5; gridY++) {
  for (let gridX = -5; gridX <= 5; gridX++) {
    const x = gridX / 5;
    const y = gridY / 5;
    runtime.p2l_set_parameter(rig, parameterX, x);
    runtime.p2l_set_parameter(rig, parameterY, y);
    runtime.p2l_update(rig, 0);
    const pose = `${x},${y}`;
    const poseTranslations = {};
    meshes.forEach((mesh, index) => {
      const points = vertices(index);
      const neutral = baseline[index];
      assert.equal(points.length, neutral.length, `Vertex count changed: ${mesh}`);
      const iris = irisReports[mesh];
      if (iris) {
        const dx = points[0] - neutral[0];
        const dy = points[1] - neutral[1];
        poseTranslations[mesh] = [dx, dy];
        for (let i = 0; i < points.length; i += 2) {
          const variation = Math.max(Math.abs(points[i] - neutral[i] - dx),
            Math.abs(points[i + 1] - neutral[i + 1] - dy));
          iris.maximum_translation_variation = Math.max(iris.maximum_translation_variation, variation);
          assert(variation <= tolerance, `${iris.layer} deforms at pose ${pose}`);
          for (let j = i + 2; j < points.length; j += 2) {
            const before = Math.hypot(neutral[j] - neutral[i], neutral[j + 1] - neutral[i + 1]);
            const after = Math.hypot(points[j] - points[i], points[j + 1] - points[i + 1]);
            const difference = Math.abs(after - before);
            iris.maximum_pairwise_distance_change = Math.max(iris.maximum_pairwise_distance_change, difference);
            assert(difference <= tolerance, `${iris.layer} changes size at pose ${pose}`);
          }
        }
        if (y === 0) assert(Math.abs(dy) <= tolerance, `${iris.layer}: X alone moves vertically`);
        if (x === 0) assert(Math.abs(dx) <= tolerance, `${iris.layer}: Y alone moves horizontally`);
        if (Math.abs(x) === 1 && y === 0) {
          assert(Math.abs(dx) >= 7 && Math.abs(dx) <= 8, `${iris.layer}: X range must preserve ~7.4px, got ${dx}`);
          assert(Math.sign(dx) === Math.sign(x), `${iris.layer}: incorrect X direction`);
          iris.endpoints[`x=${x}`] = [dx, dy];
        }
        if (Math.abs(y) === 1 && x === 0) {
          assert(Math.abs(dy) >= 4 && Math.abs(dy) <= 6, `${iris.layer}: Y range must be 4–6px, got ${dy}`);
          assert(Math.sign(dy) === Math.sign(y), `${iris.layer}: positive Y must move downward`);
          iris.endpoints[`y=${y}`] = [dx, dy];
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
    translations.set(pose, poseTranslations);
  }
}
for (const x of [-1, 0, 1]) {
  for (const y of [-1, 0, 1]) {
    for (const id of movingIds) {
      const combined = translations.get(`${x},${y}`)[id];
      const horizontal = translations.get(`${x},0`)[id];
      const vertical = translations.get(`0,${y}`)[id];
      for (let axis = 0; axis < 2; axis++) {
        const difference = Math.abs(combined[axis] - horizontal[axis] - vertical[axis]);
        irisReports[id].maximum_additivity_error = Math.max(irisReports[id].maximum_additivity_error, difference);
        assert(difference <= tolerance, `${irisReports[id].layer}: axes are not additive at ${x},${y}`);
      }
    }
  }
}
assert.equal(staticDelta, 0, 'All meshes other than the two irises must remain stationary');
assert.equal(flips, 0, 'No triangle may flip from neutral');
const report = {
  runtime_load: true, poses_checked: 121, grid: '11x11', endpoint_combinations_checked: 9,
  independent_iris_layers: movingLayers, rigid_two_axis_translation: true,
  positive_y_direction: 'down', pairwise_size_preserved: true, independent_additive_axes: true,
  tolerance_px: tolerance, new_triangle_flips: flips,
  static_mesh_count: meshes.length - movingIds.length,
  static_context_max_vertex_displacement: staticDelta,
  irises: Object.values(irisReports),
};
fs.writeFileSync(file('runtime-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
