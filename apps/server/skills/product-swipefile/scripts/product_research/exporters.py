from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .lib import DEFAULT_SETTINGS_PATH, load_json, next_available_path, read_text, sanitize_filename, verify_written_file
from .settings import parse_targets, targets_from_settings

def export_obsidian(args: argparse.Namespace, settings: dict[str, Any], content: str) -> int:
    vault = args.obsidian_vault or settings.get("obsidian", {}).get("vault_path")
    if not vault:
        print("Obsidian export requires a vault path.", file=sys.stderr)
        return 2
    folder = args.obsidian_folder
    if folder is None:
        folder = settings.get("obsidian", {}).get("folder") or ""
    base = Path(vault).expanduser()
    target_dir = base / folder if folder else base
    target = next_available_path(target_dir / f"{sanitize_filename(args.title)}.md", args.overwrite)
    if args.dry_run:
        print(json.dumps({"target": "obsidian", "path": str(target), "dry_run": True}, indent=2))
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    if not verify_written_file(target, content, "Obsidian"):
        return 1
    print(f"Wrote and verified Obsidian file: {target}")
    return 0

def export_local_markdown(args: argparse.Namespace, settings: dict[str, Any], content: str) -> int:
    directory = args.local_markdown_dir or settings.get("local_markdown", {}).get("directory")
    if not directory:
        print("Local Markdown export requires a directory.", file=sys.stderr)
        return 2
    base = Path(directory).expanduser()
    target = next_available_path(base / f"{sanitize_filename(args.title)}.md", args.overwrite)
    if args.dry_run:
        print(json.dumps({"target": "local_markdown", "path": str(target), "dry_run": True}, indent=2))
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    if not verify_written_file(target, content, "Local Markdown"):
        return 1
    print(f"Wrote and verified Local Markdown file: {target}")
    return 0

def chunk_text(text: str, limit: int = 1900) -> list[str]:
    chunks: list[str] = []
    current = ""
    for paragraph in text.split("\n\n"):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if len(paragraph) > limit:
            for idx in range(0, len(paragraph), limit):
                chunks.append(paragraph[idx : idx + limit])
            continue
        if len(current) + len(paragraph) + 2 > limit:
            if current:
                chunks.append(current)
            current = paragraph
        else:
            current = paragraph if not current else f"{current}\n\n{paragraph}"
    if current:
        chunks.append(current)
    return chunks

def notion_blocks_from_markdown(content: str) -> list[dict[str, Any]]:
    blocks = []
    for chunk in chunk_text(content):
        blocks.append(
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {"rich_text": [{"type": "text", "text": {"content": chunk}}]},
            }
        )
    return blocks

def notion_request(token: str, method: str, url: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
        },
        method=method,
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))

def chunks(items: list[dict[str, Any]], size: int) -> list[list[dict[str, Any]]]:
    return [items[idx : idx + size] for idx in range(0, len(items), size)]

def export_notion(args: argparse.Namespace, settings: dict[str, Any], content: str) -> int:
    notion = settings.get("notion", {})
    token_env = args.notion_token_env or notion.get("token_env") or "NOTION_TOKEN"
    token = os.environ.get(token_env)
    parent_type = args.notion_parent_type or notion.get("parent_type")
    parent_id = args.notion_parent_id or notion.get("parent_id")
    blocks = notion_blocks_from_markdown(content)
    if args.dry_run:
        missing = []
        if parent_type not in {"page_id", "database_id"}:
            missing.append("parent_type")
        if not parent_id:
            missing.append("parent_id")
        if not token:
            missing.append(f"${token_env}")
        print(
            json.dumps(
                {
                    "target": "notion",
                    "parent_type": parent_type,
                    "parent_id": parent_id,
                    "token_env": token_env,
                    "token_available": bool(token),
                    "block_count": len(blocks),
                    "dry_run": True,
                    "missing_for_real_export": missing,
                },
                indent=2,
            )
        )
        return 0
    if not token:
        print(f"Notion export requires ${token_env}.", file=sys.stderr)
        return 2
    if parent_type not in {"page_id", "database_id"} or not parent_id:
        print("Notion export requires parent_type page_id/database_id and parent_id.", file=sys.stderr)
        return 2
    body = {
        "parent": {parent_type: parent_id},
        "properties": {"title": {"title": [{"text": {"content": args.title}}]}},
        "children": blocks[:100],
    }
    if parent_type == "database_id":
        title_property = args.notion_title_property or notion.get("title_property") or "Name"
        body["parent"] = {"database_id": parent_id}
        body["properties"] = {title_property: {"title": [{"text": {"content": args.title}}]}}
    try:
        payload = notion_request(token, "POST", "https://api.notion.com/v1/pages", body)
        page_id = payload.get("id")
        if page_id:
            for batch in chunks(blocks[100:], 100):
                notion_request(
                    token,
                    "PATCH",
                    f"https://api.notion.com/v1/blocks/{page_id}/children",
                    {"children": batch},
                )
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        print(f"Notion API error {exc.code}: {detail}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Notion API connection error: {exc.reason}", file=sys.stderr)
        return 1
    page_ref = payload.get("url") or payload.get("id")
    if not page_ref:
        print("Notion API did not return a page URL or id; export is not verified.", file=sys.stderr)
        return 1
    print(f"Created and verified Notion page: {page_ref}")
    return 0

def export_lark_family(args: argparse.Namespace, settings: dict[str, Any], content: str, target_name: str) -> int:
    target_settings = settings.get(target_name, {})
    staging_dir = (
        args.lark_staging_dir
        if target_name == "lark" and args.lark_staging_dir
        else args.feishu_staging_dir
        if target_name == "feishu" and args.feishu_staging_dir
        else target_settings.get("staging_dir")
    )
    if not staging_dir:
        staging_dir = f"~/.config/product-swipefile/exports/{target_name}"
    base = Path(staging_dir).expanduser()
    target = next_available_path(base / f"{sanitize_filename(args.title)}.md", args.overwrite)
    payload = {
        "target": target_name,
        "mode": target_settings.get("mode", "connector"),
        "status": "staged_not_synced",
        "cloud_doc_created": False,
        "path": str(target),
        "note": "Helper fallback staged Markdown only. A Feishu/Lark connector must import it and return a document URL/token before cloud sync can be considered successful.",
    }
    if args.dry_run:
        payload["dry_run"] = True
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    if not verify_written_file(target, content, f"{target_name} staging"):
        return 1
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    # Exit code 3 = staged locally but NOT synced to the cloud doc. Distinct from
    # 0 (synced/written) so a caller checking only the exit code does not mistake
    # a connector-less fallback for a successful Feishu/Lark sync.
    return 3

def cmd_export(args: argparse.Namespace) -> int:
    settings_path = Path(args.settings).expanduser() if args.settings else DEFAULT_SETTINGS_PATH
    settings = load_json(settings_path)
    input_path = Path(args.input).expanduser()
    content = read_text(input_path)
    try:
        targets = parse_targets(args.target) if args.target is not None else targets_from_settings(settings)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if not targets:
        print(
            "No delivery target configured. Run init-settings with --default-targets or pass --target.",
            file=sys.stderr,
        )
        return 2
    status = 0
    for target in targets:
        if target == "local_markdown":
            result = export_local_markdown(args, settings, content)
        elif target == "obsidian":
            result = export_obsidian(args, settings, content)
        elif target == "notion":
            result = export_notion(args, settings, content)
        elif target == "lark":
            result = export_lark_family(args, settings, content, "lark")
        elif target == "feishu":
            result = export_lark_family(args, settings, content, "feishu")
        else:
            result = 2
        status = status or result
    return status
