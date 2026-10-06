#!/usr/bin/env python3
"""
Project Wisp — Sprite Tree & Manifest Validator and Synchronizer
===============================================================
Deterministic scanning, validation, and safe updating of sprite assets
and public/assets/sprites/manifest.json according to docs/engine/RENDER_ENGINE.md.

Modes:
  --check / --validate  : Read-only verification. Exits with non-zero code on errors.
  --write / --update    : Deterministic update of manifest.json preserving manual metadata.
  --quarantine-dir PATH : Directory to move orphaned/stale files instead of deleting.
  --json                : Machine-readable JSON output of validation report.
  --strict              : Treat warnings (e.g. unregistered PNGs) as errors.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple


@dataclass
class ValidationIssue:
    severity: str  # 'ERROR' | 'WARNING'
    code: str
    message: str
    target: Optional[str] = None


@dataclass
class ValidationReport:
    is_valid: bool
    errors: List[ValidationIssue] = field(default_factory=list)
    warnings: List[ValidationIssue] = field(default_factory=list)
    scanned_files_count: int = 0
    registered_animations_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "isValid": self.is_valid,
            "errorsCount": len(self.errors),
            "warningsCount": len(self.warnings),
            "scannedFilesCount": self.scanned_files_count,
            "registeredAnimationsCount": self.registered_animations_count,
            "errors": [
                {"severity": e.severity, "code": e.code, "message": e.message, "target": e.target}
                for e in self.errors
            ],
            "warnings": [
                {"severity": w.severity, "code": w.code, "message": w.message, "target": w.target}
                for w in self.warnings
            ],
        }


class SpriteValidator:
    def __init__(
        self,
        project_root: Optional[str] = None,
        sprites_dir: Optional[str] = None,
        manifest_path: Optional[str] = None,
        quarantine_dir: Optional[str] = None,
        strict: bool = False,
    ):
        if project_root:
            self.project_root = os.path.abspath(project_root)
        else:
            self.project_root = os.path.abspath(
                os.path.join(os.path.dirname(__file__), "..")
            )

        self.public_dir = os.path.join(self.project_root, "public")
        self.sprites_dir = (
            os.path.abspath(sprites_dir)
            if sprites_dir
            else os.path.join(self.public_dir, "assets", "sprites")
        )
        self.manifest_path = (
            os.path.abspath(manifest_path)
            if manifest_path
            else os.path.join(self.sprites_dir, "manifest.json")
        )
        self.quarantine_dir = (
            os.path.abspath(quarantine_dir)
            if quarantine_dir
            else os.path.join(self.sprites_dir, ".quarantine")
        )
        self.strict = strict

    def _normalize_category(self, category: str) -> str:
        cat = category.strip()
        if cat.startswith("faces/"):
            return "face/" + cat[len("faces/") :]
        if cat.startswith("fx/"):
            return "props/" + cat[len("fx/") :]
        return cat

    def _is_body_entry(self, anim_key: str, category: str) -> bool:
        norm_cat = self._normalize_category(category)
        return anim_key.startswith("body_") or norm_cat.startswith("body/")

    def _is_face_entry(self, anim_key: str, category: str) -> bool:
        norm_cat = self._normalize_category(category)
        return anim_key.startswith("face_") or norm_cat.startswith("face/")

    def _resolve_asset_path(self, frame_source: str) -> str:
        clean = frame_source.lstrip("/\\")
        if clean.startswith("assets/"):
            return os.path.join(self.public_dir, clean)
        return os.path.join(self.sprites_dir, clean)

    def scan_disk_sprites(self) -> Dict[str, str]:
        """
        Scans all PNG files in sprites_dir (ignoring quarantine, dot-dirs, and scratch dirs).
        Returns a mapping: rel_asset_path (e.g. '/assets/sprites/body/idle/body_idle_00.png') -> absolute_path.
        """
        found: Dict[str, str] = {}
        if not os.path.exists(self.sprites_dir):
            return found

        for root, dirs, files in os.walk(self.sprites_dir):
            # Exclude dot directories and quarantine
            dirs[:] = [
                d
                for d in dirs
                if not d.startswith(".")
                and d != "delete_me"
                and os.path.abspath(os.path.join(root, d)) != self.quarantine_dir
            ]

            for file in files:
                if file.lower().endswith((".png", ".webp")):
                    abs_path = os.path.join(root, file)
                    rel_to_public = os.path.relpath(abs_path, self.public_dir).replace("\\", "/")
                    canonical_key = "/" + rel_to_public if not rel_to_public.startswith("/") else rel_to_public
                    found[canonical_key] = abs_path
        return found

    def load_manifest(self) -> Tuple[Optional[Dict[str, Any]], List[ValidationIssue]]:
        issues: List[ValidationIssue] = []
        if not os.path.exists(self.manifest_path):
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="MANIFEST_NOT_FOUND",
                    message=f"Manifest file not found: {self.manifest_path}",
                    target=self.manifest_path,
                )
            )
            return None, issues

        try:
            with open(self.manifest_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if not isinstance(data, dict):
                    issues.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="MANIFEST_INVALID_TYPE",
                            message="Manifest root must be a JSON object",
                            target=self.manifest_path,
                        )
                    )
                    return None, issues
                return data, issues
        except Exception as e:
            issues.append(
                ValidationIssue(
                    severity="ERROR",
                    code="MANIFEST_SYNTAX_ERROR",
                    message=f"Failed to parse manifest JSON: {str(e)}",
                    target=self.manifest_path,
                )
            )
            return None, issues

    def validate(self) -> ValidationReport:
        errors: List[ValidationIssue] = []
        warnings: List[ValidationIssue] = []

        manifest_data, load_issues = self.load_manifest()
        errors.extend([i for i in load_issues if i.severity == "ERROR"])
        warnings.extend([i for i in load_issues if i.severity == "WARNING"])

        disk_files = self.scan_disk_sprites()
        referenced_files: Set[str] = set()

        if manifest_data is None:
            return ValidationReport(
                is_valid=False,
                errors=errors,
                warnings=warnings,
                scanned_files_count=len(disk_files),
                registered_animations_count=0,
            )

        # Normalize animation entries
        animations: Dict[str, Dict[str, Any]] = {}
        if "animations" in manifest_data and isinstance(manifest_data["animations"], dict):
            animations = manifest_data["animations"]
        else:
            # Flat format
            animations = {
                k: v
                for k, v in manifest_data.items()
                if isinstance(v, dict) and k != "animations" and k != "schemaVersion"
            }

        # 1. Validate individual animation entries
        for anim_key, anim_def in animations.items():
            if not isinstance(anim_def, dict):
                errors.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="INVALID_ANIMATION_DEF",
                        message=f"Animation definition for '{anim_key}' must be a JSON object",
                        target=anim_key,
                    )
                )
                continue

            category = str(anim_def.get("category", ""))
            if not category:
                errors.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="MISSING_CATEGORY",
                        message=f"Animation '{anim_key}' is missing required 'category'",
                        target=anim_key,
                    )
                )

            # Check frames array
            frames = anim_def.get("frames", [])
            if not isinstance(frames, list) or len(frames) == 0:
                errors.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="EMPTY_FRAMES",
                        message=f"Animation '{anim_key}' must have a non-empty 'frames' list",
                        target=anim_key,
                    )
                )
            else:
                frames_count = anim_def.get("framesCount")
                if frames_count is not None and frames_count != len(frames):
                    errors.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="FRAMES_COUNT_MISMATCH",
                            message=(
                                f"Animation '{anim_key}' framesCount ({frames_count}) "
                                f"does not match frames length ({len(frames)})"
                            ),
                            target=anim_key,
                        )
                    )

                # Check each frame source exists on disk
                for idx, frame_item in enumerate(frames):
                    frame_source = ""
                    if isinstance(frame_item, str):
                        frame_source = frame_item
                    elif isinstance(frame_item, dict):
                        frame_source = frame_item.get("source", "")
                    else:
                        errors.append(
                            ValidationIssue(
                                severity="ERROR",
                                code="INVALID_FRAME_DEF",
                                message=f"Animation '{anim_key}' frame[{idx}] must be a string or object",
                                target=anim_key,
                            )
                        )
                        continue

                    if not frame_source:
                        errors.append(
                            ValidationIssue(
                                severity="ERROR",
                                code="MISSING_FRAME_SOURCE",
                                message=f"Animation '{anim_key}' frame[{idx}] is missing source path",
                                target=anim_key,
                            )
                        )
                        continue

                    # Path traversal forbidden
                    if ".." in frame_source:
                        errors.append(
                            ValidationIssue(
                                severity="ERROR",
                                code="PATH_TRAVERSAL_FORBIDDEN",
                                message=f"Animation '{anim_key}' frame[{idx}] path traversal '..' is forbidden: {frame_source}",
                                target=anim_key,
                            )
                        )
                        continue

                    clean_rel = "/" + frame_source.lstrip("/\\").replace("\\", "/")
                    referenced_files.add(clean_rel)

                    abs_target = self._resolve_asset_path(frame_source)
                    if not os.path.exists(abs_target):
                        errors.append(
                            ValidationIssue(
                                severity="ERROR",
                                code="MISSING_ASSET_FILE",
                                message=f"Animation '{anim_key}' frame[{idx}] references missing file: {frame_source} ({abs_target})",
                                target=anim_key,
                            )
                        )

            # Check faceOverlay rules according to RENDER_ENGINE.md Section 1.5
            is_body = self._is_body_entry(anim_key, category)
            face_overlay = anim_def.get("faceOverlay")

            if is_body:
                if face_overlay is None:
                    errors.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="MISSING_FACE_OVERLAY",
                            message=f"Body animation '{anim_key}' must declare 'faceOverlay' compatibility",
                            target=anim_key,
                        )
                    )
                elif not isinstance(face_overlay, dict):
                    errors.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="INVALID_FACE_OVERLAY",
                            message=f"Body animation '{anim_key}' faceOverlay must be an object",
                            target=anim_key,
                        )
                    )
                else:
                    mode = face_overlay.get("mode")
                    if mode not in ("overlay", "baked_in", "none"):
                        errors.append(
                            ValidationIssue(
                                severity="ERROR",
                                code="INVALID_FACE_OVERLAY_MODE",
                                message=f"Body animation '{anim_key}' faceOverlay.mode must be 'overlay' | 'baked_in' | 'none', got '{mode}'",
                                target=anim_key,
                            )
                        )
                    elif mode == "overlay":
                        allowed = face_overlay.get("allowedFaceKeys")
                        if not isinstance(allowed, list) or len(allowed) == 0:
                            errors.append(
                                ValidationIssue(
                                    severity="ERROR",
                                    code="EMPTY_ALLOWED_FACE_KEYS",
                                    message=f"Body animation '{anim_key}' in 'overlay' mode requires a non-empty 'allowedFaceKeys' list",
                                    target=anim_key,
                                )
                            )
                        else:
                            for fk in allowed:
                                if fk not in animations:
                                    errors.append(
                                        ValidationIssue(
                                            severity="ERROR",
                                            code="UNKNOWN_ALLOWED_FACE_KEY",
                                            message=f"Body animation '{anim_key}' allowedFaceKey '{fk}' not registered in manifest",
                                            target=anim_key,
                                        )
                                    )
                                else:
                                    fk_cat = animations[fk].get("category", "")
                                    if not self._is_face_entry(fk, fk_cat):
                                        errors.append(
                                            ValidationIssue(
                                                severity="ERROR",
                                                code="INVALID_ALLOWED_FACE_CATEGORY",
                                                message=f"Body animation '{anim_key}' allowedFaceKey '{fk}' must belong to 'face/*' category, got '{fk_cat}'",
                                                target=anim_key,
                                            )
                                        )

                        anchor_name = face_overlay.get("anchor")
                        if not anchor_name or not isinstance(anchor_name, str):
                            errors.append(
                                ValidationIssue(
                                    severity="ERROR",
                                    code="MISSING_FACE_OVERLAY_ANCHOR",
                                    message=f"Body animation '{anim_key}' in 'overlay' mode requires an 'anchor' name string",
                                    target=anim_key,
                                )
                            )
                        else:
                            # Verify anchor is defined in defaultAnchors or frameMeta
                            has_default_anchor = (
                                isinstance(anim_def.get("defaultAnchors"), dict)
                                and anchor_name in anim_def["defaultAnchors"]
                            )
                            frame_meta = anim_def.get("frameMeta")
                            has_frame_anchors = (
                                isinstance(frame_meta, list)
                                and len(frame_meta) > 0
                                and all(
                                    isinstance(fm, dict)
                                    and isinstance(fm.get("anchors"), dict)
                                    and anchor_name in fm["anchors"]
                                    for fm in frame_meta
                                )
                            )

                            if not has_default_anchor and not has_frame_anchors:
                                errors.append(
                                    ValidationIssue(
                                        severity="ERROR",
                                        code="UNRESOLVED_FACE_ANCHOR",
                                        message=(
                                            f"Body animation '{anim_key}' specifies anchor '{anchor_name}', "
                                            f"but '{anchor_name}' is not defined in defaultAnchors or frameMeta"
                                        ),
                                        target=anim_key,
                                    )
                                )

                        fallback = face_overlay.get("fallback")
                        if fallback != "none" and (not isinstance(allowed, list) or fallback not in allowed):
                            errors.append(
                                ValidationIssue(
                                    severity="ERROR",
                                    code="INVALID_FACE_FALLBACK",
                                    message=(
                                        f"Body animation '{anim_key}' fallback must be 'none' or "
                                        f"one of allowedFaceKeys ({allowed}), got '{fallback}'"
                                    ),
                                    target=anim_key,
                                )
                            )

                    elif mode in ("baked_in", "none"):
                        fallback = face_overlay.get("fallback")
                        if fallback != "none":
                            errors.append(
                                ValidationIssue(
                                    severity="ERROR",
                                    code="INVALID_BAKED_FALLBACK",
                                    message=f"Body animation '{anim_key}' with mode '{mode}' must have fallback='none', got '{fallback}'",
                                    target=anim_key,
                                )
                            )
                        if "allowedFaceKeys" in face_overlay and face_overlay["allowedFaceKeys"] is not None:
                            errors.append(
                                ValidationIssue(
                                    severity="ERROR",
                                    code="FORBIDDEN_ALLOWED_KEYS_IN_BAKED",
                                    message=f"Body animation '{anim_key}' with mode '{mode}' must omit allowedFaceKeys",
                                    target=anim_key,
                                )
                            )
                        if "anchor" in face_overlay and face_overlay["anchor"] is not None:
                            errors.append(
                                ValidationIssue(
                                    severity="ERROR",
                                    code="FORBIDDEN_ANCHOR_IN_BAKED",
                                    message=f"Body animation '{anim_key}' with mode '{mode}' must omit anchor",
                                    target=anim_key,
                                )
                            )
            else:
                # Non-body entries must NOT declare faceOverlay
                if face_overlay is not None:
                    errors.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="FORBIDDEN_FACE_OVERLAY_ON_NON_BODY",
                            message=f"Non-body animation '{anim_key}' (category: '{category}') is forbidden from declaring 'faceOverlay'",
                            target=anim_key,
                        )
                    )

            # Validate numeric constraints
            fps = anim_def.get("fps")
            if fps is not None and (not isinstance(fps, (int, float)) or fps <= 0):
                errors.append(
                    ValidationIssue(
                        severity="ERROR",
                        code="INVALID_FPS",
                        message=f"Animation '{anim_key}' fps must be a positive number, got {fps}",
                        target=anim_key,
                    )
                )

            canvas_size = anim_def.get("canvasSize")
            if canvas_size is not None:
                if (
                    not isinstance(canvas_size, dict)
                    or canvas_size.get("width", 0) <= 0
                    or canvas_size.get("height", 0) <= 0
                ):
                    errors.append(
                        ValidationIssue(
                            severity="ERROR",
                            code="INVALID_CANVAS_SIZE",
                            message=f"Animation '{anim_key}' canvasSize must have positive width and height",
                            target=anim_key,
                        )
                    )

        # 2. Check for unreferenced / orphaned PNGs on disk
        for disk_rel_path, abs_path in disk_files.items():
            if disk_rel_path not in referenced_files:
                issue = ValidationIssue(
                    severity="WARNING" if not self.strict else "ERROR",
                    code="UNREGISTERED_SPRITE_ON_DISK",
                    message=f"PNG file exists on disk but is not registered in manifest: {disk_rel_path}",
                    target=disk_rel_path,
                )
                if self.strict:
                    errors.append(issue)
                else:
                    warnings.append(issue)

        is_valid = len(errors) == 0
        return ValidationReport(
            is_valid=is_valid,
            errors=errors,
            warnings=warnings,
            scanned_files_count=len(disk_files),
            registered_animations_count=len(animations),
        )

    def update_manifest(self, quarantine_orphans: bool = False) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Scans on-disk assets and safely synchronizes manifest.json.
        Strictly preserves all existing manual metadata (pivot, defaultAnchors, frameMeta, faceOverlay, etc.).
        """
        manifest_data, _ = self.load_manifest()
        if manifest_data is None:
            manifest_data = {}

        # Preserve top-level schema / wrapper if present
        is_wrapped = "animations" in manifest_data and isinstance(manifest_data["animations"], dict)
        existing_anims: Dict[str, Dict[str, Any]] = (
            manifest_data["animations"] if is_wrapped else manifest_data
        )

        # Quarantine orphaned files before scanning if requested
        quarantined_files: List[str] = []
        if quarantine_orphans:
            os.makedirs(self.quarantine_dir, exist_ok=True)
            active_referenced: Set[str] = set()
            for anim in existing_anims.values():
                if isinstance(anim, dict):
                    for f in anim.get("frames", []):
                        if isinstance(f, str):
                            clean = "/" + f.lstrip("/\\").replace("\\", "/")
                            active_referenced.add(clean)
                        elif isinstance(f, dict):
                            clean = "/" + f.get("source", "").lstrip("/\\").replace("\\", "/")
                            active_referenced.add(clean)

            initial_disk_files = self.scan_disk_sprites()
            for disk_rel, abs_path in initial_disk_files.items():
                if disk_rel not in active_referenced:
                    target_quarantine = os.path.join(
                        self.quarantine_dir,
                        f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{os.path.basename(abs_path)}",
                    )
                    shutil.move(abs_path, target_quarantine)
                    quarantined_files.append(abs_path)

        disk_files = self.scan_disk_sprites()

        # Group on-disk files by animation prefix/folder
        # Pattern: /assets/sprites/<layer>/<subfolder>/<prefix>_<index>.png
        grouped_disk: Dict[str, List[Tuple[int, str]]] = {}
        file_to_anim_key: Dict[str, str] = {}

        for rel_path in sorted(disk_files.keys()):
            parts = rel_path.strip("/").split("/")
            if len(parts) >= 3 and parts[0] == "assets" and parts[1] == "sprites":
                sub_parts = parts[2:]  # e.g. ['body', 'idle', 'body_idle_00.png']
                filename = sub_parts[-1]
                m = re.match(r"^(.+)_(\d+)\.(png|webp)$", filename, re.IGNORECASE)
                if m:
                    anim_prefix = m.group(1)
                    frame_idx = int(m.group(2))
                    grouped_disk.setdefault(anim_prefix, []).append((frame_idx, rel_path))
                    file_to_anim_key[rel_path] = anim_prefix
                else:
                    # Single frame / non-indexed file
                    base_name = os.path.splitext(filename)[0]
                    grouped_disk.setdefault(base_name, []).append((0, rel_path))
                    file_to_anim_key[rel_path] = base_name

        updated_anims: Dict[str, Dict[str, Any]] = {}

        # 1. Update existing animations while preserving metadata
        for anim_key, existing_def in existing_anims.items():
            if not isinstance(existing_def, dict) or anim_key in ("animations", "schemaVersion"):
                continue

            entry_copy = json.loads(json.dumps(existing_def))  # Deep copy

            if anim_key in grouped_disk:
                sorted_frames = [
                    item[1] for item in sorted(grouped_disk[anim_key], key=lambda x: x[0])
                ]
                entry_copy["frames"] = sorted_frames
                entry_copy["framesCount"] = len(sorted_frames)
            else:
                # Retain existing frames but verify
                pass

            category = entry_copy.get("category", "")
            if self._is_body_entry(anim_key, category) and "faceOverlay" not in entry_copy:
                entry_copy["faceOverlay"] = {"mode": "baked_in", "fallback": "none"}

            updated_anims[anim_key] = entry_copy

        # 2. Add newly discovered animations from disk (if not in quarantine mode)
        if not quarantine_orphans:
            for anim_key, frames_list in grouped_disk.items():
                if anim_key not in updated_anims:
                    sorted_frames = [item[1] for item in sorted(frames_list, key=lambda x: x[0])]
                    sample_path = sorted_frames[0].strip("/").split("/")
                    # sample_path: ['assets', 'sprites', 'body', 'walk', 'body_walk_00.png']
                    if len(sample_path) >= 4:
                        cat_folder = sample_path[2]
                        sub_folder = sample_path[3]
                        category = f"{cat_folder}/{sub_folder}"
                    else:
                        category = f"custom/{anim_key}"

                    new_entry: Dict[str, Any] = {
                        "category": category,
                        "framesCount": len(sorted_frames),
                        "frames": sorted_frames,
                    }

                    if self._is_body_entry(anim_key, category):
                        new_entry["faceOverlay"] = {"mode": "baked_in", "fallback": "none"}

                    updated_anims[anim_key] = new_entry

        # Build output structure
        if is_wrapped:
            manifest_data["animations"] = updated_anims
            final_output = manifest_data
        else:
            final_output = updated_anims

        # Atomic write
        temp_manifest = self.manifest_path + ".tmp"
        with open(temp_manifest, "w", encoding="utf-8") as f:
            json.dump(final_output, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(temp_manifest, self.manifest_path)

        msg = f"Updated manifest with {len(updated_anims)} animations."
        if quarantined_files:
            msg += f" Quarantined {len(quarantined_files)} orphaned files to {self.quarantine_dir}."

        return True, msg, final_output


def format_report_text(report: ValidationReport, verbose: bool = False) -> str:
    lines = []
    lines.append("=" * 65)
    lines.append(" Project Wisp — Sprite Tree & Manifest Validation Report")
    lines.append("=" * 65)
    lines.append(f" Status: {'PASS' if report.is_valid else 'FAIL'}")
    lines.append(f" Animations Registered: {report.registered_animations_count}")
    lines.append(f" PNG Files on Disk:     {report.scanned_files_count}")
    lines.append(f" Errors:                {len(report.errors)}")
    lines.append(f" Warnings:              {len(report.warnings)}")
    lines.append("-" * 65)

    if report.errors:
        lines.append("ERRORS:")
        for err in report.errors:
            target_str = f" [{err.target}]" if err.target else ""
            lines.append(f"  [x] ({err.code}){target_str}: {err.message}")
        lines.append("")

    if report.warnings:
        lines.append("WARNINGS:")
        for warn in report.warnings:
            target_str = f" [{warn.target}]" if warn.target else ""
            lines.append(f"  [!] ({warn.code}){target_str}: {warn.message}")
        lines.append("")

    if report.is_valid and not report.warnings:
        lines.append("✨ Manifest and sprite tree are 100% consistent!")

    lines.append("=" * 65)
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Project Wisp — Sprite & Manifest Validator / Updater"
    )
    parser.add_argument(
        "--check",
        "--validate",
        dest="check_mode",
        action="store_true",
        help="Run in read-only validation mode (default)",
    )
    parser.add_argument(
        "--write",
        "--update",
        dest="write_mode",
        action="store_true",
        help="Update manifest.json preserving manual metadata",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings (such as unregistered PNGs) as fatal errors",
    )
    parser.add_argument(
        "--quarantine-orphans",
        action="store_true",
        help="Move unregistered/stale files to quarantine folder during --write",
    )
    parser.add_argument(
        "--quarantine-dir",
        type=str,
        default=None,
        help="Custom path for quarantine folder",
    )
    parser.add_argument(
        "--manifest",
        type=str,
        default=None,
        help="Custom path to manifest.json",
    )
    parser.add_argument(
        "--sprites-dir",
        type=str,
        default=None,
        help="Custom path to sprites directory",
    )
    parser.add_argument(
        "--json",
        dest="output_json",
        action="store_true",
        help="Output result as JSON",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Verbose logging",
    )

    args = parser.parse_args()

    validator = SpriteValidator(
        sprites_dir=args.sprites_dir,
        manifest_path=args.manifest,
        quarantine_dir=args.quarantine_dir,
        strict=args.strict,
    )

    if args.write_mode:
        success, message, _ = validator.update_manifest(
            quarantine_orphans=args.quarantine_orphans
        )
        if not args.output_json:
            print(f"📦 [Update Mode] {message}")
        # After update, run validation
        report = validator.validate()
    else:
        report = validator.validate()

    if args.output_json:
        print(json.dumps(report.to_dict(), indent=2, ensure_ascii=False))
    else:
        print(format_report_text(report, verbose=args.verbose))

    sys.exit(0 if report.is_valid else 1)


if __name__ == "__main__":
    main()
