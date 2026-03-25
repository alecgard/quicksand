import { Hono } from "hono";
import type { ProxyConfig } from "./types.js";
import { StateManager } from "./state.js";
import { ActionLog } from "./action-log.js";
import { CostTracker } from "./cost-tracker.js";
import { EscalationManager } from "./escalation.js";
import { TaskManager } from "./task-manager.js";
import { createProxyRoutes } from "./routes/proxy.js";
import { createMCPRoutes } from "./routes/mcp.js";
import { createAPIRoutes } from "./routes/api.js";
import { createUIRoutes } from "./routes/ui.js";

export interface ServerInstance {
  app: Hono;
  stateManager: StateManager;
  actionLog: ActionLog;
  costTracker: CostTracker;
  escalationManager: EscalationManager;
  taskManager: TaskManager;
}

/**
 * Creates a fully configured Hono app with all routes mounted.
 * Accepts config options so the executor can create proxy instances
 * programmatically.
 */
export function createServer(config: ProxyConfig = {}): ServerInstance {
  const stateManager = new StateManager();
  const actionLog = new ActionLog();
  const costTracker = new CostTracker();
  const escalationManager = new EscalationManager(stateManager, actionLog);
  const taskManager = new TaskManager();

  // Load manifest if provided in config
  if (config.manifest) {
    stateManager.loadManifest(config.manifest);
    // Also create a corresponding task
    taskManager.createTask(
      config.manifest.environment.agent.prompt,
      config.manifest,
    );
  } else if (process.env.MANIFEST_PATH) {
    stateManager.loadManifestFromFile(process.env.MANIFEST_PATH);
    // Create task for the loaded manifest
    const state = stateManager.getState();
    if (state) {
      taskManager.createTask(
        state.manifest.environment.agent.prompt,
        state.manifest,
      );
    }
  }

  // Load org policy if provided in config
  if (config.orgPolicy) {
    stateManager.loadOrgPolicy(config.orgPolicy);
  } else if (process.env.ORG_POLICY_PATH) {
    stateManager.loadOrgPolicyFromFile(process.env.ORG_POLICY_PATH);
  }

  const app = new Hono();

  // Mount routes
  app.route("/proxy", createProxyRoutes(stateManager, actionLog, costTracker));
  app.route("/mcp", createMCPRoutes(stateManager, actionLog, costTracker));
  app.route(
    "/api",
    createAPIRoutes(stateManager, actionLog, costTracker, escalationManager, taskManager),
  );

  // Health check
  app.get("/health", (c) => c.json({ ok: true }));

  // Static UI serving (last, so API routes take precedence)
  app.route("/", createUIRoutes());

  return {
    app,
    stateManager,
    actionLog,
    costTracker,
    escalationManager,
    taskManager,
  };
}
