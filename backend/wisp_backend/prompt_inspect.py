"""Run only built-in synthetic scenes; no provider calls or application logging."""

import argparse
import asyncio
import json

from wisp_backend.prompt_inspection.report import inspect_scene
from wisp_backend.prompt_inspection.scenes import SCENE_IDS
from wisp_backend.providers.context_budget import CONTEXT_WINDOWS


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", choices=SCENE_IDS, required=True)
    parser.add_argument("--locale", choices=("ru", "en"), default="en")
    parser.add_argument("--provider", choices=("groq", "gemini", "openai"), default="groq")
    parser.add_argument("--model", choices=sorted({model for _, model in CONTEXT_WINDOWS}))
    parser.add_argument("--max-output-tokens", type=int, choices=(512, 1024, 2048, 4096), default=4096)
    parser.add_argument("--temperature", type=float, choices=(0.0, 0.5, 1.0, 1.5, 2.0))
    parser.add_argument("--thinking-level", choices=("minimal", "low", "medium", "high"))
    parser.add_argument("--budget-case", choices=("normal", "required_only", "overflow"), default="normal")
    args = parser.parse_args()
    try:
        report = asyncio.run(
            inspect_scene(
                args.scene,
                args.locale,
                args.provider,
                args.model,
                max_output_tokens=args.max_output_tokens,
                temperature=args.temperature,
                thinking_level=args.thinking_level,
                budget_case=args.budget_case,
            )
        )
    except ValueError:
        parser.error("Unsupported synthetic inspection settings or fixture")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
