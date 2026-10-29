import { Tensor } from 'onnxruntime-node';
export const integer = (data: readonly number[], dims: readonly number[]) => new Tensor('int64', BigInt64Array.from(data, BigInt), dims);
export const floating = (data: Float32Array, dims: readonly number[]) => new Tensor('float32', data, dims);
export function floats(tensor: Tensor | undefined): Float32Array {
  if (!tensor || !(tensor.data instanceof Float32Array)) throw new Error('Invalid model output');
  return tensor.data;
}
export function concat(parts: readonly Float32Array[]): Float32Array {
  const output = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
export function add(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length !== b.length) throw new Error('Invalid embedding shape');
  return a.map((value, i) => value + b[i]!);
}
/** Bounded top-k sampling; no large vocabulary sorting or unbounded retries. */
export function sample(logits: Float32Array, previous: ReadonlySet<number> = new Set(), eos?: number): number {
  const top: { id: number; score: number }[] = [];
  for (let id = 0; id < logits.length; id++) {
    if (eos !== undefined && id >= logits.length - 1024 && id !== eos) continue;
    let score = logits[id]!;
    if (!Number.isFinite(score)) continue;
    if (previous.has(id)) score = score < 0 ? score * 1.05 : score / 1.05;
    if (top.length === 50 && score <= top[49]!.score) continue;
    let position = 0;
    while (position < top.length && top[position]!.score >= score) position++;
    top.splice(position, 0, { id, score }); if (top.length > 50) top.pop();
  }
  if (!top.length) throw new Error('Invalid model logits');
  const weights = top.map(item => Math.exp((item.score - top[0]!.score) / 0.9));
  let draw = Math.random() * weights.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < top.length; i++) { draw -= weights[i]!; if (draw <= 0) return top[i]!.id; }
  return top[top.length - 1]!.id;
}
