"""Run lifecycle commands: new-run, stage-status, checkpoint, check-tools.

Groups everything related to creating, inspecting, and reporting on a
research run directory.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .lib import (
    DEFAULT_RUNS_DIR,
    DEFAULT_SETTINGS_PATH,
    check_command,
    load_json,
    safe_product_slug,
    write_json,
)
from .settings import validate_setup_requirements


# ----------------------------------------------------------------------------
# new-run: create unique artifact directory for one research run
# ----------------------------------------------------------------------------

def cmd_new_run(args: argparse.Namespace) -> int:
    run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    product_slug = safe_product_slug(args.product)
    root = Path(args.root).expanduser() if args.root else DEFAULT_RUNS_DIR
    artifact_dir = root / product_slug / run_id
    raw_dir = artifact_dir / "raw"
    payload = {
        "product": args.product,
        "product_slug": product_slug,
        "run_id": run_id,
        "artifact_dir": str(artifact_dir),
        "inventory_path": str(artifact_dir / "inventory.md"),
        "report_path": str(artifact_dir / "report.md"),
        "meta_path": str(artifact_dir / "meta.json"),
        "raw_dir": str(raw_dir),
        "web_raw_dir": str(raw_dir / "web"),
        "opencli_raw_dir": str(raw_dir / "opencli"),
        "source_log_path": str(raw_dir / "source_log.md"),
        "dry_run": args.dry_run,
    }
    if not args.dry_run:
        (raw_dir / "web").mkdir(parents=True, exist_ok=True)
        (raw_dir / "opencli").mkdir(parents=True, exist_ok=True)
        write_json(artifact_dir / "meta.json", payload)
        write_json(artifact_dir / "run.json", payload)
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


# ----------------------------------------------------------------------------
# stage-status: mechanical "what stage are we in" diagnosis from artifacts
# ----------------------------------------------------------------------------

def artifact_paths(run_dir: Path) -> dict[str, Path]:
    return {
        "run_dir": run_dir,
        "inventory": run_dir / "inventory.md",
        "report": run_dir / "report.md",
        "meta": run_dir / "meta.json",
        "run_json": run_dir / "run.json",
        "raw": run_dir / "raw",
        "web_raw": run_dir / "raw" / "web",
        "opencli_raw": run_dir / "raw" / "opencli",
        "source_log": run_dir / "raw" / "source_log.md",
        "stage1_checkpoint": run_dir / "checkpoint_stage1.md",
        "stage2_checkpoint": run_dir / "checkpoint_stage2.md",
        "validate_inventory": run_dir / "validate-inventory.json",
        "validate_report": run_dir / "validate-report.json",
    }


def file_size(path: Path) -> int:
    return path.stat().st_size if path.exists() and path.is_file() else 0


def count_files(path: Path) -> int:
    if not path.exists() or not path.is_dir():
        return 0
    return sum(1 for item in path.rglob("*") if item.is_file())


def load_run_payload(paths: dict[str, Path]) -> dict[str, Any]:
    for key in ("meta", "run_json"):
        path = paths[key]
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                return {"metadata_error": f"invalid_json:{path}"}
    return {}


def validation_payload(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"exists": False, "ok": False, "path": str(path), "failures": ["missing"]}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"exists": True, "ok": False, "path": str(path), "failures": ["invalid_json"]}
    return {
        "exists": True,
        "ok": bool(data.get("ok")),
        "path": str(path),
        "failures": data.get("failures", []),
        "warnings": data.get("warnings", []),
    }


def stage_status_payload(run_dir: Path) -> dict[str, Any]:
    paths = artifact_paths(run_dir)
    inventory_size = file_size(paths["inventory"])
    report_size = file_size(paths["report"])
    web_raw_count = count_files(paths["web_raw"])
    opencli_raw_count = count_files(paths["opencli_raw"])
    raw_count = count_files(paths["raw"])
    has_stage1_checkpoint = paths["stage1_checkpoint"].exists()
    has_stage2_checkpoint = paths["stage2_checkpoint"].exists()
    inv_validation = validation_payload(paths["validate_inventory"])
    rep_validation = validation_payload(paths["validate_report"])

    if inventory_size == 0:
        next_stage = "stage1_collect_inventory"
        next_action = "Read writing.md to understand report questions, then build inventory.md and raw/ before writing the report."
    elif not inv_validation["ok"]:
        next_stage = "stage1_validate_inventory"
        next_action = "Run validate-inventory and fix collection gaps before creating the Stage 1 checkpoint."
    elif report_size == 0 and not has_stage1_checkpoint:
        next_stage = "stage1_checkpoint"
        next_action = "Create the Stage 1 checkpoint from the validated frozen inventory."
    elif report_size == 0:
        next_stage = "stage2_write_report"
        next_action = "Resume in a fresh context if needed and write report.md from the frozen inventory."
    elif not rep_validation["ok"]:
        next_stage = "stage3_validate_report"
        next_action = "Run validate-report and fix structural or evidence-relative report failures."
    elif not has_stage2_checkpoint:
        next_stage = "stage3_checkpoint"
        next_action = "Create the Stage 2 checkpoint from the validated report before export."
    else:
        next_stage = "stage4_export"
        next_action = "Export the canonical report.md to the selected ready delivery targets and hand off paths/URLs."

    return {
        "run_dir": str(run_dir),
        "metadata": load_run_payload(paths),
        "artifacts": {
            "inventory_path": str(paths["inventory"]),
            "inventory_exists": paths["inventory"].exists(),
            "inventory_size": inventory_size,
            "report_path": str(paths["report"]),
            "report_exists": paths["report"].exists(),
            "report_size": report_size,
            "raw_dir": str(paths["raw"]),
            "raw_file_count": raw_count,
            "web_raw_file_count": web_raw_count,
            "opencli_raw_file_count": opencli_raw_count,
            "source_log_exists": paths["source_log"].exists(),
            "stage1_checkpoint_exists": has_stage1_checkpoint,
            "stage2_checkpoint_exists": has_stage2_checkpoint,
            "validate_inventory": inv_validation,
            "validate_report": rep_validation,
        },
        "next_stage": next_stage,
        "next_action": next_action,
    }


def cmd_stage_status(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir).expanduser()
    print(json.dumps(stage_status_payload(run_dir), indent=2, ensure_ascii=False))
    return 0


# ----------------------------------------------------------------------------
# checkpoint: write checkpoint_stage*.md handoff between Phase 1→2 / Phase 2→4
# ----------------------------------------------------------------------------

def checkpoint_text(run_dir: Path, stage: str) -> str:
    payload = stage_status_payload(run_dir)
    artifacts = payload["artifacts"]
    if stage == "stage1":
        if artifacts["inventory_size"] == 0:
            raise ValueError("Cannot create Stage 1 checkpoint before inventory.md exists and is non-empty.")
        if not artifacts["validate_inventory"]["ok"]:
            raise ValueError("Cannot create Stage 1 checkpoint before validate-inventory passes.")
        checkpoint_next_stage = "stage2_write_report"
        instruction = (
            "Continue product-swipefile from this run_dir. Start Stage 2 only: "
            "read references/writing.md, use the frozen inventory.md as the primary context, "
            "open raw artifacts only through targeted snippets, write report.md section by section, "
            "then run validate-report. Do not recollect evidence unless writing reveals an essential collectible gap."
        )
    elif stage == "stage2":
        if artifacts["report_size"] == 0:
            raise ValueError("Cannot create Stage 2 checkpoint before report.md exists and is non-empty.")
        if not artifacts["validate_report"]["ok"]:
            raise ValueError("Cannot create Stage 2 checkpoint before validate-report passes.")
        checkpoint_next_stage = "stage4_export"
        instruction = (
            "Continue product-swipefile from this run_dir. Start Stage 4 only: "
            "export the canonical report.md to the selected ready delivery targets, verify each export, "
            "and hand off report locations, run_dir, inventory/report/meta/raw paths, validation results, and export failures."
        )
    else:
        raise ValueError("stage must be stage1 or stage2")

    lines = [
        f"# Product Swipefile {stage.upper()} Checkpoint",
        "",
        f"- run_dir: `{payload['run_dir']}`",
        f"- inventory: `{artifacts['inventory_path']}` ({artifacts['inventory_size']} bytes)",
        f"- report: `{artifacts['report_path']}` ({artifacts['report_size']} bytes)",
        f"- raw_dir: `{artifacts['raw_dir']}` ({artifacts['raw_file_count']} files)",
        f"- web_raw_file_count: `{artifacts['web_raw_file_count']}`",
        f"- opencli_raw_file_count: `{artifacts['opencli_raw_file_count']}`",
        f"- source_log_exists: `{artifacts['source_log_exists']}`",
        f"- validate_inventory_ok: `{artifacts['validate_inventory']['ok']}`",
        f"- validate_report_ok: `{artifacts['validate_report']['ok']}`",
        f"- checkpoint_next_stage: `{checkpoint_next_stage}`",
        "",
        "## Continuation Instruction",
        "",
        instruction,
        "",
    ]
    return "\n".join(lines)


def cmd_checkpoint(args: argparse.Namespace) -> int:
    run_dir = Path(args.run_dir).expanduser()
    try:
        text = checkpoint_text(run_dir, args.stage)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    output_path = run_dir / f"checkpoint_{args.stage}.md"
    should_write = not getattr(args, "no_write", False)
    if should_write:
        output_path.write_text(text, encoding="utf-8")
    print(text)
    if should_write:
        print(f"Checkpoint written: {output_path}")
    return 0


# ----------------------------------------------------------------------------
# check-tools: diagnostic dump (settings state + opencli availability)
# ----------------------------------------------------------------------------

def cmd_check_tools(_: argparse.Namespace) -> int:
    settings = load_json(DEFAULT_SETTINGS_PATH)
    notion_token_env = settings.get("notion", {}).get("token_env") or "NOTION_TOKEN"
    setup_missing = validate_setup_requirements(settings)
    result = {
        "settings_path": str(DEFAULT_SETTINGS_PATH),
        "settings_exists": DEFAULT_SETTINGS_PATH.exists(),
        "setup_completed": bool(settings.get("setup", {}).get("completed")),
        "setup_ready": not setup_missing,
        "setup_missing": setup_missing,
        "language": settings.get("language", ""),
        "default_targets": settings.get("default_targets", []),
        "tools": {
            "python3": check_command("python3", ["--version"]),
            "opencli": check_command("opencli", ["--help"]),
        },
        "integrations": {
            "local_markdown": {
                "configured": bool(settings.get("local_markdown", {}).get("directory")),
                "directory": settings.get("local_markdown", {}).get("directory", ""),
            },
            "obsidian": {
                "configured": bool(settings.get("obsidian", {}).get("vault_path")),
                "vault_path": settings.get("obsidian", {}).get("vault_path", ""),
                "vault_exists": Path(settings.get("obsidian", {}).get("vault_path", "")).expanduser().exists()
                if settings.get("obsidian", {}).get("vault_path")
                else False,
            },
            "notion": {
                "configured": bool(settings.get("notion", {}).get("parent_id")),
                "token_env": notion_token_env,
                "token_available": bool(os.environ.get(notion_token_env)),
                "ready": bool(settings.get("notion", {}).get("parent_id"))
                and bool(os.environ.get(notion_token_env)),
            },
            "lark": {
                "configured": bool(settings.get("lark", {}).get("staging_dir")),
                "mode": settings.get("lark", {}).get("mode", "connector"),
                "connector_ready": bool(settings.get("lark", {}).get("connector_ready")),
                "staging_dir": settings.get("lark", {}).get("staging_dir", ""),
                "ready": bool(settings.get("lark", {}).get("connector_ready")),
            },
            "feishu": {
                "configured": bool(settings.get("feishu", {}).get("staging_dir")),
                "mode": settings.get("feishu", {}).get("mode", "connector"),
                "connector_ready": bool(settings.get("feishu", {}).get("connector_ready")),
                "staging_dir": settings.get("feishu", {}).get("staging_dir", ""),
                "ready": bool(settings.get("feishu", {}).get("connector_ready")),
            },
        },
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0
