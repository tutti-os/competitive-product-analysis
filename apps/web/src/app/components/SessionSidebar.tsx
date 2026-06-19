import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, Pencil, Search, Trash2 } from "lucide-react";

import type { ResearchSession } from "@product-competition/shared";

import { useTranslation } from "../i18n/index.js";

export function SessionSidebar(props: {
  sessions: ResearchSession[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  onOpenLibrary: () => void;
}) {
  const { t, locale } = useTranslation();
  const [pendingDelete, setPendingDelete] = useState<ResearchSession | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  function startEditing(session: ResearchSession) {
    setEditingId(session.id);
    setDraft(session.title);
  }

  function commitEditing() {
    if (!editingId) return;
    const id = editingId;
    const trimmed = draft.trim();
    const current = props.sessions.find((session) => session.id === id);
    if (trimmed && current && trimmed !== current.title) {
      props.onRename(id, trimmed);
    }
    setEditingId(null);
    setDraft("");
  }

  function cancelEditing() {
    setEditingId(null);
    setDraft("");
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <span className="brand-mark">CA</span>
          <span className="brand-name">{t("app.title")}</span>
        </div>
        <button className="new-session" onClick={props.onCreate} title={t("session.new")}>
          <MessageSquarePlus size={16} />
        </button>
      </div>

      <button className="library-link" onClick={props.onOpenLibrary}>
        <Search size={15} />
        <span>{t("library.title")}</span>
      </button>

      <div className="session-list">
        {props.sessions.length === 0 ? (
          <p className="session-empty">{t("session.empty")}</p>
        ) : (
          props.sessions.map((session) =>
            session.id === editingId ? (
              <div key={session.id} className="session-item is-editing">
                <span className={`session-status status-${session.status}`} />
                <input
                  ref={inputRef}
                  className="session-rename-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commitEditing}
                  onKeyDown={(event) => {
                    // Ignore Enter while an IME composition is active (e.g. pinyin
                    // candidate selection), otherwise it commits the half-typed text.
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitEditing();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelEditing();
                    }
                  }}
                  aria-label={t("session.rename")}
                />
              </div>
            ) : (
              <button
                key={session.id}
                className={`session-item ${session.id === props.activeSessionId ? "is-active" : ""}`}
                onClick={() => props.onSelect(session.id)}
                onDoubleClick={() => startEditing(session)}
              >
                <span className={`session-status status-${session.status}`} />
                <span className="session-meta">
                  <span className="session-title">{session.title}</span>
                  <span className="session-sub">
                    {session.artifactCount > 0
                      ? t("session.artifacts", { count: session.artifactCount })
                      : formatDate(session.updatedAt, locale)}
                  </span>
                </span>
                <span className="session-actions">
                  <span
                    className="session-action"
                    role="button"
                    tabIndex={0}
                    title={t("session.rename")}
                    aria-label={t("session.rename")}
                    onClick={(event) => {
                      event.stopPropagation();
                      startEditing(session);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.stopPropagation();
                        startEditing(session);
                      }
                    }}
                  >
                    <Pencil size={14} />
                  </span>
                  <span
                    className="session-action session-delete"
                    role="button"
                    tabIndex={0}
                    title={t("session.deleteTitle")}
                    aria-label={t("session.deleteTitle")}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingDelete(session);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.stopPropagation();
                        setPendingDelete(session);
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </span>
                </span>
              </button>
            ),
          )
        )}
      </div>

      {pendingDelete ? (
        <div className="artifact-modal" onClick={() => setPendingDelete(null)}>
          <div className="confirm-panel" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-icon">
              <Trash2 size={18} />
            </div>
            <strong className="confirm-title">{t("session.deleteTitle")}</strong>
            <p className="confirm-body">{t("session.deleteBody", { title: pendingDelete.title })}</p>
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => setPendingDelete(null)}>
                {t("session.deleteCancel")}
              </button>
              <button
                className="confirm-delete"
                onClick={() => {
                  props.onDelete(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                {t("session.deleteConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
