"""Shared library: paths, settings shape, token vocabularies, and utility helpers.

This module has no project-internal dependencies. Everything else in
product_research/ depends on lib for constants and small utility functions.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

# ============================================================================
# Paths and settings shape
# ============================================================================

CONFIG_DIR = Path.home() / ".config" / "product-swipefile"
DEFAULT_SETTINGS_PATH = CONFIG_DIR / "settings.json"
DEFAULT_RUNS_DIR = CONFIG_DIR / "runs"
VALID_TARGETS = {"local_markdown", "obsidian", "notion", "lark", "feishu"}

# Default settings.json shape. Aligned with references/delivery.md.
DEFAULT_SETTINGS: dict[str, Any] = {
    "setup": {"completed": False},
    "language": "",
    "default_targets": [],
    "local_markdown": {"directory": ""},
    "obsidian": {"vault_path": "", "folder": ""},
    "notion": {"token_env": "NOTION_TOKEN", "parent_type": "", "parent_id": "", "title_property": "Name"},
    "lark": {
        "workspace": "lark", "mode": "connector", "connector_ready": False,
        "staging_dir": "~/.config/product-swipefile/exports/lark",
    },
    "feishu": {
        "workspace": "feishu", "mode": "connector", "connector_ready": False,
        "staging_dir": "~/.config/product-swipefile/exports/feishu",
    },
}

# ============================================================================
# Token vocabularies (controlled — parsed by validators; not prose)
# Aligned with references/inventory.md.
# ============================================================================

FACT_STATUS_TOKENS = {"verified", "uncertain", "inferred", "estimated"}
MISSING_STATUS_TOKENS = {
    "not_public", "not_found", "unavailable", "blocked",
    "login_required", "syntax_unknown", "not_checked", "not_applicable",
}
PLAN_STATUS_TOKENS = {"pending", "done"}
AD_STATUS_TOKENS = {
    "active_ads_found", "historical_ads_found",
    "no_public_ads_found", "library_unavailable",
}
EVIDENCE_STATUS_TOKENS = FACT_STATUS_TOKENS | MISSING_STATUS_TOKENS | AD_STATUS_TOKENS

READINESS_TOKENS = {"ready", "thin_but_explained", "collection_gap", "not_applicable"}
ALL_STATUS_TOKENS = EVIDENCE_STATUS_TOKENS | PLAN_STATUS_TOKENS | READINESS_TOKENS
REPORT_SECTION_IDS = tuple(str(idx) for idx in range(17))

# ============================================================================
# OpenCLI command map (mirrors references/inventory.md examples; the .md is
# authoritative for the model when this map disagrees)
# ============================================================================

OPENCLI_COMMANDS: dict[str, list[str]] = {
    "twitter": ["opencli", "twitter", "search", "{query}"],
    "x": ["opencli", "twitter", "search", "{query}"],
    "youtube": ["opencli", "youtube", "search", "{query}"],
    "tiktok": ["opencli", "tiktok", "search", "{query}"],
    "instagram": ["opencli", "instagram", "search", "{query}"],
    "reddit": ["opencli", "reddit", "search", "{query}"],
    "hackernews": ["opencli", "hackernews", "search", "{query}"],
    "producthunt": ["opencli", "producthunt", "posts"],
    "xiaohongshu": ["opencli", "xiaohongshu", "search", "{query}"],
    "bilibili": ["opencli", "bilibili", "search", "{query}"],
    "douyin": ["opencli", "douyin", "hashtag", "search", "--keyword", "{query}"],
    "zhihu": ["opencli", "zhihu", "search", "{query}"],
    "weibo": ["opencli", "weibo", "search", "{query}"],
}

OPENCLI_HELP_PLATFORMS = sorted({key for key in OPENCLI_COMMANDS if key != "x"} | {"linkedin", "weixin"})

# ============================================================================
# Inventory / report section aliases (used by validators to detect sections)
# ============================================================================

INVENTORY_SECTION_ALIASES: dict[str, list[str]] = {
    "产品身份": ["产品身份", "Product Identity", "研究对象"],
    "竞品边界": ["竞品边界", "Competitor Boundary", "竞争边界"],
    "研究计划": ["研究计划", "Research Plan", "证据地图"],
    "宽索引": ["宽索引", "Wide Index", "广泛索引"],
    "深度证据": ["深度证据", "Deep Evidence"],
    "标准化事实": ["标准化事实", "Facts Normalized"],
    "传播事件簇": ["传播事件簇", "Campaign Clusters", "事件簇"],
    "缺口检查": ["缺口检查", "Gap Check", "覆盖缺口"],
}

REPORT_REQUIRED_SECTIONS = {
    "key_findings": ["调研核心发现", "核心发现", "counterintuitive", "non-obvious", "反常识", "非显而易见"],
    "0": ["data snapshot", "数据快照"],
    "1": ["brand positioning", "品牌定位"],
    "2": ["competitive baseline", "竞品基准", "竞争基准"],
    "3": ["product virality", "product signals", "产品本身", "传播力", "亮点功能"],
    "4": ["cold start", "冷启动"],
    "5": ["growth path", "增长路径"],
    "6": ["core user", "用户画像"],
    "7": ["monetization", "商业化"],
    "8": ["communication roadmap", "传播 roadmap", "传播路线", "沟通"],
    "9": ["influencer", "creator", "kol", "koc", "创作者", "影响者"],
    "10": ["official content", "官方内容", "官方渠道"],
    "11": ["advertising", "广告"],
    "12": ["trust", "信任"],
    "13": ["retention", "留存"],
    "14": ["china", "global", "中国"],
    "15": ["notable absences", "重要缺口", "notable absence"],
    "16": ["transferable", "可借鉴", "可迁移"],
}

CHINESE_SECTION_NUMBERS = {
    "〇": "0", "零": "0",
    "一": "1", "二": "2", "三": "3", "四": "4", "五": "5",
    "六": "6", "七": "7", "八": "8", "九": "9",
    "十": "10", "十一": "11", "十二": "12", "十三": "13",
    "十四": "14", "十五": "15", "十六": "16",
}


# ============================================================================
# Utility helpers: JSON / filesystem / text / validation payloads
# ============================================================================

def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return json.loads(json.dumps(DEFAULT_SETTINGS))
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    settings = json.loads(json.dumps(DEFAULT_SETTINGS))
    data = {key: value for key, value in data.items() if key in DEFAULT_SETTINGS}
    deep_merge(settings, data)
    return settings


def deep_merge(base: dict[str, Any], incoming: dict[str, Any]) -> None:
    for key, value in incoming.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            deep_merge(base[key], value)
        else:
            base[key] = value


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def check_command(command: str, args: list[str], timeout: int = 8) -> dict[str, Any]:
    path = shutil.which(command)
    if not path:
        return {"available": False, "path": None, "status": "missing", "detail": ""}
    try:
        result = subprocess.run(
            [command, *args],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout, check=False,
        )
    except subprocess.TimeoutExpired:
        return {"available": True, "path": path, "status": "timeout", "detail": ""}
    except OSError as exc:
        return {"available": True, "path": path, "status": "error", "detail": str(exc)}
    output = (result.stdout or result.stderr or "").strip().splitlines()
    return {
        "available": result.returncode == 0,
        "path": path,
        "status": "ok" if result.returncode == 0 else "error",
        "exit_code": result.returncode,
        "detail": output[0] if output else "",
    }


def safe_slug(value: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    clean = clean.strip("-._")
    return clean[:80] or "opencli"


def safe_product_slug(value: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip().lower())
    clean = clean.strip("-._")
    return clean[:80] or "product"


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def has_any(text: str, needles: list[str] | set[str]) -> bool:
    normalized = normalize_text(text)
    return any(needle.lower() in normalized for needle in needles)


def has_table(text: str) -> bool:
    return bool(re.search(r"^\s*\|.+\|\s*$", text, flags=re.MULTILINE))


def evidence_statuses_in(text: str) -> set[str]:
    normalized = normalize_text(text)
    return {status for status in EVIDENCE_STATUS_TOKENS if status in normalized}


def validation_payload(kind: str, path: Path, failures: list[str], warnings: list[str]) -> dict[str, Any]:
    return {
        "kind": kind,
        "path": str(path),
        "ok": not failures,
        "failures": failures,
        "warnings": warnings,
    }


def print_validation(kind: str, path: Path, failures: list[str], warnings: list[str]) -> int:
    print(json.dumps(validation_payload(kind, path, failures, warnings), indent=2, ensure_ascii=False))
    return 1 if failures else 0


def sanitize_filename(title: str) -> str:
    clean = re.sub(r"[\\/:*?\"<>|\n\r\t]+", " ", title).strip()
    clean = re.sub(r"\s+", " ", clean)
    return clean[:120] or "research-report"


def next_available_path(path: Path, overwrite: bool) -> Path:
    if overwrite or not path.exists():
        return path
    stem, suffix = path.stem, path.suffix
    for idx in range(2, 1000):
        candidate = path.with_name(f"{stem} {idx}{suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Too many existing files similar to {path}")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def verify_written_file(path: Path, content: str, label: str) -> bool:
    if not path.exists():
        print(f"{label} export failed verification: file does not exist: {path}", file=sys.stderr)
        return False
    if path.read_text(encoding="utf-8") != content:
        print(f"{label} export failed verification: written content differs from source: {path}", file=sys.stderr)
        return False
    return True
