#!/usr/bin/env python3
"""Headless launcher for product-swipefile, targeting the Claude model.

The skill content (SKILL.md + references/) is model-aware: it is written for
Claude. This launcher drives a `claude -p` headless subprocess so quality
artifacts are produced under the same operational guarantees the skill assumes.

Runtime-agnostic of Claude Code itself: any host that can spawn `claude` from
PATH works (Claude Code's terminal, a plain shell, OpenCode wrapping the
Anthropic API via a `claude`-compatible CLI, etc.). For runtimes without a
Claude CLI, the skill files can still be read directly by an agent — but this
launcher's operational guarantees (tool whitelist, two-stage isolation,
external validation) won't apply.

Usage:
    ./run.py "<product name>" [--language zh|en] [--timeout 5400]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

STAGE1_ALLOWED_TOOLS = "Bash Read Write Edit WebSearch WebFetch"
STAGE2_ALLOWED_TOOLS = "Bash Read Write Edit"  # no WebSearch/WebFetch in Stage 2

STAGE1_PROMPT = """You are running product-swipefile Stage 1 in a headless session.
Do not enter interactive mode. Do not wait for further input. Do not ask setup questions.

Task: build the evidence inventory for "{product}" in {language}.

Read and follow:
- Skill entry: {skill_md}
- Inventory spec: {inventory_ref}
- Writing spec only to understand the report questions: {writing_ref}

Use these exact paths. Do not derive your own paths and do not modify persistent settings:
- inventory.md: {inventory_path}
- report.md:    {report_path} (do not write this in Stage 1)
- raw cache:    {raw_dir}/
- meta.json:    {meta_path}

Stage 1 contract:
1. Read writing.md first and derive which evidence each report section needs.
2. Collect public evidence into raw/web and raw/opencli where possible.
3. Do not mark an unknown field as not_public or not_found after a single weak search. Try the relevant distinct source families named in Research Plan first, or explain why the remaining families are unavailable, blocked, login_required, not_applicable, or unsafe to access. Do not skip an entire applicable evidence family.
4. Preserve evidence granularity. For evidence-rich products, keep product nodes, competitors, creators, official channels, user quotes, metrics, source status, and raw pointers distinct instead of merging them into summaries. For sparse products, write narrow evidence limits instead of padding.
5. Write inventory.md with Product Identity, Competitor Boundary, Research Plan, coverage status, Wide Index, Deep Evidence, Facts Normalized, Campaign Clusters, Gap Check, and Inventory Readiness.
6. Resolve every applicable Research Plan row to done or an explicit terminal status. Do not leave pending.
7. Do not write report.md.

When inventory.md is complete, print exactly this on stdout as the last line and exit:
PRODUCT_STAGE1_DONE: {run_dir}
"""

STAGE2_PROMPT = """You are running product-swipefile Stage 2 in a fresh headless session.
Do not enter interactive mode. Do not wait for further input. Do not ask setup questions.

Task: write the final product research report for "{product}" in {language}.

Read and follow:
- Skill entry: {skill_md}
- Writing spec: {writing_ref}
- Delivery spec only for canonical markdown behavior: {delivery_ref}

Use these exact paths:
- frozen inventory.md: {inventory_path}
- report.md:          {report_path}
- raw cache:          {raw_dir}/
- stage1 checkpoint:  {checkpoint_path}

Stage 2 contract:
1. Treat inventory.md as frozen. Do not use WebSearch or WebFetch. Do not add facts that are not in inventory.md or cited raw files.
2. Before writing each section, derive that section's required output shapes from writing.md. Render required matrices, candidate pools, Roadmap detail blocks, ad check tables, and Notable Absence item blocks when applicable. If evidence is limited, keep the required shape and fill missing cells with status tokens plus explanation; do not silently shrink or merge required artifacts.
3. Write report.md section by section according to writing.md.
4. Do not copy inventory tables as analysis. Every table-heavy section needs text that explains what the evidence means for that section's question.
5. Preserve evidence granularity in prose. Do not collapse traceable details into generic summaries when the inventory contains the underlying evidence; do not pad sparse sections when the inventory explicitly limits the claim.
6. If writing exposes an essential collectible gap, write stage2_collection_gap.md explaining the missing evidence and stop instead of inventing or silently shrinking the report.
7. Do not export to cloud targets in this launcher run; report.md is the canonical markdown output.

