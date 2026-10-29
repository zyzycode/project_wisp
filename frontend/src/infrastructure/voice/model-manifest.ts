/** Immutable multilingual base q8 export; upstream OpenAI Whisper MIT, Transformers Apache-2.0. */
export const VOICE_MODEL = {
  "model": "onnx-community/whisper-base",
  "revision": "1846881b6b3a3024392c1eea3ad983695bc23925",
  "files": [
    {
      "path": "config.json",
      "size": 2243,
      "sha256": "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b"
    },
    {
      "path": "generation_config.json",
      "size": 3832,
      "sha256": "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0"
    },
    {
      "path": "preprocessor_config.json",
      "size": 339,
      "sha256": "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d"
    },
    {
      "path": "tokenizer.json",
      "size": 2480466,
      "sha256": "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566"
    },
    {
      "path": "tokenizer_config.json",
      "size": 282682,
      "sha256": "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573"
    },
    {
      "path": "onnx/decoder_model_merged_quantized.onnx",
      "size": 53693315,
      "sha256": "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b"
    },
    {
      "path": "onnx/encoder_model_quantized.onnx",
      "size": 23201314,
      "sha256": "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46"
    }
  ],
  "totalBytes": 79664191
} as const;
