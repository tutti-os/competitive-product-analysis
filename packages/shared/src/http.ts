export const API_ROUTES = {
  health: "/api/health",
  bootstrap: "/api/bootstrap",
  sessions: "/api/sessions",
  session(sessionId: string) {
    return `/api/sessions/${sessionId}`;
  },
  sessionMessages(sessionId: string) {
    return `/api/sessions/${sessionId}/messages`;
  },
  sessionArtifacts(sessionId: string) {
    return `/api/sessions/${sessionId}/artifacts`;
  },
  artifactContent(sessionId: string, artifactId: string) {
    return `/api/sessions/${sessionId}/artifacts/${artifactId}/content`;
  },
  agentStream: "/api/agent/stream",
  referencesList: "/tutti/references/list",
  referencesSearch: "/tutti/references/search",
  // Tutti CLI capability handlers. Each path matches a command in tutti.cli.json
  // as `/tutti/cli/${command.path.join("/")}`.
  cliStatus: "/tutti/cli/status",
  cliSessions: "/tutti/cli/sessions",
  cliReports: "/tutti/cli/reports",
  cliReport: "/tutti/cli/report",
  cliResearch: "/tutti/cli/research",
} as const;
