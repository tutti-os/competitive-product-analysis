"""Internal-consistency gates: validate-inventory and validate-report.

Contains the markdown parsing helpers used by the gates, plus the gates
themselves. The gates use contract / consistency checks (no quotas) so that
sparse-but-honest runs pass and skeleton-or-self-contradictory runs fail.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from .lib import (
    AD_STATUS_TOKENS,
    CHINESE_SECTION_NUMBERS,
    EVIDENCE_STATUS_TOKENS,
    INVENTORY_SECTION_ALIASES,
    READINESS_TOKENS,
    REPORT_REQUIRED_SECTIONS,
    REPORT_SECTION_IDS,
    evidence_statuses_in,
    has_any,
    has_table,
    normalize_text,
    print_validation,
    read_text,
)

# ============================================================================
# Markdown parsing helpers (section detection, table parsing, text predicates)
# ============================================================================

_SEP_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$")


def heading_section_id(title: str) -> str | None:
    clean = title.strip().strip("#").strip()
    lowered = clean.lower()
    if any(alias in lowered for alias in REPORT_REQUIRED_SECTIONS["key_findings"]):
        return "key_findings"
    numeric = re.match(r"^(?:section\s*)?(\d{1,2})(?:[\s.．、:：-]|$)", lowered)
    if numeric:
        value = numeric.group(1)
        if value in REPORT_REQUIRED_SECTIONS:
            return value
    chinese_keys = sorted(CHINESE_SECTION_NUMBERS, key=len, reverse=True)
    for chinese in chinese_keys:
        if re.match(rf"^{re.escape(chinese)}(?:[、.．\s:：-]|$)", clean):
            return CHINESE_SECTION_NUMBERS[chinese]
    for section_id, aliases in REPORT_REQUIRED_SECTIONS.items():
        if section_id == "key_findings":
            continue
        if has_any(clean, aliases):
            return section_id
    return None


def markdown_sections(text: str) -> dict[str, str]:
    headings: list[tuple[int, int, str, str]] = []
    for match in re.finditer(r"^(#{1,6})\s+(.+?)\s*$", text, flags=re.MULTILINE):
        section_id = heading_section_id(match.group(2))
        if section_id:
            headings.append((match.start(), len(match.group(1)), match.group(2), section_id))
    sections: dict[str, str] = {}
    for idx, (start, level, _title, section_id) in enumerate(headings):
        end = len(text)
        for next_start, next_level, _next_title, _next_id in headings[idx + 1 :]:
            if next_level <= level:
                end = next_start
                break
        sections.setdefault(section_id, text[start:end].strip())
    return sections


def has_section_header(text: str, aliases: list[str] | set[str]) -> bool:
    """True if any markdown header line (# ...) contains one of the aliases.

    Stricter than has_any (whole-text substring): a section counts as present
    only when it appears as an actual heading, not when merely cross-referenced
    in a table row or sentence elsewhere.
    """
    needles = [alias.lower() for alias in aliases]
    for match in re.finditer(r"^#{1,6}\s+(.+?)\s*$", text, flags=re.MULTILINE):
        header = match.group(1).lower()
        if any(needle in header for needle in needles):
            return True
    return False


def section_has_evidence_limit(text: str) -> bool:
    return has_any(
        text,
        [
            "evidence limit", "verification gap", "cannot judge", "cannot verify",
            "证据不足", "不可验证", "不能判断", "无法判断",
            "未验证", "未找到", "不可访问",
            *EVIDENCE_STATUS_TOKENS,
        ],
    )


def section_has_platform_status(text: str) -> bool:
    return has_any(text, ["platform", "source", "checked", "status", "平台", "来源", "检查", "状态"]) and bool(
        evidence_statuses_in(text)
    )


def non_table_text(text: str) -> str:
    kept: list[str] = []
    in_code = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        if stripped.startswith("|"):
            continue
        if _SEP_RE.match(stripped):
            continue
        kept.append(line)
    return "\n".join(kept)


def has_interpretive_reading(text: str) -> bool:
    body = non_table_text(text)
    return has_any(
        body,
        [
            "judgment", "reading", "means", "indicates", "suggests", "therefore",
            "because", "inferred", "cannot infer", "cannot judge",
            "risk", "gap", "advantage", "weakness",
            "判断", "读数", "意味着", "说明", "因此", "因为",
            "推断", "不能推断", "不能判断", "风险", "缺口", "优势", "短板",
        ],
    )


def has_table_contract(text: str, header_groups: list[list[str]]) -> bool:
    if not has_table(text):
        return False
    normalized = normalize_text(text)
    return all(any(header.lower() in normalized for header in group) for group in header_groups)


def has_required_format_or_gap(text: str, header_groups: list[list[str]]) -> bool:
    return has_table_contract(text, header_groups) or section_has_platform_status(text) or section_has_evidence_limit(text)


def _split_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def parse_markdown_tables(text: str) -> list[tuple[list[str], list[list[str]]]]:
    """Return [(headers, rows)] for every markdown table. Cells are stripped strings."""
    tables: list[tuple[list[str], list[list[str]]]] = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("|") and i + 1 < len(lines) and _SEP_RE.match(lines[i + 1].strip()):
            headers = _split_row(line)
            rows: list[list[str]] = []
            j = i + 2
            while j < len(lines) and lines[j].strip().startswith("|") and not _SEP_RE.match(lines[j].strip()):
                rows.append(_split_row(lines[j]))
                j += 1
            tables.append((headers, rows))
            i = j
        else:
            i += 1
    return tables


def _header_index(headers: list[str], needles: list[str]) -> int | None:
    for idx, header in enumerate(headers):
        lowered = header.lower()
        if any(needle.lower() in lowered for needle in needles):
            return idx
    return None


def status_column_unfilled_rows(
    text: str,
    table_header_needles: list[str],
    key_col_needles: list[str],
    status_col_needles: list[str],
    status_tokens: set[str],
) -> int:
    """Count data rows whose key column is non-empty but whose status column carries no
    controlled status token, in the first table whose headers match all needle groups.
    Returns -1 if no such table is found (caller decides whether absence is a failure)."""
    for headers, rows in parse_markdown_tables(text):
        joined = " ".join(headers).lower()
        if not all(any(n.lower() in joined for n in [grp]) for grp in table_header_needles):
            continue
        key_idx = _header_index(headers, key_col_needles)
        status_idx = _header_index(headers, status_col_needles)
        if key_idx is None or status_idx is None:
            continue
        bad = 0
        for row in rows:
            if len(row) <= max(key_idx, status_idx):
                continue
            key = row[key_idx].strip()
            status = row[status_idx].strip().lower()
            if not key or key in {"|", "-"}:
                continue
            if not any(token in status for token in status_tokens):
                bad += 1
        return bad
    return -1


def text_has_url(text: str) -> bool:
    return bool(re.search(r"https?://\S+", text))


def has_unresolved_pending(text: str) -> bool:
    return bool(re.search(r"(?<![A-Za-z])pending(?![A-Za-z])", text, flags=re.IGNORECASE))


# ============================================================================
# Validator internals (private)
# ============================================================================

# Terminal opencli statuses that count as a real command outcome (not "still pending").
_OPENCLI_TERMINAL = {
    "done", "not_found", "unavailable", "blocked",
    "login_required", "syntax_unknown", "not_public", "not_applicable",
}


def _opencli_logged(text: str) -> bool:
    """A logged opencli command means: some table row holds an actual `opencli <platform>`
    command together with a terminal status. Naming opencli in a plan is not enough."""
    for _headers, rows in parse_markdown_tables(text):
        for row in rows:
            joined = " ".join(row).lower()
            if re.search(r"opencli\s+\w+", joined) and any(tok in joined for tok in _OPENCLI_TERMINAL):
                return True
    return False


def _token_mentions(cell: str, tokens: set[str]) -> list[str]:
    lowered = cell.lower()
    found: list[str] = []
    for token in sorted(tokens, key=len, reverse=True):
        if re.search(rf"(?<![A-Za-z_]){re.escape(token)}(?![A-Za-z_])", lowered):
            found.append(token)
    return found


def _section_id_from_cell(cell: str) -> str | None:
    clean = cell.strip()
    lowered = clean.lower()
    numeric = re.match(r"^(?:section\s*)?(1[0-6]|[0-9])(?:[\s.．、:：-]|$)", lowered)
    if numeric:
        return numeric.group(1)
    for chinese, section_id in sorted(CHINESE_SECTION_NUMBERS.items(), key=lambda item: len(item[0]), reverse=True):
        if re.match(rf"^{re.escape(chinese)}(?:[、.．\s:：-]|$)", clean):
            return section_id
    return None


def _row_has_traceable_pointer(row_text: str) -> bool:
    return bool(
        re.search(r"https?://\S+", row_text)
        or re.search(r"\bE\d+\b", row_text)
        or has_any(
            row_text,
            [
                "raw/", ".stdout", ".stderr",
                "Deep Evidence", "Facts Normalized", "Campaign Clusters", "Wide Index",
                "Claim Ledger", "Gap Check", "Competitor Boundary", "Product Identity", "Research Plan",
                "深度证据", "标准化事实", "传播事件簇", "宽索引",
                "缺口检查", "竞品边界", "产品身份", "研究计划",
                "来源", "source",
            ],
        )
    )


def _row_has_inventory_evidence_pointer(row_text: str) -> bool:
    """Ready rows should point back into the inventory ledger, not just paste a
    loose URL. This keeps writing anchored to frozen evidence without enforcing
    counts, word lengths, or competitor quantities."""
    return bool(
        re.search(r"\bE\d+\b", row_text)
        or re.search(r"\braw/", row_text)
        or re.search(r"\.(stdout|stderr)\.txt\b", row_text)
        or has_any(
            row_text,
            [
                "Deep Evidence", "Facts Normalized", "Campaign Clusters", "Wide Index",
                "Claim Ledger", "Gap Check", "Competitor Boundary", "Product Identity", "Research Plan",
                "深度证据", "标准化事实", "传播事件簇", "宽索引",
                "缺口检查", "竞品边界", "产品身份", "研究计划",
            ],
        )
    )


def _has_raw_cache_pointer(text: str) -> bool:
    return bool(re.search(r"\braw/", text) or re.search(r"\.(stdout|stderr)\.txt\b", text))


def _raw_cache_explicitly_unavailable(text: str) -> bool:
    return has_any(
        text,
        [
            "raw unavailable", "raw cache unavailable", "cannot cache", "no script runtime",
            "manual run", "manual_run", "无脚本", "无法缓存", "不能缓存",
            "仅手动", "受限环境",
        ],
    )


def _row_explains_thinness(row_text: str) -> bool:
    return has_any(
        row_text,
        [
            "new product", "new launch", "not public",
            "not_found", "unavailable", "blocked", "login_required",
            "thin", "evidence limit", "verification gap",
            "新产品", "刚上线", "未公开", "未找到", "不可访问", "受阻",
            "证据不足", "覆盖后", "稀疏",
        ],
    )


def _readiness_rows(text: str) -> tuple[dict[str, tuple[str, str]], list[str], bool]:
    rows_by_section: dict[str, tuple[str, str]] = {}
    invalid: list[str] = []
    saw_table = False
    for headers, rows in parse_markdown_tables(text):
        section_idx = _header_index(headers, ["正文章节", "正文模块", "章节", "section", "module"])
        readiness_idx = _header_index(headers, ["readiness", "就绪"])
        if section_idx is None or readiness_idx is None:
            continue
        saw_table = True
        for row in rows:
            if len(row) <= max(section_idx, readiness_idx):
                continue
            section_id = _section_id_from_cell(row[section_idx])
            if section_id is None:
                continue
            status_cell = row[readiness_idx].strip()
            statuses = _token_mentions(status_cell, READINESS_TOKENS)
            row_text = " | ".join(row)
            if len(statuses) != 1:
                invalid.append(f"{section_id}: {status_cell or '<empty>'}")
                continue
            rows_by_section[section_id] = (statuses[0], row_text)
    return rows_by_section, invalid, saw_table


def _has_concept_groups(text: str, groups: list[list[str]]) -> bool:
    return all(has_any(text, group) for group in groups)


def _concept_gap(text: str, groups: list[list[str]]) -> bool:
    return not section_has_evidence_limit(text) and not _has_concept_groups(text, groups)


def _has_explicit_no_artifact_reason(text: str) -> bool:
    return section_has_evidence_limit(text) and has_any(
        text,
        [
            "无法形成", "不能形成", "不足以形成", "没有足够", "不强行生成",
            "no candidate", "cannot form", "insufficient evidence to form",
        ],
    )


def _has_roadmap_detail_framework(text: str) -> bool:
    return _has_concept_groups(
        text,
        [
            ["地域", "region"],
            ["官方动作", "official action"],
            ["产品变化", "product change"],
            ["PR", "媒体", "press"],
            ["KOL", "KOC", "创作者", "creator"],
            ["官方内容渠道", "official content"],
            ["广告投放", "paid ads", "advertising"],
            ["用户反应", "user reaction"],
            ["效果信号", "effect signal"],
            ["竞品对比", "competitor"],
            ["判断", "judgment"],
        ],
    )


def _has_absence_item_blocks(text: str) -> bool:
    labels = ["观察", "预期动作", "可能解释", "对竞品的缝隙"]
    return all(re.search(rf"^\s*-\s*{label}\s*[:：]", text, flags=re.MULTILINE) for label in labels)


# ============================================================================
# Public commands
# ============================================================================

def cmd_validate_inventory(args: argparse.Namespace) -> int:
    path = Path(args.inventory).expanduser()
    failures: list[str] = []
    warnings: list[str] = []
    if not path.exists():
        return print_validation("inventory", path, [f"Inventory file does not exist: {path}"], warnings)
    text = read_text(path)
    if not text.strip():
        return print_validation("inventory", path, ["Inventory is empty."], warnings)

    # 1. Structural contract: required sections present (matched on headers,
    #    not anywhere in text — a cross-reference must not count as the section).
    for section_name, aliases in INVENTORY_SECTION_ALIASES.items():
        if not has_section_header(text, aliases):
            failures.append(f"缺少 inventory 章节或等价物：{section_name}。")

    # 2. Internal-consistency gates (no quotas, no counts).
    if has_unresolved_pending(text):
        failures.append("覆盖未结案：仍存在 `pending` 状态，inventory 未冻结，不能进入写作。")

    if "opencli" in text.lower() and not _opencli_logged(text):
        failures.append("提到 opencli 但无实际命令日志（某行同时含 `opencli <platform>` 命令与终态状态）。")

    if not _has_raw_cache_pointer(text) and not _raw_cache_explicitly_unavailable(text):
        failures.append(
            "inventory 没有任何 raw/ 或 .stdout/.stderr 缓存指针，也没有说明为何无法缓存；"
            "这会让正文无法复核深读证据。"
        )

    bad_status_rows = status_column_unfilled_rows(
        text,
        table_header_needles=["字段", "口径", "状态"],
        key_col_needles=["字段", "field"],
        status_col_needles=["状态", "status"],
        status_tokens=EVIDENCE_STATUS_TOKENS,
    )
    if bad_status_rows > 0:
        failures.append(f"标准硬数据表有 {bad_status_rows} 行填了字段但状态列没有受控状态 token。")
    elif bad_status_rows == -1:
        warnings.append("未识别到标准硬数据表（字段/口径/状态 表头）；确认 Facts Normalized 已按规范渲染。")

    readiness, invalid_readiness, saw_readiness_table = _readiness_rows(text)
    if not saw_readiness_table:
        failures.append("Gap Check 缺少章节级 Inventory Readiness 表（正文章节 / Readiness / 依据或解释）。")
    if invalid_readiness:
        failures.append(
            "Inventory Readiness 每章只能填一个受控 token；这些行不合格："
            + ", ".join(invalid_readiness[:8])
        )
    missing_readiness = [section_id for section_id in REPORT_SECTION_IDS if section_id not in readiness]
    if missing_readiness:
        failures.append("Inventory Readiness 未覆盖这些正文章节：" + ", ".join(missing_readiness) + "。")
    for section_id, (status, row_text) in readiness.items():
        if status == "ready" and not _row_has_traceable_pointer(row_text):
            failures.append(f"第 {section_id} 章标 ready 但没有证据编号、URL、raw 文件或来源指针。")
        if status == "ready" and not _row_has_inventory_evidence_pointer(row_text):
            failures.append(f"第 {section_id} 章标 ready 但没有指向 inventory 内部证据块或 raw 缓存。")
        if status == "thin_but_explained" and not _row_explains_thinness(row_text):
            failures.append(f"第 {section_id} 章标 thin_but_explained 但没有解释为什么证据稀疏仍可写窄结论。")
        if status == "collection_gap":
            failures.append(f"第 {section_id} 章仍为 collection_gap，必须回采集或改为有解释的受限结论后再写。")

    # 3. Light warnings (diagnostic only).
    if not evidence_statuses_in(text):
        warnings.append("未发现任何证据状态 token；已检查/缺失/受阻的证据应显式标状态。")
    if not has_table(text):
        warnings.append("未发现任何 Markdown 表格；inventory 可能难以被结构化复用。")

    return print_validation("inventory", path, failures, warnings)


def cmd_validate_report(args: argparse.Namespace) -> int:
    report_path = Path(args.report).expanduser()
    inventory_path = Path(args.inventory).expanduser() if args.inventory else None
    failures: list[str] = []
    warnings: list[str] = []
    if not report_path.exists():
        return print_validation("report", report_path, [f"Report file does not exist: {report_path}"], warnings)
    text = read_text(report_path)
    if not text.strip():
        return print_validation("report", report_path, ["Report is empty."], warnings)

    sections = markdown_sections(text)

    # 1. Structural contract: all required sections present.
    for section_id in REPORT_REQUIRED_SECTIONS:
        if section_id not in sections:
            failures.append(f"缺少报告章节：{section_id}。")

    # 2. Global no-table-dump gate (directly targets the copy-the-inventory failure):
    #    every section that renders a table must add section-specific reading outside the table.
    for section_id, section_text in sections.items():
        if has_table(section_text) and not has_interpretive_reading(section_text):
            failures.append(f"第 {section_id} 章有表格但表外无该章解读（疑似把 inventory 表格当分析搬运）。")

    # 3. High-value per-section contract checks (no counts, no word limits).
    section0 = sections.get("0", "")
    if section0:
        if not has_table(section0):
            failures.append("第 0 章应渲染标准硬数据表或显式证据状态表。")
        if not has_any(section0, ["读数", "说明", "意味着", "不能推断", "reveals", "indicates", "means"]):
            failures.append("第 0 章应在数据表后写数据读数，不能只罗列事实。")

    section1 = sections.get("1", "")
    if section1 and _concept_gap(
        section1,
        [["官方", "official", "narrative", "叙事"], ["用户", "媒体", "接收", "差距", "user"], ["竞品", "相对", "relative"]],
    ):
        failures.append("第 1 章应回答官方叙事、用户/媒体接收差距、相对竞品位置；证据不足时需明确说明。")

    section2 = sections.get("2", "")
    if section2 and not (
        has_any(section2, ["相对优势", "优势"])
        and has_any(section2, ["相对弱势", "相对短板", "短板", "弱势"])
        and has_any(section2, ["开放空间", "战略空位", "空位", "缝隙"])
    ):
        failures.append("第 2 章应以相对优势、相对弱势、开放空间收尾，不能只列竞品。")

    section3 = sections.get("3", "")
    if section3:
        if not has_any(section3, ["aha", "aha moment"]):
            failures.append("第 3 章应识别 Aha Moment 或说明为何无法取证。")
        if not has_any(section3, ["信号", "亮点", "传播锚点", "signal"]):
            failures.append("第 3 章应绘制产品信号图，不能只描述产品机制。")

    section4 = sections.get("4", "")
    if section4 and _concept_gap(
        section4,
        [["上线", "首次", "公开", "launch"], ["第一批", "首批", "early user"], ["来源", "机制", "channel"]],
    ):
        failures.append("第 4 章应回答冷启动时间边界、第一批用户来源和冷启动机制；证据不足时需明确说明。")

    section5 = sections.get("5", "")
    if section5 and _concept_gap(
        section5,
        [["主增长", "主要机制", "primary", "growth"], ["辅助", "secondary", "渠道"], ["变化", "跨越", "阶段"]],
    ):
        failures.append("第 5 章应区分主增长机制、辅助机制和阶段变化；证据不足时需明确说明。")

    section6 = sections.get("6", "")
    if section6 and _concept_gap(
        section6,
        [["职业", "场景", "画像", "user"], ["来源", "SimilarWeb", "评论", "官方"], ["差距", "宣称", "official"]],
    ):
        failures.append("第 6 章应写核心用户画像、证据来源和官方目标用户差距；证据不足时需明确说明。")

    section7 = sections.get("7", "")
    if section7 and _concept_gap(
        section7,
        [["定价", "pricing", "商业化", "monetization"], ["付费墙", "plan", "subscription", "credit"], ["竞品", "对比"]],
    ):
        failures.append("第 7 章应回答商业化模式、付费墙/套餐设计和竞品定价对比；证据不足时需明确说明。")

    section8 = sections.get("8", "")
    if section8 and not has_required_format_or_gap(
        section8, [["时间", "time"], ["事件簇", "event"], ["渠道", "channel"], ["效果信号", "signal"], ["判断", "judgment"]]
    ):
        failures.append("第 8 章应有传播 Roadmap 总览表或明确证据限制，不能只写散点事件。")
    if section8 and has_table(section8) and not _has_roadmap_detail_framework(section8) and not _has_explicit_no_artifact_reason(section8):
        failures.append("第 8 章有 Roadmap 总览但没有展开重点节点的 11 项框架，也没有说明为什么无法展开。")

    section9 = sections.get("9", "")
    if section9:
        creator_matrix_ok = has_table_contract(
            section9,
            [
                ["平台", "platform"],
                ["创作者层级", "层级", "规模", "creator layer"],
                ["代表账号", "账号", "representative"],
                ["内容形式", "format"],
                ["原生指标", "指标", "native metric"],
                ["合作判断", "cooperation"],
                ["增长角色", "growth role"],
            ],
        )
        candidate_pool_ok = has_table_contract(
            section9,
            [
                ["平台", "platform"],
                ["创作者", "creator"],
                ["层级", "tier"],
                ["粉丝", "订阅", "followers", "subscribers"],
                ["代表内容指标", "指标", "metric"],
                ["垂类", "category"],
                ["合作判断", "cooperation"],
                ["价值", "value"],
                ["优先级", "priority", "P0", "P1", "P2"],
            ],
        )
        no_creator_artifact = _has_explicit_no_artifact_reason(section9)
        if not creator_matrix_ok and not no_creator_artifact:
            failures.append("第 9 章应单独输出创作者矩阵（平台/层级规模/代表账号/内容形式/原生指标/合作判断/增长角色），不能用省字段表替代。")
        if not candidate_pool_ok and not no_creator_artifact:
            failures.append("第 9 章应单独输出可合作候选池（含层级、粉丝/订阅、代表指标、垂类、合作价值和优先级），或明确说明无法形成候选池。")

    section10 = sections.get("10", "")
    if section10:
        official_matrix_ok = has_table_contract(
            section10,
            [
                ["平台", "platform"],
                ["官方账号", "account"],
                ["活跃状态", "active status"],
                ["粉丝", "订阅", "followers", "subscribers"],
                ["发文频率", "frequency"],
                ["主要内容类型", "content type"],
                ["互动数据", "engagement"],
                ["渠道角色", "channel role"],
                ["判断", "judgment"],
            ],
        )
        if not official_matrix_ok:
            failures.append("第 10 章应保留完整官方账号矩阵表头（平台/账号/活跃状态/粉丝/频率/内容类型/互动/渠道角色/判断），blocked 也不能缩成状态表。")
        if not (
            has_any(section10, ["内容质量", "清晰度", "持续性", "教育价值", "信任价值", "转化承接", "平台适配"])
            or section_has_evidence_limit(section10)
        ):
            failures.append("第 10 章应判断自有内容质量，不能只列官方账号。")

    section11 = sections.get("11", "")
    if section11 and not (
        any(status in section11 for status in AD_STATUS_TOKENS)
        or has_table_contract(section11, [["平台", "platform"], ["广告", "ad"], ["状态", "status"], ["素材", "创意", "creative"]])
    ):
        failures.append("第 11 章应记录广告库检查状态、投放平台/素材/目标，或明确广告证据限制。")
    if section11 and not has_table_contract(
        section11,
        [
            ["平台", "platform"],
            ["检查入口", "entry"],
            ["查询词", "domain", "query"],
            ["广告状态", "ad status"],
            ["素材", "创意", "creative"],
            ["落地页", "landing"],
            ["时间", "time"],
            ["判断", "judgment"],
        ],
    ):
        failures.append("第 11 章应保留完整广告检查表（平台/检查入口/查询词或 domain/广告状态/素材/落地页/时间/判断），不可用字段填状态。")

    section12 = sections.get("12", "")
    if section12 and _concept_gap(
        section12,
        [["信任来源", "背书", "trust"], ["创始人", "资本", "媒体", "客户", "社区", "合规"], ["竞品", "相对", "弱"]],
    ):
        failures.append("第 12 章应排序信任来源，并说明相对竞品的强弱；证据不足时需明确说明。")

    section13 = sections.get("13", "")
    if section13 and _concept_gap(
        section13,
        [["留存", "retention"], ["UGC", "模板", "社区", "工作流", "口碑"], ["循环", "飞轮", "断点"]],
    ):
        failures.append("第 13 章应判断留存是否反哺传播、循环来源和断点；证据不足时需明确说明。")

    section14 = sections.get("14", "")
    if section14 and _concept_gap(
        section14,
        [["中国", "global", "localization", "本地化"], ["平台", "合规", "竞品", "渠道"], ["改变", "差异", "判断"]],
    ):
        failures.append("第 14 章应说明中国/全球差异如何改变增长、传播或可借鉴判断；不适用时标 not_applicable。")

    section15 = sections.get("15", "")
    if section15 and not _has_absence_item_blocks(section15):
        failures.append("第 15 章每个 Notable Absence 应使用条目结构：观察、预期动作、可能解释、对竞品的缝隙；不能用单张总表替代。")

    section16 = sections.get("16", "")
    if section16 and _concept_gap(
        section16,
        [["逻辑", "why", "logic"], ["复用条件", "condition"], ["具体动作", "action"], ["可迁移", "transfer"], ["不可复制", "not transferable"]],
    ):
        failures.append("第 16 章应写可复用动作的逻辑、复用条件、具体动作和可迁移/不可复制边界。")

    # 4. Diagnostic warnings.
    if inventory_path and inventory_path.exists():
        inv = read_text(inventory_path)
        if has_any(text, ["主要来源", "sources", "source list"]) and not has_any(
            inv, ["深度证据", "标准化事实", "Deep Evidence", "Facts Normalized"]
        ):
            warnings.append("报告引用了来源，但关联 inventory 缺少可复用的深度证据/标准化事实。")
    elif inventory_path:
        warnings.append(f"提供了 inventory 路径但文件不存在：{inventory_path}")

    return print_validation("report", report_path, failures, warnings)
