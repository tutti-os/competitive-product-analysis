import { useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import type { AgentProviderSummary } from "@product-competition/shared";

import { useTranslation } from "../i18n/index.js";
import { AgentSelector, type AgentSelection } from "./AgentSelector.js";

export function ChatInput(props: {
  providers: AgentProviderSummary[];
  selection: AgentSelection | null;
  onSelectionChange: (selection: AgentSelection) => void;
  isRunning: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = value.trim().length > 0 && !props.isRunning && Boolean(props.selection);

  function send() {
    const text = value.trim();
    if (!text || props.isRunning || !props.selection) return;
    props.onSend(text);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      // 输入法组合中（如拼音候选未上屏），回车应交给输入法确认，不触发发送
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      send();
    }
  }

  function autoGrow() {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={value}
          rows={1}
          placeholder={t("chat.inputPlaceholder")}
          onChange={(event) => {
            setValue(event.target.value);
            autoGrow();
          }}
          onKeyDown={onKeyDown}
        />
        <div className="composer-toolbar">
          <AgentSelector
            providers={props.providers}
            value={props.selection}
            onChange={props.onSelectionChange}
            disabled={props.isRunning}
          />
          <div className="composer-spacer" />
          {props.isRunning ? (
            <button className="send-button send-stop" onClick={props.onCancel} title={t("chat.stop")}>
              <Square size={15} />
            </button>
          ) : (
            <button className="send-button" disabled={!canSend} onClick={send} title={t("chat.send")}>
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
      <p className="composer-hint">{t("chat.hint")}</p>
    </div>
  );
}
