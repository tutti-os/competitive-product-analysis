"""OpenCLI wrappers: check availability and run platform-specific search commands.

Adds classified status reporting (login_required / blocked / syntax_unknown /
unavailable / done) by inspecting opencli's stdout/stderr.
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .lib import OPENCLI_COMMANDS, OPENCLI_HELP_PLATFORMS, check_command, safe_slug


def run_process(command: list[str], timeout: int) -> dict[str, Any]:
    if not shutil.which(command[0]):
        return {"returncode": None, "stdout": "", "stderr": "", "status": "unavailable", "detail": "opencli missing"}
    try:
        result = subprocess.run(
            command,
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "returncode": None,
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "",
            "status": "blocked",
            "detail": f"timeout after {timeout}s",
        }
    except OSError as exc:
        return {"returncode": None, "stdout": "", "stderr": str(exc), "status": "unavailable", "detail": str(exc)}
    combined = f"{result.stdout}\n{result.stderr}".lower()
    if result.returncode == 0:
        return {
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "status": "done",
            "detail": "",
        }
    if any(token in combined for token in ["login", "sign in", "signin", "auth", "cookie", "session"]):
        status = "login_required"
    elif any(token in combined for token in ["captcha", "forbidden", "403", "blocked", "rate limit", "too many requests"]):
        status = "blocked"
    elif any(token in combined for token in ["unknown command", "invalid command", "usage:", "no such command"]):
        status = "syntax_unknown"
    else:
        status = "unavailable"
    return {
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "status": status,
        "detail": f"exit_{result.returncode}: {first_nonempty_line(result.stderr) or first_nonempty_line(result.stdout)}",
    }


def first_nonempty_line(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ""


def summarize_opencli_output(stdout: str, stderr: str, limit: int = 500) -> str:
    text = "\n".join(part.strip() for part in [stdout, stderr] if part.strip())
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    return text[:limit]


def opencli_follow_up(status: str) -> str:
    if status == "done":
        return "Review raw output, promote useful hits to Wide Index or Deep Evidence."
    if status == "login_required":
        return "Record login_required and use WebSearch/WebFetch fallback."
    if status == "blocked":
        return "Record blocked and use WebSearch/WebFetch or cached/public alternatives."
    if status == "syntax_unknown":
        return "Run platform help manually or record syntax_unknown if no safe command is available."
    if status == "unavailable":
        return "Record unavailable and use WebSearch/WebFetch fallback."
    return "Record command failure and use fallback evidence collection."


def cmd_opencli_check(args: argparse.Namespace) -> int:
    base = check_command("opencli", ["--help"], timeout=args.timeout)
    result: dict[str, Any] = {
        "opencli": base,
        "platforms_checked": {},
        "suggested_platforms": OPENCLI_HELP_PLATFORMS,
    }
    platforms = [args.platform] if args.platform else []
    for platform in platforms:
        platform_key = platform.lower()
        result["platforms_checked"][platform_key] = check_command("opencli", [platform_key, "--help"], timeout=args.timeout)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def cmd_opencli_run(args: argparse.Namespace) -> int:
    platform = args.platform.lower()
    template = OPENCLI_COMMANDS.get(platform)
    raw_dir = Path(args.raw_dir).expanduser()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base_name = f"{timestamp}_{safe_slug(platform)}_{safe_slug(args.purpose or 'search')}"
    stdout_path = raw_dir / f"{base_name}.stdout.txt"
    stderr_path = raw_dir / f"{base_name}.stderr.txt"
    if not template:
        print(
            json.dumps(
                {
                    "platform": platform,
                    "query": args.query,
                    "status": "syntax_unknown",
                    "hit_summary": "",
                    "follow_up": "No standard helper command is defined for this platform; run platform help manually.",
                    "supported_platforms": sorted(OPENCLI_COMMANDS),
                },
                indent=2, ensure_ascii=False,
            )
        )
        return 0
    if "{query}" in template and not args.query:
        print(f"--query is required for platform {platform}", file=sys.stderr)
        return 2
    command = [part.format(query=args.query or "") for part in template]
    if args.dry_run:
        payload = {
            "platform": platform,
            "purpose": args.purpose or "search",
            "query": args.query,
            "command": shlex.join(command),
            "status": "dry_run",
            "exit_code": None,
            "hit_summary": "",
            "follow_up": "Run the same command without --dry-run to collect evidence.",
            "stdout_path": "",
            "stderr_path": "",
            "dry_run": True,
        }
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0
    result = run_process(command, timeout=args.timeout)
    raw_dir.mkdir(parents=True, exist_ok=True)
    stdout_path.write_text(result.get("stdout", ""), encoding="utf-8")
    stderr_path.write_text(result.get("stderr", ""), encoding="utf-8")
    payload = {
        "platform": platform,
        "purpose": args.purpose or "search",
        "query": args.query,
        "command": shlex.join(command),
        "status": result["status"],
        "exit_code": result["returncode"],
        "hit_summary": summarize_opencli_output(result.get("stdout", ""), result.get("stderr", "")),
        "follow_up": opencli_follow_up(result["status"]),
        "stdout_path": str(stdout_path),
        "stderr_path": str(stderr_path),
        "dry_run": False,
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0
