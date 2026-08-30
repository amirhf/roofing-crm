export class AgentGroundingError extends Error {
  constructor(message: string) {
    super(`Grounding rejected: ${message}`);
    this.name = "AgentGroundingError";
  }
}

export class AgentToolLimitError extends Error {
  constructor(message: string) {
    super(`Agent tool limit exceeded: ${message}`);
    this.name = "AgentToolLimitError";
  }
}

export class AgentMcpError extends Error {
  readonly oracleCode: string;

  constructor(code: string, message: string) {
    super(`Oracle MCP error (${code}): ${message}`);
    this.name = "AgentMcpError";
    this.oracleCode = code;
  }
}

export class AgentResponseSizeError extends Error {
  constructor(message: string) {
    super(`Oracle MCP response rejected: ${message}`);
    this.name = "AgentResponseSizeError";
  }
}

export class AgentBusyError extends Error {
  constructor() {
    super("Another grounded query is already active for this browser session.");
    this.name = "AgentBusyError";
  }
}

export class AgentPrivacyError extends Error {
  constructor() {
    super(
      "The query contains caller text that cannot be safely normalized for model use.",
    );
    this.name = "AgentPrivacyError";
  }
}

export class AgentIntentValidationError extends Error {
  constructor() {
    super("The query could not be converted into a supported bounded roofing search.");
    this.name = "AgentIntentValidationError";
  }
}
