/** Apache-2.0 model resources; hashes from pinned upstream blobs. */
export const TTS_MODEL = {
  "model": "onnx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice",
  "revision": "18b0bf898d211718bc33082fadc36a448e0cbc0c",
  "totalBytes": 1066091502,
  "files": [
    {
      "path": "cpu_int4/code_predictor.onnx",
      "size": 91668866,
      "sha256": "f0b3a431b90a56d2784599948bcff678d5188e38481d3a991d80c550d0d0bfa2"
    },
    {
      "path": "cpu_int4/codec_embed.onnx",
      "size": 2015779,
      "sha256": "bd76cd6b77907c76b6d0055ea6cf7572468ab99dc3451c1176ea2189d1a55f70"
    },
    {
      "path": "cpu_int4/residual_embed.onnx",
      "size": 22179258,
      "sha256": "eec76513b562f558e76eeeb9b0bfa982de512104cddac372ec368ab504b080a0"
    },
    {
      "path": "cpu_int4/talker_cache.onnx",
      "size": 288573853,
      "sha256": "910e1d556cd74f11bbb55fff9d509a962bfc43f23608b62fb0a8215c7acc882f"
    },
    {
      "path": "cpu_int4/text_embed.onnx",
      "size": 203384915,
      "sha256": "b2923edfce01344dea9bd719e2daf94bda0b45bfd05a307514e9dd5f793dcd09"
    },
    {
      "path": "cpu_int4/tok_decoder.onnx",
      "size": 458268831,
      "sha256": "8ec10051735029f6e08b04834128c9108428885c39384f443e49a6790ccb129f"
    }
  ]
} as const;
export const TTS_TOKENIZER = {
  "model": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
  "revision": "85e237c12c027371202489a0ec509ded67b5e4b5",
  "totalBytes": 4460924,
  "files": [
    {
      "path": "config.json",
      "size": 4908,
      "sha256": "81aca2b6fac304944d8acf345272d8a9a727d5fc2e2e66b222ab4729340c7455"
    },
    {
      "path": "tokenizer_config.json",
      "size": 7344,
      "sha256": "dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670"
    },
    {
      "path": "vocab.json",
      "size": 2776833,
      "sha256": "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910"
    },
    {
      "path": "merges.txt",
      "size": 1671839,
      "sha256": "599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3"
    }
  ]
} as const;
