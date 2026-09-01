import { defineConfig, devices } from "@playwright/test";

const mcpUrl = process.env.ORACLE_MCP_URL ?? "http://127.0.0.1:9090/mcp";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "real-mcp-workflow.integration.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3101",
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium-real-mcp",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3101",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ORACLE_DATA_SOURCE: "mcp",
      ORACLE_MCP_URL: mcpUrl,
      LEAD_REPOSITORY: "memory",
      SESSION_SECRET: "local-real-mcp-browser-session-secret",
      AI_PROVIDER: "",
      AI_MODEL: "",
      AI_GATEWAY_API_KEY: "",
    },
  },
});
