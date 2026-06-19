import type {
  ReferenceFileTypeFilter,
  ReferenceListRequest,
  ReferenceListResponse,
  ReferenceSearchRequest,
  ResearchArtifact,
} from "@product-competition/shared";

import type { SessionStore } from "../local/session-store.js";

const GROUP_PREFIX = "session:";

/**
 * Surface captured research artifacts to Tutti: top level lists sessions as
 * groups, and drilling into a session lists its Markdown/JSON artifacts as
 * app-data-relative file references.
 */
export async function buildReferenceList(
  request: ReferenceListRequest,
  store: SessionStore,
): Promise<ReferenceListResponse> {
  const offset = decodeCursor(request.cursor);

  if (!request.parentGroupId) {
    const limit = request.limit ?? 20;
    const filterText = request.filterText?.toLowerCase();
    const sessions = await store.listSessions();

    // Build a group for every session with at least one artifact in range, so
    // pagination and counts cover the whole list (not just the first page).
    // `referenceCount` must be exact under kinds/timeRange and is unaffected by
    // filterText, which only narrows which session groups are shown.
    const groups = [];
    for (const session of sessions) {
      if (filterText && !session.title.toLowerCase().includes(filterText)) continue;
      const inRange = (await store.getArtifacts(session.id)).filter((artifact) =>
        withinTimeRange(artifact, request.timeRange),
      );
      if (inRange.length === 0) continue;
      groups.push({
        type: "group" as const,
        id: `${GROUP_PREFIX}${session.id}`,
        displayName: session.title,
        description: session.productName
          ? `Research on ${session.productName}`
          : `${inRange.length} artifact(s)`,
        referenceCount: inRange.length,
      });
    }

    const page = groups.slice(offset, offset + limit);
    return { items: page, nextCursor: cursorAfter(offset, page.length, groups.length) };
  }

  const sessionId = request.parentGroupId.startsWith(GROUP_PREFIX)
    ? request.parentGroupId.slice(GROUP_PREFIX.length)
    : null;
  if (!sessionId) {
    return { items: [], nextCursor: null };
  }

  const limit = request.limit ?? 50;
  const matched = (await store.getArtifacts(sessionId))
    .filter((artifact) => {
      if (!request.filterText) return true;
      const filterText = request.filterText.toLowerCase();
      return (
        artifact.title.toLowerCase().includes(filterText) ||
        (artifact.summary?.toLowerCase().includes(filterText) ?? false)
      );
    })
    .filter((artifact) => withinTimeRange(artifact, request.timeRange));

  const page = matched.slice(offset, offset + limit);
  const items = page.map((artifact) => ({
    type: "reference" as const,
    reference: {
      kind: "file" as const,
      displayName: displayName(artifact),
      ...(artifact.summary ? { description: artifact.summary } : {}),
      location: {
        type: "app-data-relative" as const,
        path: artifact.relativePath,
      },
      mimeType: mimeFor(artifact.relativePath),
      sizeBytes: artifact.sizeBytes,
      mtimeMs: Date.parse(artifact.createdAt),
      ...(request.filterText ? { score: 1 } : {}),
    },
  }));

  return { items, nextCursor: cursorAfter(offset, page.length, matched.length) };
}

/**
 * Recursive search across every session's artifacts (POST /tutti/references/search).
 * Unlike the per-level `filterText` on the list endpoint, this spans the whole
 * app and returns a flat list of file references, each tagged with its session
 * as `parentGroupLabel`.
 *
 * Per the references search contract, `query` and `filters` combine and either
 * alone is valid: when `query` is non-empty a file must match it by its own name
 * (results are relevance-ordered); when `query` is empty this is a "filter-only"
 * search that returns everything passing `filters`/`timeRange`, ordered by
 * recency. `filters` are global file-type categories matched by file extension.
 */
export async function searchReferences(
  request: ReferenceSearchRequest,
  store: SessionStore,
): Promise<ReferenceListResponse> {
  const query = request.query.trim().toLowerCase();
  const filters = new Set(request.filters ?? []);
  const fromMs = request.timeRange?.fromMs ?? Number.MIN_SAFE_INTEGER;
  const toMs = request.timeRange?.toMs ?? Number.MAX_SAFE_INTEGER;
  const limit = request.limit ?? 20;
  const offset = decodeCursor(request.cursor);

  const matches: Array<{
    score: number;
    mtimeMs: number;
    sessionTitle: string;
    artifact: ResearchArtifact;
  }> = [];
  for (const session of await store.listSessions()) {
    const artifacts = await store.getArtifacts(session.id);
    for (const artifact of artifacts) {
      const mtimeMs = Date.parse(artifact.createdAt);
      if (Number.isFinite(mtimeMs) && (mtimeMs < fromMs || mtimeMs > toMs)) continue;
      if (!matchesFilters(artifact.relativePath, filters)) continue;
      // Non-empty query must match by name; filter-only search keeps everything.
      const score = query ? relevance(query, artifact, session.title, session.productName) : 0;
      if (query && score <= 0) continue;
      matches.push({
        score,
        mtimeMs: Number.isFinite(mtimeMs) ? mtimeMs : 0,
        sessionTitle: session.title,
        artifact,
      });
    }
  }

  matches.sort((left, right) =>
    query ? right.score - left.score || right.mtimeMs - left.mtimeMs : right.mtimeMs - left.mtimeMs,
  );

  const page = matches.slice(offset, offset + limit);
  const items = page.map(({ score, sessionTitle, artifact }) => ({
    type: "reference" as const,
    reference: {
      kind: "file" as const,
      displayName: displayName(artifact),
      ...(artifact.summary ? { description: artifact.summary } : {}),
      location: {
        type: "app-data-relative" as const,
        path: artifact.relativePath,
      },
      mimeType: mimeFor(artifact.relativePath),
      sizeBytes: artifact.sizeBytes,
      mtimeMs: Date.parse(artifact.createdAt),
      // Score reflects name relevance; omit it for recency-ordered filter-only search.
      ...(query ? { score } : {}),
      parentGroupLabel: sessionTitle,
    },
  }));

  return { items, nextCursor: cursorAfter(offset, page.length, matches.length) };
}

