import { AgentBusyError } from "./errors";

const ACTIVE_AGENT_SESSIONS = Symbol.for("roofline.active-agent-sessions");

interface AgentGlobalState {
  [ACTIVE_AGENT_SESSIONS]?: Set<string>;
}

function activeSessions(): Set<string> {
  const state = globalThis as AgentGlobalState;
  state[ACTIVE_AGENT_SESSIONS] ??= new Set<string>();
  return state[ACTIVE_AGENT_SESSIONS];
}

/**
 * This is intentionally a process-local duplicate-request guard. It prevents
 * overlapping work within one application instance, but does not claim a
 * distributed lock across serverless instances. The same hashed identifier is
 * sent as Gateway user attribution so deployment-level controls can key on it.
 */
export function acquireAgentSession(sessionIdHash: string): () => void {
  const active = activeSessions();
  if (active.has(sessionIdHash)) throw new AgentBusyError();
  active.add(sessionIdHash);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active.delete(sessionIdHash);
  };
}

export function resetAgentSessionGateForTests(): void {
  activeSessions().clear();
}
