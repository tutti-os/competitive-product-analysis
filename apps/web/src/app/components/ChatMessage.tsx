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
  const compactSummary = compactToolSummary(block.summary);
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
      <span className="tool-name">{block.name}</span>
      {compactSummary ? <span className="tool-summary">{compactSummary}</span> : null}
      {block.status === "running" ? <span className="tool-state">{t("chat.tool.running")}</span> : null}
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
          <div className="tool-detail-section" key={section.key}>
            <div className="tool-detail-label">{section.label}</div>
            {section.kind === "json" ? (
              <JsonDetail value={section.value} />
            ) : (
              <pre className="tool-detail-text">{section.value}</pre>
            )}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

type DetailSection =
  | { key: string; label: string; kind: "json"; value: unknown }
  | { key: string; label: string; kind: "text"; value: string };

function toolDetailSections(
  block: Extract<ContentBlock, { type: "tool" }>,
  t: (key: string) => string,
): DetailSection[] {
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
  return trimmed;
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
