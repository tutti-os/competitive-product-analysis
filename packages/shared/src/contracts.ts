import { z } from "zod";

/**
 * Competitive Analysis is a chat-first workspace: every research task is
 * a conversation, the local agent drives the product-swipefile skill, and the
 * artifacts it produces (report.md / inventory.md / raw / meta.json) are
 * captured under a single, unified store and surfaced as Tutti references.
 */

// ---------------------------------------------------------------------------
// Conversation content model (mirrors the ai-media-canvas contentBlock model)
// ---------------------------------------------------------------------------

export const messageRoleSchema = z.enum(["user", "assistant"]);

export const toolBlockStatusSchema = z.enum(["running", "completed", "failed"]);

export const textBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const thinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  text: z.string(),
  done: z.boolean().optional(),
});

export const toolBlockSchema = z.object({
  type: z.literal("tool"),
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  status: toolBlockStatusSchema,
  summary: z.string().optional(),
});

export const contentBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  thinkingBlockSchema,
  toolBlockSchema,
]);

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  role: messageRoleSchema,
  contentBlocks: z.array(contentBlockSchema),
  createdAt: z.string(),
  runId: z.string().optional(),
  runStatus: z.enum(["running", "done", "failed", "cancelled"]).optional(),
});

// ---------------------------------------------------------------------------
// Research artifacts (the unified output store)
// ---------------------------------------------------------------------------

export const artifactKindSchema = z.enum([
  "report",
  "inventory",
  "meta",
  "checkpoint",
  "raw",
  "other",
]);

export const researchArtifactSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().optional(),
  kind: artifactKindSchema,
  title: z.string().min(1),
  /** Path relative to TUTTI_APP_DATA_DIR, always POSIX-separated. */
  relativePath: z.string().min(1),
  sizeBytes: z.number().int().min(0),
  createdAt: z.string(),
  /** The canonical report for the run (the one a user should open first). */
  isCanonical: z.boolean().optional(),
  summary: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const sessionStatusSchema = z.enum(["idle", "running", "done", "failed"]);

export const researchSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  productName: z.string().optional(),
  status: sessionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunId: z.string().optional(),
  messageCount: z.number().int().min(0),
  artifactCount: z.number().int().min(0),
});

// ---------------------------------------------------------------------------
// Agent providers
// ---------------------------------------------------------------------------

export const agentProviderSummarySchema = z.object({
  provider: z.string().min(1),
  label: z.string().min(1),
  detected: z.boolean(),
  supported: z.boolean(),
  status: z.enum(["ready", "not-installed", "unsupported"]),
  models: z.array(z.string()),
  reason: z.string().optional(),
});

// ---------------------------------------------------------------------------
// HTTP payloads
// ---------------------------------------------------------------------------

export const bootstrapResponseSchema = z.object({
  sessions: z.array(researchSessionSchema),
  activeSessionId: z.string().nullable(),
  agentProviders: z.array(agentProviderSummarySchema),
  /** Provider the UI should preselect (skill is tuned for Claude). */
  defaultProvider: z.string().nullable(),
});

export const createSessionInputSchema = z.object({
  title: z.string().optional(),
});

export const sessionMessagesResponseSchema = z.object({
  session: researchSessionSchema,
  messages: z.array(chatMessageSchema),
  artifacts: z.array(researchArtifactSchema),
});

// ---------------------------------------------------------------------------
// Tutti references
// ---------------------------------------------------------------------------

export const referenceListRequestSchema = z.object({
  parentGroupId: z.string().optional().nullable(),
  filterText: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().optional().nullable(),
  kinds: z.array(z.literal("file")).optional(),
  timeRange: z
    .object({
      fromMs: z.number().int().optional(),
      toMs: z.number().int().optional(),
    })
    .optional(),
});

export const referenceLocationSchema = z.object({
  type: z.enum(["app-data-relative", "app-package-relative"]),
  path: z.string().min(1),
});

export const fileReferenceSchema = z.object({
  kind: z.literal("file"),
  displayName: z.string().min(1),
  description: z.string().optional(),
  location: referenceLocationSchema,
  sizeBytes: z.number().int().optional(),
  mtimeMs: z.number().int().optional(),
  mimeType: z.string().optional(),
  score: z.number().min(0).max(1).optional(),
  /** Context subtitle for flattened search results (the file's session/group). */
  parentGroupLabel: z.string().max(160).optional(),
});

export const referenceGroupSchema = z.object({
  type: z.literal("group"),
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  referenceCount: z.number().int().min(0),
});

export const referenceItemSchema = z.union([
  referenceGroupSchema,
  z.object({
    type: z.literal("reference"),
    reference: fileReferenceSchema,
  }),
]);

export const referenceListResponseSchema = z.object({
  items: z.array(referenceItemSchema),
  nextCursor: z.string().nullable().optional(),
});

/**
 * Global file-type categories the references search box can filter by. Tutti
 * maps file extensions into these buckets; an app receives the bucket ids and
 * returns only references whose own name falls into one of them (OR semantics).
 */
export const referenceFileTypeFilterSchema = z.enum([
  "image",
  "video",
  "document",
  "webpage",
  "other",
]);

