import { memo, useEffect, useState } from "react";
import { Bot, Check, ChevronRight, LoaderCircle, Sparkles, Wrench, X } from "lucide-react";
import { allExpanded, darkStyles, defaultStyles, JsonView } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";

import type { ChatMessage as ChatMessageType, ContentBlock } from "@product-competition/shared";

import { useTranslation } from "../i18n/index.js";
import { Markdown } from "./Markdown.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/Collapsible.js";

export const ChatMessage = memo(function ChatMessage(props: {
  message: ChatMessageType;
  streaming: boolean;
}) {
  const { message } = props;
  if (message.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="msg-bubble">{plainText(message.contentBlocks)}</div>
      </div>
    );
  }

  const isEmpty =
    message.contentBlocks.length === 0 ||
    message.contentBlocks.every((block) => block.type === "text" && block.text.trim() === "");
  const hasActiveProgress = message.contentBlocks.some(
    (block) =>
      (block.type === "thinking" && !block.done && block.text.trim() !== "") ||
      (block.type === "tool" && block.status === "running"),
  );
  const showPending = props.streaming && (isEmpty || !hasActiveProgress);

  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar">
        <Bot size={16} />
      </div>
      <div className="msg-body">
        {message.contentBlocks.map((block, index) => (
          <BlockView key={index} block={block} streaming={props.streaming} />
        ))}
        {showPending ? <PendingIndicator /> : null}
      </div>
    </div>
  );
});

function BlockView(props: { block: ContentBlock; streaming: boolean }) {
  const { block } = props;
  if (block.type === "text") {
    if (block.text.trim() === "") return null;
    return <Markdown className="msg-text" source={block.text} />;
  }
  if (block.type === "thinking") {
    return <ThinkingBlock text={block.text} done={block.done ?? !props.streaming} />;
  }
  return <ToolBlock block={block} />;
}

function ThinkingBlock(props: { text: string; done: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!props.text.trim()) return null;
  return (
    <div className={`thinking-block ${open ? "is-open" : ""}`}>
      <button className="thinking-head" onClick={() => setOpen((value) => !value)}>
        <Sparkles size={13} className={props.done ? "" : "pulse"} />
        <span>{props.done ? t("chat.thinking.done") : t("chat.thinking.active")}</span>
        <ChevronRight size={13} className="thinking-caret" />
      </button>
      {open ? <div className="thinking-body">{props.text}</div> : null}
    </div>
  );
}

