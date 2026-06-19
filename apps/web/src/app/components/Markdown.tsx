import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

/**
 * Render Markdown to HTML. The source includes agent-generated reports and raw
 * web evidence, which can carry embedded HTML or `<script>` fragments, so the
 * rendered HTML is sanitized with DOMPurify before it is injected — never trust
 * it just because the app is local-first (a Tutti Desktop webview may expose a
 * host bridge). Keep this the single Markdown render site so sanitization is
 * never bypassed.
 */
export function Markdown(props: { source: string; className?: string }) {
  const html = useMemo(() => {
    const rendered = marked.parse(props.source ?? "", { async: false }) as string;
    return DOMPurify.sanitize(rendered);
  }, [props.source]);
  return (
    <div
      className={`markdown ${props.className ?? ""}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