/**
 * Relevance score in [0,1]; 0 excludes the file from results.
 *
 * Per the Tutti references search contract, a file may appear only when its own
 * name — the `displayName` we return, i.e. the artifact title or filename —
 * contains the query. The containing session title and product name must never
 * pull a non-matching file in; they only break ties between files that already
 * match by name (so searching a product surfaces that product's report, not
 * every generically-titled artifact that merely lives in the same session).
 */
function relevance(
  query: string,
  artifact: ResearchArtifact,
  sessionTitle: string,
  productName: string | undefined,
): number {
  const title = artifact.title.toLowerCase();
  const filename = (artifact.relativePath.split("/").pop() ?? "").toLowerCase();
  if (!title.includes(query) && !filename.includes(query)) return 0;

  let score = artifact.isCanonical ? 0.95 : 0.85;
  if (title.startsWith(query) || filename.startsWith(query)) score += 0.04;
  // Tie-breakers only: context can lift ranking but never forces inclusion.
  if ((productName ?? "").toLowerCase().includes(query)) score += 0.02;
  else if (sessionTitle.toLowerCase().includes(query)) score += 0.01;
  return Math.min(score, 1);
}

function displayName(artifact: ResearchArtifact): string {
  const filename = artifact.relativePath.split("/").pop() ?? artifact.title;
  if (artifact.kind === "report") return `${artifact.title} (${filename})`;
  return `${artifact.title} (${filename})`;
}

function mimeFor(relativePath: string): string {
  if (relativePath.endsWith(".md")) return "text/markdown";
  if (relativePath.endsWith(".json")) return "application/json";
  return "text/plain";
}

function withinTimeRange(
  artifact: ResearchArtifact,
  timeRange: ReferenceListRequest["timeRange"],
): boolean {
  if (!timeRange) return true;
  const createdAtMs = Date.parse(artifact.createdAt);
  if (!Number.isFinite(createdAtMs)) return true;
  const fromMs = timeRange.fromMs ?? Number.MIN_SAFE_INTEGER;
  const toMs = timeRange.toMs ?? Number.MAX_SAFE_INTEGER;
  return createdAtMs >= fromMs && createdAtMs <= toMs;
}

// --- Opaque offset cursors --------------------------------------------------
// Tutti treats `cursor`/`nextCursor` as opaque, so a base64url-encoded offset is
// enough to page deterministically over the recency-sorted result lists.

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const value = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Next-page cursor, or null when the current page reached the end. */
function cursorAfter(offset: number, pageLength: number, total: number): string | null {
  const next = offset + pageLength;
  return next < total ? Buffer.from(String(next), "utf8").toString("base64url") : null;
}

// --- Global file-type filters -----------------------------------------------
// Extension → category map mirroring the Tutti references search contract.

const FILE_TYPE_EXTENSIONS: Record<Exclude<ReferenceFileTypeFilter, "other">, ReadonlySet<string>> = {
  image: new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "heic"]),
  video: new Set(["mp4", "mov", "avi", "mkv", "webm"]),
  document: new Set([
    "pdf", "doc", "docx", "txt", "md", "markdown", "rtf", "odt", "pages", "key",
    "ppt", "pptx", "xls", "xlsx", "csv", "tsv", "numbers",
  ]),
  webpage: new Set(["html", "htm", "mhtml", "url", "webloc"]),
};

/** Map a file path to its global file-type category (the `other` fallback covers all else). */
function categorize(relativePath: string): ReferenceFileTypeFilter {
  const name = relativePath.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  for (const type of ["image", "video", "document", "webpage"] as const) {
    if (FILE_TYPE_EXTENSIONS[type].has(ext)) return type;
  }
  return "other";
}

/** OR semantics: with no filters everything matches; otherwise the file's category must be listed. */
function matchesFilters(
  relativePath: string,
  filters: ReadonlySet<ReferenceFileTypeFilter>,
): boolean {
  return filters.size === 0 || filters.has(categorize(relativePath));
}
