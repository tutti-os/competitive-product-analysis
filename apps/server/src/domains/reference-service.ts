import type {
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
  if (!request.parentGroupId) {
    const sessions = await store.listSessions();
    const filtered = sessions.filter((session) => {
      if (!request.filterText) return true;
      return session.title.toLowerCase().includes(request.filterText.toLowerCase());
    });

    const groups = [];
    for (const session of filtered.slice(0, request.limit ?? 20)) {
      const artifacts = await store.getArtifacts(session.id);
      if (artifacts.length === 0) continue;
      groups.push({
        type: "group" as const,
        id: `${GROUP_PREFIX}${session.id}`,
        displayName: session.title,
        description: session.productName
          ? `Research on ${session.productName}`
          : `${artifacts.length} artifact(s)`,
        referenceCount: artifacts.length,
      });
    }

    return { items: groups, nextCursor: null };
  }

  const sessionId = request.parentGroupId.startsWith(GROUP_PREFIX)
    ? request.parentGroupId.slice(GROUP_PREFIX.length)
    : null;
  if (!sessionId) {
    return { items: [], nextCursor: null };
  }

  const artifacts = (await store.getArtifacts(sessionId))
    .filter((artifact) => {
      if (!request.filterText) return true;
      const filterText = request.filterText.toLowerCase();
      return (
        artifact.title.toLowerCase().includes(filterText) ||
        (artifact.summary?.toLowerCase().includes(filterText) ?? false)
      );
    })
    .filter((artifact) => {
      if (!request.timeRange) return true;
      const createdAtMs = Date.parse(artifact.createdAt);
      const fromMs = request.timeRange.fromMs ?? Number.MIN_SAFE_INTEGER;
      const toMs = request.timeRange.toMs ?? Number.MAX_SAFE_INTEGER;
      return createdAtMs >= fromMs && createdAtMs <= toMs;
    })
    .slice(0, request.limit ?? 50);

  const items = artifacts.map((artifact) => ({
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

  return { items, nextCursor: null };
}

/**
 * Recursive search across every session's artifacts (POST /tutti/references/search).
 * Unlike the per-level `filterText` on the list endpoint, this spans the whole
 * app and returns a flat, relevance-ordered list of file references, each tagged
 * with its session as `parentGroupLabel`.
 */
export async function searchReferences(
  request: ReferenceSearchRequest,
  store: SessionStore,
): Promise<ReferenceListResponse> {
  const query = request.query.toLowerCase();
  const fromMs = request.timeRange?.fromMs ?? Number.MIN_SAFE_INTEGER;
  const toMs = request.timeRange?.toMs ?? Number.MAX_SAFE_INTEGER;

  const matches: Array<{ score: number; sessionTitle: string; artifact: ResearchArtifact }> = [];
  for (const session of await store.listSessions()) {
    const artifacts = await store.getArtifacts(session.id);
    for (const artifact of artifacts) {
      const mtimeMs = Date.parse(artifact.createdAt);
      if (Number.isFinite(mtimeMs) && (mtimeMs < fromMs || mtimeMs > toMs)) continue;
      const score = relevance(query, artifact, session.title, session.productName);
      if (score <= 0) continue;
      matches.push({ score, sessionTitle: session.title, artifact });
    }
  }

  matches.sort((left, right) => right.score - left.score);

  const items = matches.slice(0, request.limit ?? 20).map(({ score, sessionTitle, artifact }) => ({
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
      score,
      parentGroupLabel: sessionTitle,
    },
  }));

  return { items, nextCursor: null };
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
