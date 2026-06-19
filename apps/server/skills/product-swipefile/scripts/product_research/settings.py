from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from .lib import DEFAULT_SETTINGS, DEFAULT_SETTINGS_PATH, VALID_TARGETS, deep_merge, load_json, write_json

def parse_targets(raw_target: str | None) -> list[str]:
    if not raw_target:
        return []
    parts = [part.strip().lower() for part in re.split(r"[,+]", raw_target) if part.strip()]
    if not parts:
        return []
    targets: list[str] = []
    for part in parts:
        if part not in VALID_TARGETS:
            raise ValueError(
                f"Unknown delivery target: {part}. Supported targets: "
                + ", ".join(sorted(VALID_TARGETS))
                + ". Chat and IM are notification surfaces, not export targets."
            )
        if part not in targets:
            targets.append(part)
    return targets



def cmd_show_settings(args: argparse.Namespace) -> int:
    path = Path(args.path).expanduser() if args.path else DEFAULT_SETTINGS_PATH
    print(json.dumps(load_json(path), indent=2, ensure_ascii=False))
    return 0

def cmd_init_settings(args: argparse.Namespace) -> int:
    path = Path(args.path).expanduser() if args.path else DEFAULT_SETTINGS_PATH
    settings = load_json(path) if path.exists() else json.loads(json.dumps(DEFAULT_SETTINGS))
    updates: dict[str, Any] = {}
    for key in ["language"]:
        value = getattr(args, key)
        if value is not None:
            updates[key] = value
    if args.default_targets is not None:
        try:
            settings["default_targets"] = parse_targets(args.default_targets)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 2
    deep_merge(settings, updates)
    if args.local_markdown_dir is not None:
        settings.setdefault("local_markdown", {})["directory"] = str(Path(args.local_markdown_dir).expanduser())
    if args.obsidian_vault is not None:
        settings["obsidian"]["vault_path"] = str(Path(args.obsidian_vault).expanduser())
    if args.obsidian_folder is not None:
        settings["obsidian"]["folder"] = args.obsidian_folder
    if args.notion_token_env is not None:
        settings["notion"]["token_env"] = args.notion_token_env
    if args.notion_parent_type is not None:
        settings["notion"]["parent_type"] = args.notion_parent_type
    if args.notion_parent_id is not None:
        settings["notion"]["parent_id"] = args.notion_parent_id
    if args.notion_title_property is not None:
        settings["notion"]["title_property"] = args.notion_title_property
    if args.lark_staging_dir is not None:
        settings["lark"]["staging_dir"] = args.lark_staging_dir
    if args.lark_connector_ready:
        settings["lark"]["connector_ready"] = True
    if args.feishu_staging_dir is not None:
        settings["feishu"]["staging_dir"] = args.feishu_staging_dir
    if args.feishu_connector_ready:
        settings["feishu"]["connector_ready"] = True
    if args.complete_setup:
        missing = validate_setup_requirements(settings)
        if missing:
            print("Cannot mark setup completed; missing: " + ", ".join(missing), file=sys.stderr)
            return 2
        settings.setdefault("setup", {})["completed"] = True
    write_json(path, settings)
    print(f"Wrote settings: {path}")
    return 0

def targets_from_settings(settings: dict[str, Any]) -> list[str]:
    raw_targets = settings.get("default_targets")
    if isinstance(raw_targets, str):
        return parse_targets(raw_targets)
    if isinstance(raw_targets, list) and raw_targets:
        return parse_targets("+".join(str(target) for target in raw_targets))
    return []

def target_readiness(settings: dict[str, Any]) -> dict[str, bool]:
    """Per-target deliverability. A target is ready when its delivery path can complete."""
    ready: dict[str, bool] = {}
    for target in targets_from_settings(settings):
        if target == "local_markdown":
            directory = settings.get("local_markdown", {}).get("directory")
            path = Path(directory).expanduser() if directory else None
            if not path:
                ready[target] = False
            elif path.exists():
                ready[target] = path.is_dir() and os.access(path, os.W_OK)
            else:
                # SKILL.md: 目录不存在则建一个。可创建即视为就绪（父目录存在且可写）。
                ready[target] = path.parent.exists() and os.access(path.parent, os.W_OK)
        elif target == "obsidian":
            vault_path = settings.get("obsidian", {}).get("vault_path")
            ready[target] = bool(vault_path) and Path(vault_path).expanduser().exists()
        elif target == "notion":
            notion = settings.get("notion", {})
            token_env = notion.get("token_env") or "NOTION_TOKEN"
            ready[target] = (
                notion.get("parent_type") in {"page_id", "database_id"}
                and bool(notion.get("parent_id"))
                and bool(os.environ.get(token_env))
            )
        elif target in {"lark", "feishu"}:
            ready[target] = bool(settings.get(target, {}).get("connector_ready"))
        else:
            ready[target] = False
    return ready


def validate_setup_requirements(settings: dict[str, Any]) -> list[str]:
    """Setup is completable only when language is set and every selected target can
    deliver. Multi-target setup is an all-target commitment, not a ranked preference."""
    missing: list[str] = []
    if not settings.get("language"):
        missing.append("language")
    try:
        targets = targets_from_settings(settings)
    except ValueError as exc:
        return [str(exc)]
    if not targets:
        missing.append("default_targets")
        return missing
    ready = target_readiness(settings)
    for target in targets:
        if not ready.get(target):
            missing.append(f"{target}.not_ready")
    return missing
