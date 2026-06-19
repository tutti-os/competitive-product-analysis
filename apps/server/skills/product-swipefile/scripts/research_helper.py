#!/usr/bin/env python3
"""CLI entry point for the product-swipefile helper.

Run with: python3 scripts/research_helper.py <command> [args]
Use `--help` on the top-level command or any subcommand to see options.

This file is the argparse dispatcher. Each subcommand handler lives in the
product_research/ package, grouped by concern:

    lib.py         shared constants + utility helpers (no commands)
    validators.py  validate-inventory, validate-report (the quality gates)
    runs.py        new-run, stage-status, checkpoint, check-tools (run lifecycle)
    settings.py    show-settings, init-settings (persistent config)
    opencli.py     opencli-check, opencli-run (channel collection wrappers)
    exporters.py   export (local_markdown / obsidian / notion / feishu / lark)
"""
from __future__ import annotations

import argparse
import sys

from product_research.exporters import cmd_export
from product_research.opencli import cmd_opencli_check, cmd_opencli_run
from product_research.runs import cmd_check_tools, cmd_checkpoint, cmd_new_run, cmd_stage_status
from product_research.settings import cmd_init_settings, cmd_show_settings
from product_research.validators import cmd_validate_inventory, cmd_validate_report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Helper for product-swipefile")
    sub = parser.add_subparsers(dest="command", required=True)

    # ---- run lifecycle ----
    check = sub.add_parser("check-tools", help="Diagnostic: settings state + opencli availability")
    check.set_defaults(func=cmd_check_tools)

    new_run = sub.add_parser("new-run", help="Create a unique run directory with empty artifacts")
    new_run.add_argument("--product", required=True)
    new_run.add_argument("--root", help="Optional artifact root. Defaults to ~/.config/product-swipefile/runs.")
    new_run.add_argument("--run-id", help="Optional stable run id. Defaults to a UTC timestamp.")
    new_run.add_argument("--dry-run", action="store_true")
    new_run.set_defaults(func=cmd_new_run)

    stage_status = sub.add_parser("stage-status", help="Inspect a run dir and report the next stage")
    stage_status.add_argument("--run-dir", required=True)
    stage_status.set_defaults(func=cmd_stage_status)

    checkpoint = sub.add_parser("checkpoint", help="Write a checkpoint_stage*.md handoff file")
    checkpoint.add_argument("--run-dir", required=True)
    checkpoint.add_argument("--stage", required=True, choices=["stage1", "stage2"])
    checkpoint.add_argument("--no-write", action="store_true", help="Print checkpoint text without writing the file.")
    checkpoint.set_defaults(func=cmd_checkpoint)

    # ---- quality gates ----
    validate_inventory = sub.add_parser("validate-inventory", help="Run consistency gates on an inventory.md")
    validate_inventory.add_argument("--inventory", required=True)
    validate_inventory.set_defaults(func=cmd_validate_inventory)

    validate_report = sub.add_parser("validate-report", help="Run contract + no-table-dump gates on a report.md")
    validate_report.add_argument("--report", required=True)
    validate_report.add_argument("--inventory")
    validate_report.set_defaults(func=cmd_validate_report)

    # ---- opencli wrappers ----
    opencli_check = sub.add_parser("opencli-check", help="Check opencli availability (overall or per platform)")
    opencli_check.add_argument("--platform", help="Optional platform to check with `opencli <platform> --help`.")
    opencli_check.add_argument("--timeout", type=int, default=8)
    opencli_check.set_defaults(func=cmd_opencli_check)

    opencli_run = sub.add_parser("opencli-run", help="Run an opencli search for a platform and cache stdout/stderr")
    opencli_run.add_argument("--platform", required=True)
    opencli_run.add_argument("--query")
    opencli_run.add_argument("--raw-dir", required=True)
    opencli_run.add_argument("--purpose")
    opencli_run.add_argument("--timeout", type=int, default=30)
    opencli_run.add_argument("--dry-run", action="store_true")
    opencli_run.set_defaults(func=cmd_opencli_run)

    # ---- settings ----
    show = sub.add_parser("show-settings", help="Print current settings.json")
    show.add_argument("--path")
    show.set_defaults(func=cmd_show_settings)

    init = sub.add_parser("init-settings", help="Write or update settings.json")
    init.add_argument("--path")
    init.add_argument("--complete-setup", action="store_true")
    init.add_argument("--language")
    init.add_argument("--default-targets", help="One target or multiple targets separated by + or comma.")
    init.add_argument("--local-markdown-dir")
    init.add_argument("--obsidian-vault")
    init.add_argument("--obsidian-folder")
    init.add_argument("--notion-token-env")
    init.add_argument("--notion-parent-type", choices=["page_id", "database_id"])
    init.add_argument("--notion-parent-id")
    init.add_argument("--notion-title-property")
    init.add_argument("--lark-staging-dir")
    init.add_argument("--lark-connector-ready", action="store_true")
    init.add_argument("--feishu-staging-dir")
    init.add_argument("--feishu-connector-ready", action="store_true")
    init.set_defaults(func=cmd_init_settings)

    # ---- export ----
    export = sub.add_parser("export", help="Export canonical report.md to selected delivery target(s)")
    export.add_argument("--input", required=True)
    export.add_argument("--title", required=True)
    export.add_argument("--target", help="One target or multiple targets separated by + or comma.")
    export.add_argument("--settings")
    export.add_argument("--dry-run", action="store_true")
    export.add_argument("--overwrite", action="store_true")
    export.add_argument("--local-markdown-dir")
    export.add_argument("--obsidian-vault")
    export.add_argument("--obsidian-folder")
    export.add_argument("--notion-token-env")
    export.add_argument("--notion-parent-type", choices=["page_id", "database_id"])
    export.add_argument("--notion-parent-id")
    export.add_argument("--notion-title-property")
    export.add_argument("--lark-staging-dir")
    export.add_argument("--feishu-staging-dir")
    export.set_defaults(func=cmd_export)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
