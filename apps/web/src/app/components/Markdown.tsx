import { useMemo } from "react";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

/**
 * Render Markdown to HTML. Content is produced by the local research agent in a
 * local-first app, so we render it directly; keep this component the single
 * place that does so.
 */
export function Markdown(props: { source: string; className?: string }) {
  const html = useMemo(() => marked.parse(props.source ?? "", { async: false }) as string, [props.source]);
  return (
    <div
      className={`markdown ${props.className ?? ""}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
