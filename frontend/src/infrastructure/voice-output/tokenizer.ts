import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PreTrainedTokenizer, env } from '@huggingface/transformers';

/** Qwen2 slow-tokenizer resources converted to the equivalent HF Tokenizer JSON. */
export async function createSpeechTokenizer(directory: string): Promise<PreTrainedTokenizer> {
  env.allowRemoteModels = false; env.useFSCache = false;
  const vocab: unknown = JSON.parse(await readFile(path.join(directory, 'vocab.json'), 'utf8'));
  const config: unknown = JSON.parse(await readFile(path.join(directory, 'tokenizer_config.json'), 'utf8'));
  if (!vocab || typeof vocab !== 'object' || !config || typeof config !== 'object' || !('added_tokens_decoder' in config) || !config.added_tokens_decoder || typeof config.added_tokens_decoder !== 'object') throw new Error('Invalid tokenizer resources');
  const merges = (await readFile(path.join(directory, 'merges.txt'), 'utf8')).split('\n').filter(line => line && !line.startsWith('#version:')).map(line => line.split(' '));
  const added = Object.entries(config.added_tokens_decoder).map(([id, value]: [string, unknown]) => {
    if (!value || typeof value !== 'object' || !('content' in value) || typeof value.content !== 'string') throw new Error('Invalid tokenizer token');
    return { ...value, id: Number(id) };
  });
  return new PreTrainedTokenizer({
    version: '1.0', truncation: null, padding: null, added_tokens: added, normalizer: { type: 'NFC' },
    pre_tokenizer: { type: 'Sequence', pretokenizers: [
      { type: 'Split', pattern: { Regex: "(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+" }, behavior: 'Isolated', invert: false },
      { type: 'ByteLevel', add_prefix_space: false, trim_offsets: false, use_regex: false },
    ] },
    post_processor: null, decoder: { type: 'ByteLevel', add_prefix_space: false, trim_offsets: false, use_regex: false },
    model: { type: 'BPE', dropout: null, unk_token: null, continuing_subword_prefix: '', end_of_word_suffix: '', fuse_unk: false, byte_fallback: false, vocab, merges },
  }, config);
}
