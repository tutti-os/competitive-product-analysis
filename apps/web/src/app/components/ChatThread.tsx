import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";

import type { ChatMessage as ChatMessageType } from "@product-competition/shared";

import { useTranslation } from "../i18n/index.js";
import { ChatMessage } from "./ChatMessage.js";

export function ChatThread(props: { messages: ChatMessageType[]; isRunning: boolean }) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [props.messages]);

  if (props.messages.length === 0) {
    return (
      <div className="chat-thread chat-thread-empty">
        <div className="empty-hero">
          <span className="empty-mark">
            <Sparkles size={22} />
          </span>
          <h2>{t("chat.emptyTitle")}</h2>
          <p>{t("chat.emptyBody")}</p>
          <div className="empty-examples">
            <span>{t("chat.example1")}</span>
            <span>{t("chat.example2")}</span>
            <span>{t("chat.example3")}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-thread">
      {props.messages.map((message, index) => (
        <ChatMessage
          key={message.id}
          message={message}
          streaming={props.isRunning && index === props.messages.length - 1 && message.role === "assistant"}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
