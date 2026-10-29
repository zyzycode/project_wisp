import path from 'node:path';
import { availableParallelism } from 'node:os';
import { InferenceSession, Tensor } from 'onnxruntime-node';
import { createSpeechTokenizer } from './tokenizer';
import { add, concat, floating, floats, integer, sample } from './tensors';

const H = 1024;
const names = ['text_embed', 'codec_embed', 'talker_cache', 'code_predictor', 'residual_embed', 'tok_decoder'] as const;
type Graph = typeof names[number];
/** Internal offline probe controls; never exposed through IPC or application settings. */
export interface SpeechInferenceOptions {
  readonly threads?: 1 | 2 | 4 | 8;
  readonly spinning?: boolean;
  readonly onGraphRun?: (graph: Graph, durationMs: number) => void;
}
/** Port of pinned ONNX reference inference: custom-voice prefill, KV-cache AR, 25-frame decoder. */
export class OnoAnnaInference {
  private constructor(private readonly sessions: Readonly<Record<Graph, InferenceSession>>,
    private readonly tokenizer: Awaited<ReturnType<typeof createSpeechTokenizer>>,
    private readonly onGraphRun?: SpeechInferenceOptions['onGraphRun']) {}
  public static async create(modelRoot: string, tokenizerRoot: string, options: SpeechInferenceOptions = {}): Promise<OnoAnnaInference> {
    const entries: [Graph, InferenceSession][] = [];
    // Measured CPU cap; sleeping idle session pools avoid competing with the active graph.
    const threads = options.threads ?? Math.min(8, availableParallelism());
    const spinning = options.spinning ? '1' : '0';
    try {
      for (const name of names) entries.push([name, await InferenceSession.create(path.join(modelRoot, 'cpu_int4', `${name}.onnx`), { executionProviders: ['cpu'], intraOpNumThreads: threads, interOpNumThreads: 1, logSeverityLevel: 3,
        extra: { session: { intra_op: { allow_spinning: spinning }, inter_op: { allow_spinning: spinning } } } })]);
      return new OnoAnnaInference(Object.fromEntries(entries) as Record<Graph, InferenceSession>, await createSpeechTokenizer(tokenizerRoot), options.onGraphRun);
    } catch (error) { await Promise.all(entries.map(([, session]) => session.release())); throw error; }
  }
  private async run(name: Graph, feed: Record<string, Tensor>): Promise<readonly Tensor[]> {
    const session = this.sessions[name];
    const started = this.onGraphRun ? performance.now() : 0;
    const result = await session.run(feed);
    this.onGraphRun?.(name, performance.now() - started);
    return session.outputNames.map(key => {
      const tensor = result[key]; if (!tensor) throw new Error('Missing model output'); return tensor;
    });
  }
  private async text(ids: readonly number[]): Promise<Float32Array> {
    return floats((await this.run('text_embed', { text_ids: integer(ids, [1, ids.length]) }))[0]);
  }
  private async codec(ids: readonly number[]): Promise<Float32Array> {
    return floats((await this.run('codec_embed', { codec_ids: integer(ids, [1, ids.length]) }))[0]);
  }
  private async prefill(text: string, language: 'ru' | 'en'): Promise<{ input: Float32Array; pad: Float32Array }> {
    const ids = this.tokenizer.encode(`<|im_start|>assistant\n${text.normalize('NFC')}<|im_end|>\n<|im_start|>assistant\n`, { add_special_tokens: false });
    if (ids.length < 9 || ids.length > 4096 || ids[0] !== 151644) throw new Error('Invalid speech tokens');
    const special = await this.text([151672, 151673, 151671]);
    const bos = special.slice(0, H), eos = special.slice(H, H * 2), pad = special.slice(H * 2);
    const codec = await this.codec([2154, 2156, language === 'ru' ? 2069 : 2050, 2157, 2873, 2148, 2149]);
    const prefix: Float32Array[] = [await this.text(ids.slice(0, 3))];
    for (let i = 0; i < 6; i++) prefix.push(add(i === 5 ? bos : pad, codec.slice(i * H, (i + 1) * H)));
    const body = ids.slice(3, -5);
    prefix.push(add(concat([await this.text(body), eos]), await this.codec(Array.from({ length: body.length + 1 }, () => 2148))));
    prefix.push(add(pad, codec.slice(6 * H)));
    return { input: concat(prefix), pad };
  }
  public async synthesize(text: string, language: 'ru' | 'en'): Promise<Float32Array> {
    if (!text.trim() || text.length > 2000) throw new Error('Invalid speech text');
    const { input, pad } = await this.prefill(text, language);
    const session = this.sessions.talker_cache;
    const pastNames = session.inputNames.slice(3);
    let past: readonly Tensor[] = pastNames.map(() => floating(new Float32Array(0), [1, 8, 0, 128]));
    let current = input;
    let total = 0;
    const frames: number[][] = [];
    const previous = new Set<number>();
    try {
      for (let step = 0; step <= 1500; step++) {
        const count = current.length / H;
        const positions = Array.from({ length: count }, (_, i) => total + i);
        const feed: Record<string, Tensor> = {
          inputs_embeds: floating(current, [1, count, H]),
          position_ids: integer([...positions, ...positions, ...positions], [3, 1, count]),
          attention_mask: integer(Array.from({ length: total + count }, () => 1), [1, total + count]),
        };
        pastNames.forEach((name, i) => { feed[name] = past[i]!; });
        const result = await this.run('talker_cache', feed);
        past.forEach(tensor => tensor.dispose());
        past = result.slice(2);
        total += count;
        const logits = floats(result[0]);
        const first = sample(logits.slice(-3072), previous, 2150);
        const hidden = floats(result[1]).slice(-H);
        result[0]?.dispose(); result[1]?.dispose();
        if (first === 2150) {
          if (!frames.length) throw new Error('Empty speech');
          return await this.decode(frames);
        }
        if (step === 1500) throw new Error('Speech frame limit');
        previous.add(first);
        const codes = [first, ...Array<number>(15).fill(0)];
        for (let group = 1; group < 16; group++) {
          const output = await this.run('code_predictor', { talker_hidden: floating(hidden, [1, H]), codec_ids: integer(codes, [1, 16]) });
          codes[group] = sample(floats(output[0]).slice((group - 1) * 2048, group * 2048));
          output.forEach(tensor => tensor.dispose());
        }
        frames.push(codes);
        const next = await this.run('residual_embed', { codec_ids: integer(codes, [1, 16]) });
        current = add(floats(next[0]), pad);
        next.forEach(tensor => tensor.dispose());
      }
      throw new Error('Speech frame limit');
    } finally { past.forEach(tensor => tensor.dispose()); }
  }
  private async decode(frames: readonly number[][]): Promise<Float32Array> {
    const chunks: Float32Array[] = [];
    for (let offset = 0; offset < frames.length; offset += 25) {
      const count = Math.min(25, frames.length - offset);
      const codes = Array.from({ length: 25 }, (_, i) => frames[offset + i % count]!).flat();
      const output = await this.run('tok_decoder', { audio_codes: integer(codes, [1, 25, 16]) });
      const pcm = floats(output[0]);
      chunks.push(pcm.slice(0, Math.round(pcm.length * count / 25)));
      output.forEach(tensor => tensor.dispose());
    }
    const samples = concat(chunks);
    if (samples.length < 1 || samples.length > 2_880_000 || !samples.every(Number.isFinite)) throw new Error('Invalid speech waveform');
    return samples.map(value => Math.max(-1, Math.min(1, value)));
  }
  public async dispose(): Promise<void> { await Promise.all(Object.values(this.sessions).map(session => session.release())); }
}
