import type {
  AgentRunEvent,
  AgentRunStartRequest,
  BootstrapResponse,
  ResearchArtifact,
  ResearchSession,
  SessionMessagesResponse,
} from "@product-competition/shared";
import { API_ROUTES } from "@product-competition/shared";

export async function fetchBootstrap(): Promise<BootstrapResponse> {
  return parseJsonResponse(await fetch(API_ROUTES.bootstrap));
}

export async function createSession(title?: string): Promise<ResearchSession> {
  return parseJsonResponse(
    await fetch(API_ROUTES.sessions, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(title ? { title } : {}),
    }),
  );
}

export async function activateSession(sessionId: string): Promise<ResearchSession> {
  return parseJsonResponse(
    await fetch(API_ROUTES.session(sessionId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: true }),
    }),
  );
}

export async function renameSession(sessionId: string, title: string): Promise<ResearchSession> {
  return parseJsonResponse(
    await fetch(API_ROUTES.session(sessionId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  );
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetch(API_ROUTES.session(sessionId), { method: "DELETE" });
}

export async function fetchSessionMessages(sessionId: string): Promise<SessionMessagesResponse> {
  return parseJsonResponse(await fetch(API_ROUTES.sessionMessages(sessionId)));
}

export async function fetchArtifactContent(
  sessionId: string,
  artifactId: string,
): Promise<{ artifact: ResearchArtifact; content: string; mimeType: string }> {
  return parseJsonResponse(await fetch(API_ROUTES.artifactContent(sessionId, artifactId)));
}

export interface AgentRunHandle {
  cancel(): void;
}

/**
 * Open a streaming research run over WebSocket. Events are pushed to onEvent as
 * they arrive; the socket closes after run_finished.
 */
export function startAgentRun(
  request: Omit<AgentRunStartRequest, "type">,
  handlers: {
    onEvent: (event: AgentRunEvent) => void;
    onError?: (message: string) => void;
    onClose?: () => void;
  },
): AgentRunHandle {
  const url = new URL(API_ROUTES.agentStream, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url.toString());
  let activeRunId: string | null = null;

  socket.addEventListener("open", () => {
    const start: AgentRunStartRequest = { type: "start", ...request };
    socket.send(JSON.stringify(start));
  });

  socket.addEventListener("message", (raw) => {
    let event: AgentRunEvent | null = null;
    try {
      event = JSON.parse(String(raw.data)) as AgentRunEvent;
    } catch {
      return;
    }
    if (event.type === "run_started") {
      activeRunId = event.runId;
    }
    handlers.onEvent(event);
    if (event.type === "run_finished") {
      socket.close();
    }
  });

  socket.addEventListener("error", () => {
    handlers.onError?.("Agent stream connection error");
  });

  socket.addEventListener("close", () => {
    handlers.onClose?.();
  });

  return {
    cancel() {
      if (socket.readyState === WebSocket.OPEN && activeRunId) {
        socket.send(JSON.stringify({ type: "cancel", runId: activeRunId }));
      } else {
        socket.close();
      }
    },
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error?: string }).error)
        : response.statusText;
    throw new Error(message);
  }
  return payload;
}
