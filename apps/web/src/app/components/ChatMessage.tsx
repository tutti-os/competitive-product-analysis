import { memo, useState } from "react";
import { Bot, Check, ChevronRight, LoaderCircle, Sparkles, Wrench, X } from "lucide-react";

import type { ChatMessage as ChatMessageType, ContentBlock } from "@product-competition/shared";

import { useTranslation } from "../i18n/index.js";
import { Markdown } from "./Markdown.js";

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

  return (
    <div className="msg msg-assistant">
      <div className="msg-avatar">
        <Bot size={16} />
      </div>
      <div className="msg-body">
        {isEmpty && props.streaming ? <PendingIndicator /> : null}
        {message.contentBlocks.map((block, index) => (
          <BlockView key={index} block={block} streaming={props.streaming} />
        ))}
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
  return <ToolBlock name={block.name} status={block.status} summary={block.summary} />;
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

function ToolBlock(props: { name: string; status: string; summary?: string }) {
  const { t } = useTranslation();
  return (
    <div className={`tool-block tool-${props.status}`}>
      <span className="tool-icon">
        {props.status === "running" ? (
          <LoaderCircle size={13} className="spin" />
        ) : props.status === "failed" ? (
          <X size={13} />
        ) : (
          <Check size={13} />
        )}
      </span>
      <Wrench size={12} className="tool-wrench" />
      <span className="tool-name">{props.name}</span>
      {props.summary ? <span className="tool-summary">{props.summary}</span> : null}
      {props.status === "running" ? <span className="tool-state">{t("chat.tool.running")}</span> : null}
    </div>
  );
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
