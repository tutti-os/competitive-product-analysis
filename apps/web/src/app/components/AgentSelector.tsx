import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, TriangleAlert } from "lucide-react";

import type { AgentTargetSummary } from "@product-competition/shared";

import { useTranslation } from "../i18n/index.js";

export interface AgentSelection {
  agentTargetId: string;
  model: string;
}

export function AgentSelector(props: {
  agents: AgentTargetSummary[];
  value: AgentSelection | null;
  onChange: (selection: AgentSelection) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const ready = props.agents.filter((agent) => agent.status === "ready");

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = props.value
    ? ready.find((agent) => agent.agentTargetId === props.value?.agentTargetId) ?? null
    : null;

  const label = current
    ? `${current.label}${props.value?.model ? ` · ${props.value.model}` : ""}`
    : ready.length === 0
      ? t("agent.none")
      : t("agent.pick");

  return (
    <div className="agent-selector" ref={rootRef}>
      <button
        type="button"
        className="agent-trigger"
        disabled={props.disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {ready.length === 0 ? <TriangleAlert size={14} /> : <Bot size={14} />}
        <span className="agent-trigger-label">{label}</span>
        <ChevronDown size={14} />
      </button>

      {open ? (
        <div className="agent-menu">
          {ready.length === 0 ? (
            <div className="agent-empty">{t("agent.noneHint")}</div>
          ) : (
            ready.map((agent) => (
              <div key={agent.agentTargetId} className="agent-group">
                <button
                  type="button"
                  className="agent-option"
                  onClick={() => {
                    props.onChange({ agentTargetId: agent.agentTargetId, model: "" });
                    setOpen(false);
                  }}
                >
                  <span>{agent.label}</span>
                  {props.value?.agentTargetId === agent.agentTargetId && !props.value.model ? (
                    <Check size={14} />
                  ) : null}
                </button>
                {agent.models.map((model) => (
                  <button
                    key={model}
                    type="button"
                    className="agent-option agent-option-model"
                    onClick={() => {
                      props.onChange({ agentTargetId: agent.agentTargetId, model });
                      setOpen(false);
                    }}
                  >
                    <span>{model}</span>
                    {props.value?.agentTargetId === agent.agentTargetId && props.value.model === model ? (
                      <Check size={14} />
                    ) : null}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
