import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { nanoid } from "nanoid";
import type {
  ChatMessage,
  ContentBlock,
  CreateSessionInput,
  ResearchArtifact,
  ResearchSession,
  SessionStatus,
} from "@product-competition/shared";

import type { AppRuntimePaths } from "../config.js";

interface SessionsIndex {
  activeSessionId: string | null;
  sessions: ResearchSession[];
}

/**
 * File-based persistence for the chat-first workspace. Each session owns a
 * directory under dataDir/sessions/<id> holding its messages, artifact index,
 * and per-run working directories.
 */
export class SessionStore {
  private writeQueue: Promise<unknown> = Promise.resolve();
  /** Per-session serialization for messages.json read-modify-write. */
  private readonly messageQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly paths: AppRuntimePaths) {}

  // --- index -------------------------------------------------------------

  async loadIndex(): Promise<SessionsIndex> {
    try {
      const raw = await readFile(this.paths.sessionsIndexFile, "utf8");
      const parsed = JSON.parse(raw) as SessionsIndex;
      if (!Array.isArray(parsed.sessions)) {
        return { activeSessionId: null, sessions: [] };
      }
      return {
        activeSessionId: parsed.activeSessionId ?? null,
        sessions: parsed.sessions,
      };
    } catch {
      return { activeSessionId: null, sessions: [] };
    }
  }

  async listSessions(): Promise<ResearchSession[]> {
    const index = await this.loadIndex();
    return [...index.sessions].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
  }

  async getActiveSessionId(): Promise<string | null> {
    return (await this.loadIndex()).activeSessionId;
  }

  async setActiveSessionId(sessionId: string | null): Promise<void> {
    await this.mutateIndex((index) => ({ ...index, activeSessionId: sessionId }));
  }

  async getSession(sessionId: string): Promise<ResearchSession | null> {
    const index = await this.loadIndex();
    return index.sessions.find((session) => session.id === sessionId) ?? null;
  }

  async createSession(input: CreateSessionInput): Promise<ResearchSession> {
    const now = new Date().toISOString();
    const session: ResearchSession = {
      id: nanoid(),
      title: input.title?.trim() || "New research",
      status: "idle",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      artifactCount: 0,
    };
    await mkdir(this.sessionDir(session.id), { recursive: true });
    await this.writeMessages(session.id, []);
    await this.writeArtifacts(session.id, []);
    await this.mutateIndex((index) => ({
      activeSessionId: session.id,
      sessions: [session, ...index.sessions],
    }));
    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.mutateIndex((index) => {
      const sessions = index.sessions.filter((session) => session.id !== sessionId);
      const activeSessionId =
        index.activeSessionId === sessionId ? sessions[0]?.id ?? null : index.activeSessionId;
      return { activeSessionId, sessions };
    });
    await rm(this.sessionDir(sessionId), { recursive: true, force: true });
  }

  async updateSession(
    sessionId: string,
    patch: Partial<
      Pick<
        ResearchSession,
        "title" | "productName" | "status" | "lastRunId" | "agentTargetId" | "providerId" | "provider"
      >
    >,
  ): Promise<ResearchSession | null> {
    let updated: ResearchSession | null = null;
    await this.mutateIndex((index) => ({
      ...index,
      sessions: index.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        updated = {
          ...session,
          ...patch,
          updatedAt: new Date().toISOString(),
        };
        return updated;
      }),
    }));
    return updated;
  }

  // --- messages ----------------------------------------------------------

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      const raw = await readFile(this.messagesFile(sessionId), "utf8");
      const parsed = JSON.parse(raw) as ChatMessage[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Insert or replace a message by id, then refresh the session message count. */
  async upsertMessage(sessionId: string, message: ChatMessage): Promise<void> {
    // Serialize per-session so rapid incremental persistence during a streaming
    // run does not clobber concurrent read-modify-write cycles on messages.json.
    const previous = this.messageQueues.get(sessionId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const messages = await this.getMessages(sessionId);
      const index = messages.findIndex((item) => item.id === message.id);
      if (index >= 0) {
        messages[index] = message;
      } else {
        messages.push(message);
      }
      await this.writeMessages(sessionId, messages);
      await this.refreshCounts(sessionId, { messageCount: messages.length });
    });
    this.messageQueues.set(
      sessionId,
      next.catch(() => undefined),
    );
    return next;
  }

  // --- artifacts ---------------------------------------------------------

  async getArtifacts(sessionId: string): Promise<ResearchArtifact[]> {
    try {
      const raw = await readFile(this.artifactsFile(sessionId), "utf8");
      const parsed = JSON.parse(raw) as ResearchArtifact[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async addArtifacts(sessionId: string, artifacts: ResearchArtifact[]): Promise<ResearchArtifact[]> {
    if (artifacts.length === 0) return this.getArtifacts(sessionId);
    const existing = await this.getArtifacts(sessionId);
    const byPath = new Map(existing.map((artifact) => [artifact.relativePath, artifact]));
    for (const artifact of artifacts) {
      byPath.set(artifact.relativePath, artifact);
    }
    const merged = [...byPath.values()].sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );
    await this.writeArtifacts(sessionId, merged);
    await this.refreshCounts(sessionId, { artifactCount: merged.length });
    return merged;
  }

  /**
   * Read one captured artifact's content, resolving its data-relative path
   * against dataDir and rejecting any path that escapes the data root. Shared by
   * the HTTP artifact-content route and the Tutti CLI `report` command so both
   * apply the same containment check. Returns null when the artifact is unknown
   * or unreadable.
   */
  async readArtifactContent(
    sessionId: string,
    artifactId: string,
  ): Promise<{ artifact: ResearchArtifact; content: string; mimeType: string } | null> {
    const artifact = (await this.getArtifacts(sessionId)).find((item) => item.id === artifactId);
    if (!artifact) return null;
    const dataRoot = path.resolve(this.paths.dataDir);
    const absolute = path.resolve(dataRoot, artifact.relativePath);
    if (absolute !== dataRoot && !absolute.startsWith(dataRoot + path.sep)) return null;
    try {
      const content = await readFile(absolute, "utf8");
      return {
        artifact,
        content,
        mimeType: artifact.relativePath.endsWith(".json") ? "application/json" : "text/markdown",
      };
    } catch {
      return null;
    }
  }

  // --- recovery / self-healing -------------------------------------------

  /**
   * Add sessions that exist on disk (with at least one persisted message) but
   * are missing from the index. Guards against the "directory written, index
   * update interrupted" window in createSession and against an index.json that
   * lost entries. Never resurrects zombie directories that only hold run
   * working dirs (e.g. an orphaned run that recreated its cwd after delete).
   */
  async recoverOrphanSessions(): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(this.paths.sessionsDir);
    } catch {
      return 0;
    }
    const index = await this.loadIndex();
    const known = new Set(index.sessions.map((session) => session.id));
    const recovered: ResearchSession[] = [];
    for (const name of entries) {
      if (name === "index.json" || name.startsWith(".") || known.has(name)) continue;
      const session = await this.buildSessionFromDisk(name);
      if (session) recovered.push(session);
    }
    if (recovered.length === 0) return 0;
    await this.mutateIndex((current) => ({
      ...current,
      sessions: [...current.sessions, ...recovered],
    }));
    return recovered.length;
  }

  /**
   * One-time startup reconciliation: recover orphan sessions, then mark any
   * session still flagged "running" as failed. Safe to flip running -> failed
   * here because at process startup no run can be active in memory, so a
   * lingering "running" is always a crash/restart remnant.
   */
  async reconcileOnStartup(): Promise<{ recovered: number; interrupted: number }> {
    const recovered = await this.recoverOrphanSessions();
    const index = await this.loadIndex();
    let interrupted = 0;
    for (const session of index.sessions) {
      if (session.status === "running") {
        interrupted += 1;
        await this.markInterrupted(session.id);
      }
    }
    return { recovered, interrupted };
  }

  private async buildSessionFromDisk(sessionId: string): Promise<ResearchSession | null> {
    const dir = this.sessionDir(sessionId);
    let dirStat;
    try {
      dirStat = await stat(dir);
    } catch {
      return null;
    }
    if (!dirStat.isDirectory()) return null;
    const [messages, artifacts] = await Promise.all([
      this.getMessages(sessionId),
      this.getArtifacts(sessionId),
    ]);
    // Only recover real conversations; skip zombie dirs that only carry run cwds.
    if (messages.length === 0) return null;

    const firstUserText = messages
      .find((message) => message.role === "user")
      ?.contentBlocks.find((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
      ?.text;
    const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    let status: SessionStatus = "idle";
    if (lastAssistant?.runStatus === "done") status = "done";
    else if (lastAssistant?.runStatus === "failed" || lastAssistant?.runStatus === "cancelled") status = "failed";
    else if (lastAssistant?.runStatus === "running") status = "running";

    const fallbackTime = dirStat.mtime.toISOString();
    return {
      id: sessionId,
      title: deriveRecoveredTitle(firstUserText),
      status,
      createdAt: messages[0]?.createdAt ?? fallbackTime,
      updatedAt: messages[messages.length - 1]?.createdAt ?? fallbackTime,
      ...(lastAssistant?.runId ? { lastRunId: lastAssistant.runId } : {}),
      messageCount: messages.length,
      artifactCount: artifacts.length,
    };
  }

  private async markInterrupted(sessionId: string): Promise<void> {
    const messages = await this.getMessages(sessionId);
    let changed = false;
    const patched = messages.map((message) => {
      if (message.role !== "assistant" || message.runStatus !== "running") return message;
      changed = true;
      const blocks: ContentBlock[] = message.contentBlocks.map((block) =>
        block.type === "tool" && block.status === "running"
          ? { ...block, status: "failed" as const }
          : block,
      );
      blocks.push({ type: "text", text: "Run interrupted: the server restarted before it finished." });
      return { ...message, contentBlocks: blocks, runStatus: "failed" as const };
    });
    if (changed) {
      await this.writeMessages(sessionId, patched);
    }
    await this.updateSession(sessionId, { status: "failed" });
  }

  // --- paths -------------------------------------------------------------

  sessionDir(sessionId: string): string {
    return path.join(this.paths.sessionsDir, sessionId);
  }

  runDir(sessionId: string, runId: string): string {
    return path.join(this.sessionDir(sessionId), "runs", runId);
  }

  /** POSIX path relative to dataDir, suitable for app-data-relative references. */
  toDataRelative(absolutePath: string): string {
    return path.relative(this.paths.dataDir, absolutePath).split(path.sep).join("/");
  }

  // --- internals ---------------------------------------------------------

  private messagesFile(sessionId: string) {
    return path.join(this.sessionDir(sessionId), "messages.json");
  }

  private artifactsFile(sessionId: string) {
    return path.join(this.sessionDir(sessionId), "artifacts.json");
  }

  private async writeMessages(sessionId: string, messages: ChatMessage[]) {
    await mkdir(this.sessionDir(sessionId), { recursive: true });
    await writeFile(this.messagesFile(sessionId), `${JSON.stringify(messages, null, 2)}\n`, "utf8");
  }

  private async writeArtifacts(sessionId: string, artifacts: ResearchArtifact[]) {
    await mkdir(this.sessionDir(sessionId), { recursive: true });
    await writeFile(this.artifactsFile(sessionId), `${JSON.stringify(artifacts, null, 2)}\n`, "utf8");
  }

  private async refreshCounts(
    sessionId: string,
    counts: { messageCount?: number; artifactCount?: number },
  ) {
    await this.mutateIndex((index) => ({
      ...index,
      sessions: index.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              ...(counts.messageCount !== undefined ? { messageCount: counts.messageCount } : {}),
              ...(counts.artifactCount !== undefined ? { artifactCount: counts.artifactCount } : {}),
              updatedAt: new Date().toISOString(),
            }
          : session,
      ),
    }));
  }

  /** Serialize index writes so concurrent run events don't clobber each other. */
  private mutateIndex(mutator: (index: SessionsIndex) => SessionsIndex): Promise<void> {
    const next = this.writeQueue.then(async () => {
      const current = await this.loadIndex();
      const updated = mutator(current);
      await mkdir(this.paths.sessionsDir, { recursive: true });
      await writeFile(this.paths.sessionsIndexFile, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    });
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  setSessionStatus(sessionId: string, status: SessionStatus) {
    return this.updateSession(sessionId, { status });
  }
}

function deriveRecoveredTitle(firstUserText: string | undefined): string {
  const compact = (firstUserText ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return "Recovered research";
  return compact.length > 48 ? `${compact.slice(0, 48)}…` : compact;
}
