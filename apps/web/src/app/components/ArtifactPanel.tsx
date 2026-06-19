import { useEffect, useState } from "react";
import { ChevronRight, FileText, FileJson, Flag, Folder, LoaderCircle, X } from "lucide-react";

import type { ResearchArtifact } from "@product-competition/shared";

import { fetchArtifactContent } from "../api.js";
import { useTranslation } from "../i18n/index.js";
import { Markdown } from "./Markdown.js";

export function ArtifactPanel(props: { sessionId: string; artifacts: ResearchArtifact[] }) {
  const { t } = useTranslation();
  const [active, setActive] = useState<ResearchArtifact | null>(null);
  const [rawExpanded, setRawExpanded] = useState(false);

  if (props.artifacts.length === 0) {
    return (
      <aside className="artifact-rail artifact-rail-empty">
        <div className="artifact-rail-header">{t("library.sessionArtifacts")}</div>
        <p className="artifact-empty">{t("library.empty")}</p>
      </aside>
    );
  }

  const primaryArtifacts = props.artifacts.filter((artifact) => artifact.kind !== "raw");
  const rawArtifacts = props.artifacts.filter((artifact) => artifact.kind === "raw");

  return (
    <aside className="artifact-rail">
      <div className="artifact-rail-header">{t("library.sessionArtifacts")}</div>
      <div className="artifact-list">
        {primaryArtifacts.map((artifact) => (
          <ArtifactRow key={artifact.id} artifact={artifact} onOpen={() => setActive(artifact)} />
        ))}

        {rawArtifacts.length > 0 ? (
          <div className="artifact-group">
            <button
              className="artifact-group-toggle"
              onClick={() => setRawExpanded((value) => !value)}
              aria-expanded={rawExpanded}
            >
              <ChevronRight
                size={15}
                className={`artifact-chevron${rawExpanded ? " open" : ""}`}
              />
              <Folder size={15} className="artifact-icon" />
              <span className="artifact-meta">
                <span className="artifact-title">{t("library.rawFiles")}</span>
                <span className="artifact-sub">{t("library.rawCount", { count: rawArtifacts.length })}</span>
              </span>
            </button>
            {rawExpanded ? (
              <div className="artifact-group-items">
                {rawArtifacts.map((artifact) => (
                  <ArtifactRow key={artifact.id} artifact={artifact} onOpen={() => setActive(artifact)} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {active ? (
        <ArtifactPreview sessionId={props.sessionId} artifact={active} onClose={() => setActive(null)} />
      ) : null}
    </aside>
  );
}

function ArtifactRow(props: { artifact: ResearchArtifact; onOpen: () => void }) {
  const { t } = useTranslation();
  const { artifact } = props;
  return (
    <button className="artifact-item" onClick={props.onOpen} title={artifact.relativePath}>
      <ArtifactIcon kind={artifact.kind} />
      <span className="artifact-meta">
        <span className="artifact-title">{artifact.title}</span>
        <span className="artifact-sub">
          {artifact.isCanonical ? `${t("library.report")} · ` : ""}
          {formatSize(artifact.sizeBytes)}
        </span>
      </span>
    </button>
  );
}

function ArtifactPreview(props: {
  sessionId: string;
  artifact: ResearchArtifact;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    fetchArtifactContent(props.sessionId, props.artifact.id)
      .then((result) => {
        if (!cancelled) setContent(result.content);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : t("library.loadError"));
      });
    return () => {
      cancelled = true;
    };
  }, [props.sessionId, props.artifact.id, t]);

  const isJson = props.artifact.relativePath.endsWith(".json");

  return (
    <div className="artifact-modal" onClick={props.onClose}>
      <div
        className="artifact-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`artifact-title-${props.artifact.id}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="artifact-modal-header">
          <div>
            <strong id={`artifact-title-${props.artifact.id}`}>{props.artifact.title}</strong>
            <span className="artifact-modal-path">{props.artifact.relativePath}</span>
          </div>
          <button className="icon-button" onClick={props.onClose} aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="artifact-modal-body">
          {error ? <p className="error-banner">{error}</p> : null}
          {content === null && !error ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={16} />
              <span>{t("library.loading")}</span>
            </div>
          ) : null}
          {content !== null ? (
            isJson ? (
              <pre className="artifact-json">{content}</pre>
            ) : (
              <Markdown source={content} />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ArtifactIcon(props: { kind: ResearchArtifact["kind"] }) {
  if (props.kind === "report") return <Flag size={15} className="artifact-icon report" />;
  if (props.kind === "meta") return <FileJson size={15} className="artifact-icon" />;
  return <FileText size={15} className="artifact-icon" />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