function ToolBlock(props: { block: Extract<ContentBlock, { type: "tool" }> }) {
  const { t } = useTranslation();
  const { block } = props;
  const [open, setOpen] = useState(false);
  const sections = toolDetailSections(block, t);
  const hasDetails = sections.length > 0;
  const compactSummary = toolSummaryPreview(block, t);
  const displayName = toolDisplayName(block, t);
  const content = (
    <>
      <span className="tool-icon">
        {block.status === "running" ? (
          <LoaderCircle size={13} className="spin" />
        ) : block.status === "failed" ? (
          <X size={13} />
        ) : (
          <Check size={13} />
        )}
      </span>
      <Wrench size={12} className="tool-wrench" />
      <span className="tool-name">{displayName}</span>
      <span className={`tool-status-label tool-status-${block.status}`}>{toolStatusLabel(block.status, t)}</span>
      {compactSummary ? <span className="tool-separator">·</span> : null}
      {compactSummary ? <span className="tool-summary">{compactSummary}</span> : null}
      {hasDetails ? (
        <span className="tool-detail-hint">
          {open ? t("chat.tool.hideDetails") : t("chat.tool.viewDetails")}
          <ChevronRight size={13} className="tool-caret" />
        </span>
      ) : null}
    </>
  );

  if (!hasDetails) {
    return <div className={`tool-block tool-${block.status}`}>{content}</div>;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={`tool-collapsible ${open ? "is-open" : ""}`}>
      <CollapsibleTrigger asChild>
        <button type="button" className={`tool-block tool-trigger tool-${block.status}`}>
          {content}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-detail-panel">
        {sections.map((section) => (
          <ToolDetailSection key={section.key} section={section} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

type DetailSection =
  | { key: string; label: string; kind: "json"; value: unknown }
  | { key: string; label: string; kind: "text"; tone?: "terminal"; value: string };

function ToolDetailSection(props: { section: DetailSection }) {
  const { t } = useTranslation();
  const [rawOpen, setRawOpen] = useState(false);
  const { section } = props;
  if (section.kind === "text") {
    return (
      <div className="tool-detail-section">
        <div className="tool-detail-label">{section.label}</div>
        <pre className={`tool-detail-text ${section.tone === "terminal" ? "is-terminal" : ""}`}>
          {section.value}
        </pre>
      </div>
    );
  }

  const rows = friendlyRowsFromValue(section.value, t);
  return (
    <div className="tool-detail-section">
      <div className="tool-detail-label">{section.label}</div>
      {rows.length > 0 ? (
        <dl className="tool-friendly-data">
          {rows.map((row) => (
            <div className="tool-friendly-row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Collapsible open={rawOpen} onOpenChange={setRawOpen} className="tool-raw-data">
        <CollapsibleTrigger asChild>
          <button type="button" className="tool-raw-trigger">
            {rawOpen ? t("chat.tool.hideRaw") : t("chat.tool.showRaw")}
            <ChevronRight size={13} className="tool-caret" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <JsonDetail value={section.value} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

type FriendlyRow = { label: string; value: string };

function friendlyRowsFromValue(value: unknown, t: (key: string) => string): FriendlyRow[] {
  if (Array.isArray(value)) {
    return [{ label: t("chat.tool.field.items"), value: t("chat.tool.value.itemCount").replace("{count}", String(value.length)) }];
  }
  if (!value || typeof value !== "object") {
    return [{ label: t("chat.tool.field.value"), value: formatFriendlyValue(value, t) }];
  }

  const record = value as Record<string, unknown>;
  const rows: FriendlyRow[] = [];
  const fieldMap: Array<[string, string]> = [
    ["platform", t("chat.tool.field.platform")],
    ["purpose", t("chat.tool.field.purpose")],
    ["query", t("chat.tool.field.query")],
    ["command", t("chat.tool.field.command")],
    ["status", t("chat.tool.field.status")],
    ["exit_code", t("chat.tool.field.exitCode")],
    ["hit_summary", t("chat.tool.field.hitSummary")],
    ["follow_up", t("chat.tool.field.followUp")],
    ["dry_run", t("chat.tool.field.dryRun")],
  ];

  for (const [key, label] of fieldMap) {
    if (record[key] !== undefined && record[key] !== "") {
      rows.push({ label, value: formatRecordValue(key, record[key], t) });
    }
  }

  const fileKeys = Object.keys(record).filter((key) => key.endsWith("_path") && typeof record[key] === "string");
  if (fileKeys.length > 0) {
    rows.push({
      label: t("chat.tool.field.files"),
      value: t("chat.tool.value.fileCount").replace("{count}", String(fileKeys.length)),
    });
  }
  if (Array.isArray(record.items)) {
    rows.push({
      label: t("chat.tool.field.items"),
      value: t("chat.tool.value.itemCount").replace("{count}", String(record.items.length)),
    });
  }
  if (Array.isArray(record.files)) {
    rows.push({
      label: t("chat.tool.field.files"),
      value: record.files.map((item) => String(item)).join(", "),
    });
  }
  if (rows.length === 0) {
    rows.push({
      label: t("chat.tool.field.record"),
      value: t("chat.tool.value.fieldCount").replace("{count}", String(Object.keys(record).length)),
    });
  }

  return rows;
}

function formatRecordValue(key: string, value: unknown, t: (key: string) => string): string {
  if (key === "purpose" && typeof value === "string") return formatPurposeValue(value, t);
  if (key === "follow_up" && typeof value === "string") return formatFollowUpValue(value, t);
  return formatFriendlyValue(value, t);
}

function formatPurposeValue(value: string, t: (key: string) => string): string {
  switch (value) {
    case "official and user voice":
      return t("chat.tool.purpose.officialUserVoice");
    case "creator coverage":
      return t("chat.tool.purpose.creatorCoverage");
    case "China creator coverage":
      return t("chat.tool.purpose.chinaCreatorCoverage");
    case "developer community coverage":
      return t("chat.tool.purpose.developerCommunityCoverage");
    case "launch history":
      return t("chat.tool.purpose.launchHistory");
    default:
      return value;
  }
}

function formatFollowUpValue(value: string, t: (key: string) => string): string {
  if (value === "Record unavailable and use WebSearch/WebFetch fallback.") {
    return t("chat.tool.followUp.webFallback");
  }
  return value;
}

function formatFriendlyValue(value: unknown, t: (key: string) => string): string {
  if (value === true) return t("common.yes");
  if (value === false) return t("common.no");
  if (value === null) return t("common.none");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    return formatStatusValue(value, t);
  }
  if (Array.isArray(value)) return t("chat.tool.value.itemCount").replace("{count}", String(value.length));
  if (typeof value === "object") return t("chat.tool.value.object");
  return String(value);
}

function formatStatusValue(value: string, t: (key: string) => string): string {
  switch (value) {
    case "ok":
      return t("chat.tool.status.ok");
    case "completed":
      return t("chat.tool.status.completed");
    case "failed":
      return t("chat.tool.status.failed");
    case "running":
      return t("chat.tool.status.running");
    case "unavailable":
      return t("chat.tool.status.unavailable");
    case "blocked":
      return t("chat.tool.status.blocked");
    case "login_required":
      return t("chat.tool.status.login_required");
    case "syntax_unknown":
      return t("chat.tool.status.syntax_unknown");
    default:
      return value;
  }
}

function toolDetailSections(
  block: Extract<ContentBlock, { type: "tool" }>,
  t: (key: string) => string,
): DetailSection[] {
  if (block.name.toLowerCase() === "bash") {
    const command = extractCommand(block.input);
    const commandSections: DetailSection[] = [];
    if (command) {
      commandSections.push({
        key: "command",
        kind: "text",
        label: t("chat.tool.command"),
        tone: "terminal",
        value: command,
      });
    } else if (block.input !== undefined) {
      commandSections.push(toDetailSection("input", t("chat.tool.input"), block.input));
    }
    if (block.output !== undefined) {
      commandSections.push(toDetailSection("output", t("chat.tool.output"), block.output));
    }
    if (block.summary) {
      const summarySection: Extract<DetailSection, { kind: "text" }> = {
        key: "command-output",
        kind: "text",
        label: bashSummaryLabel(block.summary, t),
        ...(parseJson(block.summary) === undefined ? { tone: "terminal" as const } : {}),
        value: block.summary,
      };
      commandSections.push(toDetailSectionWithFallback(summarySection));
    }
    return commandSections;
  }

  const sections: DetailSection[] = [];
  if (block.input !== undefined) {
    sections.push(toDetailSection("input", t("chat.tool.input"), block.input));
  }
  if (block.output !== undefined) {
    sections.push(toDetailSection("output", t("chat.tool.output"), block.output));
  }
  if (block.summary) {
    sections.push(toDetailSection("summary", t("chat.tool.summary"), block.summary));
  }
  return sections;
}

function toDetailSectionWithFallback(section: Extract<DetailSection, { kind: "text" }>): DetailSection {
  const parsed = parseJson(section.value);
  if (parsed !== undefined) {
    return { key: section.key, label: section.label, kind: "json", value: parsed };
  }
  return section;
}

function extractCommand(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["command", "cmd", "script"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key];
  }
  if (Array.isArray(record.args) && record.args.every((item) => typeof item === "string")) {
    return record.args.join(" ");
  }
  return undefined;
}

function toolDisplayName(block: Extract<ContentBlock, { type: "tool" }>, t: (key: string) => string): string {
  const toolName = block.name.toLowerCase();
  if (toolName === "bash") {
    return bashDisplayName(block.summary, t);
  }
  switch (toolName) {
    case "bash":
      return t("chat.tool.name.bash");
    case "read":
      return t("chat.tool.name.read");
    case "write":
      return t("chat.tool.name.write");
    case "edit":
      return t("chat.tool.name.edit");
    case "multiedit":
      return t("chat.tool.name.multiEdit");
    case "websearch":
      return t("chat.tool.name.webSearch");
    case "webfetch":
      return t("chat.tool.name.webFetch");
    case "todowrite":
      return t("chat.tool.name.todoWrite");
    default:
      return block.name;
  }
}

function bashDisplayName(summary: string | undefined, t: (key: string) => string): string {
  const parsed = summary ? parseJson(summary) : undefined;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (record.platform || record.command) return t("chat.tool.name.collect");
    if (record.opencli) return t("chat.tool.name.checkTool");
    if (record.product && record.run_id) return t("chat.tool.name.createRun");
    if (Object.keys(record).some((key) => key.endsWith("_path") || key.endsWith("_dir"))) {
      return t("chat.tool.name.prepareFiles");
    }
  }
  const trimmed = summary?.trim() ?? "";
  if (/^---\s*\nname:/i.test(trimmed) || /^#\s+/m.test(trimmed) || /^#!\//.test(trimmed)) {
    return t("chat.tool.name.read");
  }
  if (/(\.md|\.py|\.json|\.txt)(\n|$)/.test(trimmed) && trimmed.split(/\r?\n/).length > 1) {
    return t("chat.tool.name.findFiles");
  }
  return t("chat.tool.name.bash");
}

function toolSummaryPreview(
  block: Extract<ContentBlock, { type: "tool" }>,
  t: (key: string) => string,
): string | undefined {
  if (!block.summary) return undefined;
  if (block.name.toLowerCase() !== "bash") return compactToolSummary(block.summary);

  const parsed = parseJson(block.summary);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (record.platform) {
      const platform = String(record.platform);
      const status = typeof record.status === "string" ? formatStatusValue(record.status, t) : undefined;
      return status ? `${platform} · ${status}` : platform;
    }
    if (record.opencli && typeof record.opencli === "object") {
      const opencli = record.opencli as Record<string, unknown>;
      return `${t("chat.tool.field.opencli")} · ${formatFriendlyValue(opencli.available, t)}`;
    }
    if (record.product) return String(record.product);
    const fileKeys = Object.keys(record).filter((key) => key.endsWith("_path") || key.endsWith("_dir"));
    if (fileKeys.length > 0) {
      return t("chat.tool.value.fileCount").replace("{count}", String(fileKeys.length));
    }
    return t("chat.tool.value.fieldCount").replace("{count}", String(Object.keys(record).length));
  }
  return compactToolSummary(block.summary);
}

function bashSummaryLabel(summary: string | undefined, t: (key: string) => string): string {
  if (!summary) return t("chat.tool.commandOutput");
  if (parseJson(summary) !== undefined) return t("chat.tool.summary");
  const trimmed = summary.trim();
  if (/^---\s*\nname:/i.test(trimmed) || /^#\s+/m.test(trimmed) || /^#!\//.test(trimmed)) {
    return t("chat.tool.fileContent");
  }
  return t("chat.tool.commandOutput");
}

function toolStatusLabel(status: Extract<ContentBlock, { type: "tool" }>["status"], t: (key: string) => string) {
  switch (status) {
    case "running":
      return t("chat.tool.status.running");
    case "failed":
      return t("chat.tool.status.failed");
    case "completed":
      return t("chat.tool.status.completed");
  }
}

function toDetailSection(key: string, label: string, value: unknown): DetailSection {
  if (typeof value === "string") {
    const parsed = parseJson(value);
    if (parsed !== undefined) return { key, label, kind: "json", value: parsed };
    return { key, label, kind: "text", value };
  }
  return { key, label, kind: "json", value };
}

function compactToolSummary(summary: string | undefined): string | undefined {
  if (!summary) return undefined;
  const trimmed = summary.trim();
  if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) return undefined;
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = lines.find((line) => /^#{1,6}\s+/.test(line));
  const fallback = lines.find(
    (line) =>
      line !== "---" &&
      !line.startsWith("```") &&
      !/^(name|description):\s*/i.test(line),
  );
  return (heading ?? fallback ?? lines[0] ?? trimmed).replace(/^#{1,6}\s+/, "");
}

function parseJson(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function JsonDetail(props: { value: unknown }) {
  const prefersDark = usePrefersDark();
  return (
    <div className="tool-json-view">
      <JsonView
        data={toJsonViewData(props.value)}
        shouldExpandNode={allExpanded}
        style={prefersDark ? darkStyles : defaultStyles}
        clickToExpandNode
      />
    </div>
  );
}

function toJsonViewData(value: unknown): object | unknown[] {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object") return value as object;
  return { value };
}

function usePrefersDark() {
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setPrefersDark(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return prefersDark;
}

function PendingIndicator() {
  const { t } = useTranslation();
  return (
    <div className="pending-indicator">
      <Sparkles size={14} className="pulse" />
      <span>{t("chat.pending")}</span>
      <span className="dots">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function plainText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
