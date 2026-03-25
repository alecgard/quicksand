import { Hono } from "hono";
import { AnyGrantSchema, ManifestSchema } from "@quicksand/manifest";
import type { StateManager } from "../state.js";
import type { ActionLog } from "../action-log.js";
import type { CostTracker } from "../cost-tracker.js";
import type { EscalationManager } from "../escalation.js";

/**
 * Creates REST API route handlers.
 * Routes:
 * - GET  /api/state       — current ManifestState
 * - GET  /api/log         — action log
 * - POST /api/manifest    — load a new manifest
 * - POST /api/cost        — report LLM cost
 * - POST /api/escalation  — request an escalation
 * - GET  /api/escalations — list pending escalations
 * - POST /api/escalations/:id/resolve — approve/deny
 */
export function createAPIRoutes(
  stateManager: StateManager,
  actionLog: ActionLog,
  costTracker: CostTracker,
  escalationManager: EscalationManager,
): Hono {
  const app = new Hono();

  // GET /api/state
  app.get("/state", (c) => {
    const state = stateManager.getState();
    if (!state) {
      return c.json({ error: "No manifest loaded" }, 404);
    }
    return c.json(state);
  });

  // GET /api/log
  app.get("/log", (c) => {
    return c.json(actionLog.getAll());
  });

  // POST /api/manifest — load a manifest
  app.post("/manifest", async (c) => {
    try {
      const body = await c.req.json();
      const manifest = ManifestSchema.parse(body);
      stateManager.loadManifest(manifest);
      return c.json({ ok: true, manifestId: manifest.id });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid manifest";
      return c.json({ error: message }, 400);
    }
  });

  // POST /api/cost — report LLM cost
  app.post("/cost", async (c) => {
    const body = await c.req.json<{ taskId: string; costUSD: number }>();
    if (!body.taskId || typeof body.costUSD !== "number") {
      return c.json({ error: "taskId and costUSD are required" }, 400);
    }
    costTracker.reportLLMCost(body.taskId, body.costUSD);
    return c.json({ ok: true, cost: costTracker.get(body.taskId) });
  });

  // GET /api/costs
  app.get("/costs", (c) => {
    return c.json(costTracker.getAll());
  });

  // POST /api/escalation — request an escalation
  app.post("/escalation", async (c) => {
    try {
      stateManager.getManifest(); // ensure loaded
    } catch {
      return c.json({ error: "No manifest loaded" }, 500);
    }

    const body = await c.req.json<{
      reason: string;
      capability: unknown;
    }>();

    if (!body.reason || !body.capability) {
      return c.json(
        { error: "reason and capability are required" },
        400,
      );
    }

    let capability;
    try {
      capability = AnyGrantSchema.parse(body.capability);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid capability";
      return c.json({ error: message }, 400);
    }

    const escalation = escalationManager.requestEscalation(
      body.reason,
      capability,
    );
    return c.json(escalation, escalation.status === "pending" ? 202 : 200);
  });

  // GET /api/escalations
  app.get("/escalations", (c) => {
    return c.json(escalationManager.getAll());
  });

  // POST /api/escalations/:id/resolve
  app.post("/escalations/:id/resolve", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      action: "approve" | "deny";
      approvedBy: string;
      expiresAt?: string;
    }>();

    if (!body.action || !body.approvedBy) {
      return c.json(
        { error: "action and approvedBy are required" },
        400,
      );
    }

    if (body.action !== "approve" && body.action !== "deny") {
      return c.json({ error: "action must be 'approve' or 'deny'" }, 400);
    }

    const result = escalationManager.resolve(
      id,
      body.action,
      body.approvedBy,
      body.expiresAt,
    );

    if (!result) {
      return c.json(
        { error: "Escalation not found or already resolved" },
        404,
      );
    }

    return c.json(result);
  });

  return app;
}
