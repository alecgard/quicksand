import { Hono } from "hono";
import { readFileSync } from "node:fs";
import type { ProxyConfig } from "./types.js";
import { ManifestManager } from "./manifest-manager.js";
import { ActionLog } from "./action-log.js";
import { CostTracker } from "./cost-tracker.js";
import { EscalationManager } from "./escalation.js";
import { createProxyRoutes } from "./routes/proxy.js";
import { createMCPRoutes } from "./routes/mcp.js";
import { createAPIRoutes } from "./routes/api.js";
import { createUIRoutes } from "./routes/ui.js";
import { TaskRunner } from "./task-runner.js";
import { ManifestSchema } from "@quicksand/manifest";

export interface ServerInstance {
  app: Hono;
  manifestManager: ManifestManager;
  actionLog: ActionLog;
  costTracker: CostTracker;
  escalationManager: EscalationManager;
  taskRunner: TaskRunner;
}

/**
 * Creates a fully configured Hono app with all routes mounted.
 * Accepts config options so the executor can create proxy instances
 * programmatically.
 */
export function createServer(config: ProxyConfig = {}): ServerInstance {
  const manifestManager = new ManifestManager();
  const actionLog = new ActionLog();
  const costTracker = new CostTracker();
  const escalationManager = new EscalationManager(manifestManager, actionLog);

  // Load manifest if provided in config
  if (config.manifest) {
    manifestManager.register(config.manifest);
  } else if (process.env.MANIFEST_PATH) {
    const raw = readFileSync(process.env.MANIFEST_PATH, "utf-8");
    const manifest = ManifestSchema.parse(JSON.parse(raw));
    manifestManager.register(manifest);
  }

  // Load org policy if provided in config
  if (config.orgPolicy) {
    manifestManager.loadOrgPolicy(config.orgPolicy);
  } else if (process.env.ORG_POLICY_PATH) {
    manifestManager.loadOrgPolicyFromFile(process.env.ORG_POLICY_PATH);
  }

  const port = config.port ?? parseInt(process.env.PORT || "8080", 10);
  const taskRunner = new TaskRunner(manifestManager, actionLog, {
    proxyPort: port,
  });

  const app = new Hono();

  // Mount routes
  app.route("/proxy", createProxyRoutes(manifestManager, actionLog, costTracker));
  app.route("/mcp", createMCPRoutes(manifestManager, actionLog, costTracker));
  app.route(
    "/api",
    createAPIRoutes(manifestManager, actionLog, costTracker, escalationManager, taskRunner),
  );

  // Health check
  app.get("/health", (c) => c.json({ ok: true }));

  // Static UI serving (last, so API routes take precedence)
  app.route("/", createUIRoutes());

  return {
    app,
    manifestManager,
    actionLog,
    costTracker,
    escalationManager,
    taskRunner,
  };
}