When report.md is complete, print exactly this on stdout as the last line and exit:
PRODUCT_STAGE2_DONE: {run_dir}
"""


@dataclass
class AgentRun:
    stage: str
    exit_code: int
    elapsed: int
    timed_out: bool
    marker_seen: bool


def _run_helper(helper: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["python3", str(helper), *args],
        capture_output=True, text=True, check=check,
    )


def _json_ok(text: str) -> bool:
    try:
        return bool(json.loads(text).get("ok"))
    except Exception:
        return False


def _run_agent(*, claude_bin: str, prompt: str, allowed_tools: str, timeout: int,
               cwd: Path, log_path: Path, marker: str) -> AgentRun:
    start = time.time()
    timed_out = False
    exit_code = -1
    output = ""
    try:
        proc = subprocess.run(
            [claude_bin, "-p", prompt, "--allowedTools", allowed_tools],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            timeout=timeout, cwd=str(cwd),
            env={**os.environ, "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"},
        )
        output = proc.stdout or ""
        exit_code = proc.returncode
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        output = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout.decode() if exc.stdout else "")
        output += f"\n[TIMEOUT after {timeout}s]\n"
    log_path.write_text(output, encoding="utf-8")
    return AgentRun(
        stage=marker.split("_DONE", 1)[0].lower(),
        exit_code=exit_code,
        elapsed=int(time.time() - start),
        timed_out=timed_out,
        marker_seen=marker in output,
    )


def _write_validation(run_dir: Path, name: str, proc: subprocess.CompletedProcess) -> bool:
    (run_dir / f"{name}.json").write_text(proc.stdout or "", encoding="utf-8")
    return _json_ok(proc.stdout or "")


def main() -> int:
    p = argparse.ArgumentParser(description="Headless launcher for product-swipefile (Claude model)")
    p.add_argument("product", help="Product name to research")
    p.add_argument("--language", default="zh", choices=["zh", "en"])
    p.add_argument("--timeout", type=int, default=5400, help="Seconds per stage; default 5400 = 90 min")
    p.add_argument("--claude-bin", default="claude", help="Path to the `claude` CLI binary")
    args = p.parse_args()

    skill_dir = Path(__file__).resolve().parent
    skill_md = skill_dir / "SKILL.md"
    helper = skill_dir / "scripts" / "research_helper.py"
    inventory_ref = skill_dir / "references" / "inventory.md"
    writing_ref = skill_dir / "references" / "writing.md"
    delivery_ref = skill_dir / "references" / "delivery.md"

    for path, label in [(skill_md, "SKILL.md"), (helper, "scripts/research_helper.py"),
                        (inventory_ref, "references/inventory.md"),
                        (writing_ref, "references/writing.md"),
                        (delivery_ref, "references/delivery.md")]:
        if not path.exists():
            sys.exit(f"[run] {label} not found at {path}")
    if not shutil.which(args.claude_bin):
        sys.exit(f"[run] `{args.claude_bin}` not in PATH. This launcher targets Claude — install the `claude` CLI or pass --claude-bin.")

    print(f"[run] Creating run dir for '{args.product}'...")
    new_run = _run_helper(helper, "new-run", "--product", args.product)
    run_info = json.loads(new_run.stdout)
    run_dir = Path(run_info["artifact_dir"])
    inv_path = Path(run_info["inventory_path"])
    rep_path = Path(run_info["report_path"])
    print(f"[run] run_dir: {run_dir}")

    # --- Stage 1: collection ---
    stage1_prompt = STAGE1_PROMPT.format(
        product=args.product, language=args.language,
        skill_md=skill_md, inventory_ref=inventory_ref, writing_ref=writing_ref,
        inventory_path=inv_path, report_path=rep_path,
        raw_dir=run_info["raw_dir"], meta_path=run_info["meta_path"],
        run_dir=run_dir,
    )
    (run_dir / "launcher_stage1_prompt.md").write_text(stage1_prompt, encoding="utf-8")
    print(f"[run] Stage 1: collect inventory (timeout {args.timeout}s)...")
    stage1 = _run_agent(
        claude_bin=args.claude_bin, prompt=stage1_prompt,
        allowed_tools=STAGE1_ALLOWED_TOOLS, timeout=args.timeout,
        cwd=skill_dir, log_path=run_dir / "launcher_stage1.log",
        marker="PRODUCT_STAGE1_DONE",
    )

    v_inv = _run_helper(helper, "validate-inventory", "--inventory", str(inv_path), check=False)
    inv_ok = _write_validation(run_dir, "validate-inventory", v_inv)

    if stage1.exit_code != 0 or not inv_ok:
        print(f"❌ Stage 1 failed — inventory not frozen (validate ok={inv_ok})")
        print(f"  run_dir:    {run_dir}")
        print(f"  inventory:  {inv_path}")
        print(f"  log:        {run_dir / 'launcher_stage1.log'}")
        print(f"  elapsed:    {stage1.elapsed}s, exit={stage1.exit_code}, marker={stage1.marker_seen}")
        return 1

    checkpoint1 = _run_helper(helper, "checkpoint", "--run-dir", str(run_dir), "--stage", "stage1", check=False)
    (run_dir / "checkpoint_stage1.log").write_text(
        (checkpoint1.stdout or "") + (checkpoint1.stderr or ""), encoding="utf-8")

    # --- Stage 2: writing in a fresh headless context ---
    checkpoint_path = run_dir / "checkpoint_stage1.md"
    stage2_prompt = STAGE2_PROMPT.format(
        product=args.product, language=args.language,
        skill_md=skill_md, writing_ref=writing_ref, delivery_ref=delivery_ref,
        inventory_path=inv_path, report_path=rep_path,
        raw_dir=run_info["raw_dir"], checkpoint_path=checkpoint_path,
        run_dir=run_dir,
    )
    (run_dir / "launcher_stage2_prompt.md").write_text(stage2_prompt, encoding="utf-8")
    print(f"[run] Stage 2: write report from frozen inventory (timeout {args.timeout}s)...")
    stage2 = _run_agent(
        claude_bin=args.claude_bin, prompt=stage2_prompt,
        allowed_tools=STAGE2_ALLOWED_TOOLS, timeout=args.timeout,
        cwd=skill_dir, log_path=run_dir / "launcher_stage2.log",
        marker="PRODUCT_STAGE2_DONE",
    )

    v_rep = _run_helper(helper, "validate-report",
                        "--report", str(rep_path), "--inventory", str(inv_path), check=False)
    rep_ok = _write_validation(run_dir, "validate-report", v_rep)

    success = stage1.exit_code == 0 and inv_ok and stage2.exit_code == 0 and rep_ok
    print()
    print("✅ done" if success else "❌ failed", f"— {args.product}")
    print(f"  run_dir:    {run_dir}")
    print(f"  inventory:  {inv_path}  (validate ok={inv_ok})")
    print(f"  report:     {rep_path}  (validate ok={rep_ok})")
    print(f"  stage1:     {stage1.elapsed}s, exit={stage1.exit_code}")
    print(f"  stage2:     {stage2.elapsed}s, exit={stage2.exit_code}")
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