/**
 * Recursive search request (POST /tutti/references/search). Per the Tutti
 * references search contract, `query` and `filters` combine and either alone is
 * a valid query: `query` may be empty when `filters` is non-empty ("filter-only"
 * search), in which case all references matching the filters are returned,
 * ordered by recency.
 */
export const referenceSearchRequestSchema = z.object({
  query: z.string().default(""),
  filters: z.array(referenceFileTypeFilterSchema).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().optional().nullable(),
  kinds: z.array(z.literal("file")).optional(),
  timeRange: z
    .object({
      fromMs: z.number().int().optional(),
      toMs: z.number().int().optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Tutti CLI capability surface (tutti.cli.json -> /tutti/cli/*)
//
// These shapes mirror the command inputSchemas declared in tutti.cli.json so
// other Tutti apps and agents can call this app's research library and kick off
// runs through the bundled Tutti CLI. Keep the two in sync.
// ---------------------------------------------------------------------------

export const cliStatusRequestSchema = z.object({}).passthrough();

export const cliSessionsRequestSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const cliReportsRequestSchema = z.object({
  session: z.string().optional(),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export const cliReportRequestSchema = z.object({
  session: z.string().min(1),
  artifact: z.string().min(1),
});

export const cliResearchRequestSchema = z.object({
  product: z.string().min(1),
  session: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
});

/**
 * Response envelope every /tutti/cli/* handler returns. App-to-app callers use
 * `--json`, so handlers always emit the `json` kind; the `table` variant is
 * declared for completeness and human-facing rendering.
 */
export type CliCommandOutput =
  | { kind: "json"; value: unknown }
  | {
      kind: "table";
      columns: Array<{ key: string; label: string }>;
      rows: Array<Record<string, string | number | boolean | null>>;
    };

// ---------------------------------------------------------------------------
// WebSocket client messages
// ---------------------------------------------------------------------------

export const agentRunStartRequestSchema = z.object({
  type: z.literal("start"),
  sessionId: z.string().min(1),
  prompt: z.string().min(1),
  provider: z.string().optional(),
  model: z.string().optional(),
});

export const agentRunCancelRequestSchema = z.object({
  type: z.literal("cancel"),
  runId: z.string().min(1),
});

export const agentRunClientMessageSchema = z.union([
  agentRunStartRequestSchema,
  agentRunCancelRequestSchema,
]);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type MessageRole = z.infer<typeof messageRoleSchema>;
export type ToolBlockStatus = z.infer<typeof toolBlockStatusSchema>;
export type TextBlock = z.infer<typeof textBlockSchema>;
export type ThinkingBlock = z.infer<typeof thinkingBlockSchema>;
export type ToolBlock = z.infer<typeof toolBlockSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type ResearchArtifact = z.infer<typeof researchArtifactSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type ResearchSession = z.infer<typeof researchSessionSchema>;
export type AgentProviderSummary = z.infer<typeof agentProviderSummarySchema>;
export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type SessionMessagesResponse = z.infer<typeof sessionMessagesResponseSchema>;
export type ReferenceListRequest = z.infer<typeof referenceListRequestSchema>;
export type ReferenceListResponse = z.infer<typeof referenceListResponseSchema>;
export type ReferenceSearchRequest = z.infer<typeof referenceSearchRequestSchema>;
export type ReferenceFileTypeFilter = z.infer<typeof referenceFileTypeFilterSchema>;
export type CliStatusRequest = z.infer<typeof cliStatusRequestSchema>;
export type CliSessionsRequest = z.infer<typeof cliSessionsRequestSchema>;
export type CliReportsRequest = z.infer<typeof cliReportsRequestSchema>;
export type CliReportRequest = z.infer<typeof cliReportRequestSchema>;
export type CliResearchRequest = z.infer<typeof cliResearchRequestSchema>;
export type FileReference = z.infer<typeof fileReferenceSchema>;
export type ReferenceGroup = z.infer<typeof referenceGroupSchema>;
export type AgentRunClientMessage = z.infer<typeof agentRunClientMessageSchema>;
export type AgentRunStartRequest = z.infer<typeof agentRunStartRequestSchema>;
export type AgentRunCancelRequest = z.infer<typeof agentRunCancelRequestSchema>;

/**
 * Streaming events emitted while the agent drives a research run. The web
 * client folds these into the assistant message's contentBlocks (text /
 * thinking / tool) and, on completion, into the session artifact list.
 */
export type AgentRunEvent =
  | { type: "run_started"; runId: string; sessionId: string; provider: string; model: string }
  | { type: "status"; runId: string; message: string }
  | { type: "thinking_delta"; runId: string; text: string }
  | { type: "text_delta"; runId: string; text: string }
  | { type: "tool_call"; runId: string; id: string; name: string; input?: unknown }
  | {
      type: "tool_result";
      runId: string;
      id: string;
      name?: string;
      status?: "completed" | "failed";
      summary?: string;
    }
  | { type: "file_write"; runId: string; path: string }
  | { type: "artifacts_ready"; runId: string; sessionId: string; artifacts: ResearchArtifact[] }
  | { type: "assistant_message"; runId: string; sessionId: string; message: ChatMessage }
  | { type: "session_updated"; runId: string; session: ResearchSession }
  | { type: "run_failed"; runId: string; message: string }
  | { type: "run_finished"; runId: string };
