import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, ShieldAlert } from "lucide-react";

import type {
  AgentTargetSummary,
  AgentRunEvent,
  ChatMessage,
  ResearchArtifact,
  ResearchSession,
} from "@product-competition/shared";
import { resolveInitialAgentSelection } from "@product-competition/shared";

import {
  activateSession,
  createSession,
  deleteSession,
  fetchBootstrap,
  fetchSessionMessages,
  renameSession,
  startAgentRun,
  type AgentRunHandle,
} from "./api.js";
import { applyEventToBlocks } from "./chat-stream.js";
import { useTranslation } from "./i18n/index.js";
import { ChatThread } from "./components/ChatThread.js";
import { ChatInput } from "./components/ChatInput.js";
import { SessionSidebar } from "./components/SessionSidebar.js";
import { ArtifactPanel } from "./components/ArtifactPanel.js";
import { LibraryOverlay } from "./components/LibraryOverlay.js";
import type { AgentSelection } from "./components/AgentSelector.js";

const SELECTION_KEY = "pc:agent-selection";
const PENDING_ID = "__pending_assistant__";

export function App() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentTargetSummary[]>([]);
  const [selection, setSelection] = useState<AgentSelection | null>(null);

  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  const [artifactsBySession, setArtifactsBySession] = useState<Record<string, ResearchArtifact[]>>({});

  // Track which sessions have an in-flight run so multiple sessions can stream
  // concurrently — running is a per-session fact, not a global one.
  const [runningSessionIds, setRunningSessionIds] = useState<string[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);

  // One run handle per session, keyed by sessionId, so each concurrent run can
  // be cancelled independently.
  const handlesRef = useRef<Map<string, AgentRunHandle>>(new Map());

  function markRunning(sessionId: string, running: boolean) {
    setRunningSessionIds((current) => {
      const has = current.includes(sessionId);
      if (running === has) return current;
      return running ? [...current, sessionId] : current.filter((id) => id !== sessionId);
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const boot = await fetchBootstrap();
        if (cancelled) return;
        setSessions(boot.sessions);
        setAgents(boot.agentTargets);
        setActiveSessionId(boot.activeSessionId);
        let storedSelection: unknown;
        try {
          const stored = localStorage.getItem(SELECTION_KEY);
          storedSelection = stored ? JSON.parse(stored) : undefined;
        } catch {
          storedSelection = undefined;
        }
        setSelection(
          resolveInitialAgentSelection(
            boot.agentTargets,
            boot.defaultAgentTargetId,
            storedSelection,
          ),
        );
        if (boot.activeSessionId) {
          await loadSession(boot.activeSessionId);
        }
      } catch (nextError) {
        if (!cancelled) setError(errorMessage(nextError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeMessages = activeSessionId ? messagesBySession[activeSessionId] ?? [] : [];
  const activeArtifacts = activeSessionId ? artifactsBySession[activeSessionId] ?? [] : [];
  const activeIsRunning = activeSessionId ? runningSessionIds.includes(activeSessionId) : false;

  async function loadSession(sessionId: string) {
    try {
      const result = await fetchSessionMessages(sessionId);
      setMessagesBySession((current) => ({ ...current, [sessionId]: result.messages }));
      setArtifactsBySession((current) => ({ ...current, [sessionId]: result.artifacts }));
      setSessions((current) =>
        current.map((session) => (session.id === sessionId ? result.session : session)),
      );
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  }

  function updateMessages(sessionId: string, updater: (messages: ChatMessage[]) => ChatMessage[]) {
    setMessagesBySession((current) => ({
      ...current,
      [sessionId]: updater(current[sessionId] ?? []),
    }));
  }

  async function handleSelectSession(sessionId: string) {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    void activateSession(sessionId).catch(() => undefined);
    if (!messagesBySession[sessionId]) {
      await loadSession(sessionId);
    }
  }

  async function handleCreateSession(): Promise<ResearchSession | null> {
    try {
      const session = await createSession();
      setSessions((current) => [session, ...current]);
      setActiveSessionId(session.id);
      setMessagesBySession((current) => ({ ...current, [session.id]: [] }));
      setArtifactsBySession((current) => ({ ...current, [session.id]: [] }));
      return session;
    } catch (nextError) {
      setError(errorMessage(nextError));
      return null;
    }
  }

  async function handleRenameSession(sessionId: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const previous = sessions.find((session) => session.id === sessionId);
    if (!previous || previous.title === trimmed) return;
    // Optimistic update; reconcile with the server response (which also bumps updatedAt).
    setSessions((current) =>
      current.map((session) => (session.id === sessionId ? { ...session, title: trimmed } : session)),
    );
    try {
      const updated = await renameSession(sessionId, trimmed);
      setSessions((current) =>
        current.map((session) => (session.id === sessionId ? updated : session)),
      );
    } catch (nextError) {
      setSessions((current) =>
        current.map((session) => (session.id === sessionId ? previous : session)),
      );
      setError(errorMessage(nextError));
    }
  }

  async function handleDeleteSession(sessionId: string) {
    handlesRef.current.get(sessionId)?.cancel();
    handlesRef.current.delete(sessionId);
    markRunning(sessionId, false);
    await deleteSession(sessionId).catch(() => undefined);
    setSessions((current) => {
      const next = current.filter((session) => session.id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(next[0]?.id ?? null);
      }
      return next;
    });
    setMessagesBySession((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }

  function handleSelectionChange(next: AgentSelection) {
    setSelection(next);
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures (private mode etc.).
    }
  }

  async function handleSend(text: string) {
    let sessionId = activeSessionId;
    // Only block re-sending into a session that is already running; other
    // sessions are free to start their own concurrent run.
    if (sessionId && runningSessionIds.includes(sessionId)) return;
    if (!sessionId) {
      const created = await handleCreateSession();
      if (!created) return;
      sessionId = created.id;
    }
    if (!selection) {
      setError(t("agent.noneHint"));
      return;
    }

    setError(null);
    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `user-${now}-${Math.random().toString(36).slice(2)}`,
      role: "user",
      contentBlocks: [{ type: "text", text }],
      createdAt: now,
    };
    const placeholder: ChatMessage = {
      id: PENDING_ID,
      role: "assistant",
      contentBlocks: [],
      createdAt: now,
      runStatus: "running",
    };
    updateMessages(sessionId, (messages) => [...messages, userMessage, placeholder]);

    const runSessionId = sessionId;
    markRunning(runSessionId, true);

    const handle = startAgentRun(
      {
        sessionId: runSessionId,
        prompt: text,
        agentTargetId: selection.agentTargetId,
        ...(selection.model ? { model: selection.model } : {}),
      },
      {
        onEvent: (event) => handleEvent(runSessionId, event),
        onError: (message) => setError(message),
        onClose: () => {
          markRunning(runSessionId, false);
          handlesRef.current.delete(runSessionId);
        },
      },
    );
    handlesRef.current.set(runSessionId, handle);
  }

  function handleEvent(sessionId: string, event: AgentRunEvent) {
    switch (event.type) {
      case "thinking_delta":
      case "text_delta":
      case "status":
      case "tool_call":
      case "tool_result":
        updateMessages(sessionId, (messages) =>
          messages.map((message) =>
            message.id === PENDING_ID
              ? { ...message, contentBlocks: applyEventToBlocks(message.contentBlocks, event) }
              : message,
          ),
        );
        break;
      case "artifacts_ready":
        setArtifactsBySession((current) => ({
          ...current,
          [sessionId]: mergeArtifacts(current[sessionId] ?? [], event.artifacts),
        }));
        break;
      case "assistant_message":
        updateMessages(sessionId, (messages) =>
          messages.map((message) => (message.id === PENDING_ID ? event.message : message)),
        );
        break;
      case "session_updated":
        setSessions((current) =>
          current.map((session) => (session.id === event.session.id ? event.session : session)),
        );
        break;
      case "run_failed":
        setError(event.message);
        break;
      case "run_finished":
        markRunning(sessionId, false);
        handlesRef.current.delete(sessionId);
        break;
      default:
        break;
    }
  }

  function handleCancel() {
    if (!activeSessionId) return;
    handlesRef.current.get(activeSessionId)?.cancel();
  }

  const orderedSessions = useMemo(
    () => [...sessions].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
    [sessions],
  );

  if (loading) {
    return (
      <main className="app-shell app-shell-loading">
        <div className="loading-state">
          <LoaderCircle className="spin" size={18} />
          <span>{t("app.loading")}</span>
        </div>
      </main>
    );
  }

  const activeSession = orderedSessions.find((session) => session.id === activeSessionId) ?? null;

  return (
    <main className="app-shell">
      <SessionSidebar
        sessions={orderedSessions}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onCreate={() => void handleCreateSession()}
        onRename={(id, title) => void handleRenameSession(id, title)}
        onDelete={(id) => void handleDeleteSession(id)}
        onOpenLibrary={() => setLibraryOpen(true)}
      />

      <section className="chat-column">
        <header className="chat-header">
          <div>
            <h1>{activeSession ? activeSession.title : t("app.title")}</h1>
            <p>{t("app.tagline")}</p>
          </div>
        </header>

        {error ? (
          <div className="chat-error">
            <ShieldAlert size={15} />
            <span>{error}</span>
          </div>
        ) : null}

        <ChatThread messages={activeMessages} isRunning={activeIsRunning} />

        <ChatInput
          agents={agents}
          selection={selection}
          onSelectionChange={handleSelectionChange}
          isRunning={activeIsRunning}
          onSend={(text) => void handleSend(text)}
          onCancel={handleCancel}
        />
      </section>

      {activeSessionId ? (
        <ArtifactPanel sessionId={activeSessionId} artifacts={activeArtifacts} />
      ) : null}

      {libraryOpen ? (
        <LibraryOverlay
          sessions={orderedSessions}
          onSelect={(id) => void handleSelectSession(id)}
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}
    </main>
  );
}

function mergeArtifacts(existing: ResearchArtifact[], incoming: ResearchArtifact[]): ResearchArtifact[] {
  const byPath = new Map(existing.map((artifact) => [artifact.relativePath, artifact]));
  for (const artifact of incoming) {
    byPath.set(artifact.relativePath, artifact);
  }
  return [...byPath.values()].sort(
    (left, right) => Number(Boolean(right.isCanonical)) - Number(Boolean(left.isCanonical)),
  );
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Unexpected runtime error";
}
