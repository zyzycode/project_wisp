"""Separate final PNG exports from local preview, cache and metadata outputs."""

import os
from pathlib import Path

from .config import OUTPUT_DIR, PRODUCTION_SPRITES_DIR


def output_path(path: str) -> Path:
    """Validate without creating anything; reject links escaping the output root."""
    root = Path(OUTPUT_DIR).absolute()
    if root.resolve() != root:
        raise ValueError(f"Output root must not be redirected by symlinks: {root}")
    resolved = Path(path).resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"Output must stay inside {root}: {path}")
    if resolved.is_file() and resolved.stat().st_nlink > 1:
        raise ValueError(f"Refusing to modify a hard-linked output file: {path}")
    return resolved


def prepare_output_file(path: str, sources=()) -> Path:
    """Validate a destination, prevent replacing source files, then create parents."""
    destination = output_path(path)
    for source in sources:
        source_path = Path(source).resolve()
        if destination == source_path or (
            destination.exists() and source_path.exists()
            and os.path.samefile(destination, source_path)
        ):
            raise ValueError(f"Output must not overwrite its input: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    return destination


def sprite_directory(path: str) -> Path:
    """Validate an export directory; reject traversal and symlink redirection."""
    root = Path(PRODUCTION_SPRITES_DIR).absolute()
    candidate = Path(path).absolute()
    resolved = candidate.resolve()
    if root.resolve() != root or resolved != candidate:
        raise ValueError(f"Sprite export paths must not contain traversal or symlinks: {path}")
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"Final PNG exports must stay inside {root}: {path}")
    if any(":" in part or part.rstrip(" .") != part for part in resolved.relative_to(root).parts):
        raise ValueError(f"Sprite paths must not use alternate streams or ambiguous Windows names: {path}")
    return resolved


def sprite_path(path: str) -> Path:
    """Authorize only regular PNG destinations, never the working JSON manifest."""
    destination = sprite_directory(path)
    if destination.suffix != ".png":
        raise ValueError(f"Only .png exports are allowed in the application: {path}")
    if destination.exists() and (
        not destination.is_file() or destination.stat().st_nlink > 1
    ):
        raise ValueError(f"Refusing non-regular or hard-linked PNG output: {path}")
    return destination


def prepare_sprite_file(path: str, sources=(), allow_in_place=False) -> Path:
    """Prepare a PNG export, preserving source sheets and all external references."""
    destination = sprite_path(path)
    for source in sources:
        source_path = Path(source).resolve()
        if destination == source_path or (
            destination.exists() and source_path.exists()
            and os.path.samefile(destination, source_path)
        ):
            # In-place edits are restricted to real production PNGs, never aliases.
            if not allow_in_place or sprite_path(source) != destination:
                raise ValueError(f"PNG export must not overwrite its source: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    return destination
