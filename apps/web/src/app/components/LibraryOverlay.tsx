import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search, X } from "lucide-react";

import type { ResearchSession } from "@product-competition/shared";

import { useTranslation } from "../i18n/index.js";

export function LibraryOverlay(props: {
  sessions: ResearchSession[];
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}) {
  const { t, locale } = useTranslation();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const withArtifacts = useMemo(
    () => props.sessions.filter((session) => session.artifactCount > 0),
    [props.sessions],
  );

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return withArtifacts;
    return withArtifacts.filter((session) => session.title.toLowerCase().includes(trimmed));
  }, [withArtifacts, query]);

  return (
    <div className="artifact-modal" onClick={props.onClose}>
      <div className="library-panel" onClick={(event) => event.stopPropagation()}>
        <header className="artifact-modal-header">
          <div className="library-search">
            <Search size={16} />
            <input
              ref={inputRef}
              className="library-search-input"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (query) {
                    setQuery("");
                  } else {
                    props.onClose();
                  }
                }
              }}
              placeholder={t("library.searchPlaceholder")}
              aria-label={t("library.title")}
            />
          </div>
          <button className="icon-button" onClick={props.onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="library-body">
          {withArtifacts.length === 0 ? (
            <p className="artifact-empty">{t("library.globalEmpty")}</p>
          ) : results.length === 0 ? (
            <p className="artifact-empty">{t("library.noMatch", { query: query.trim() })}</p>
          ) : (
            results.map((session) => (
              <button
                key={session.id}
                className="library-row"
                onClick={() => {
                  props.onSelect(session.id);
                  props.onClose();
                }}
              >
                <FileText size={16} />
                <span className="library-row-meta">
                  <span className="library-row-title">{session.title}</span>
                  <span className="library-row-sub">
                    {session.productName ? `${session.productName} · ` : ""}
                    {t("session.artifacts", { count: session.artifactCount })} ·{" "}
                    {formatDate(session.updatedAt, locale)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}
