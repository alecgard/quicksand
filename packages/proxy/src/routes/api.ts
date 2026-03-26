import { Hono } from "hono";
import { z } from "zod";
import { AnyGrantSchema, ManifestSchema } from "@quicksand/manifest";
import type { ManifestState } from "@quicksand/manifest";
import type { ManifestManager } from "../manifest-manager.js";
import type { ActionLog } from "../action-log.js";
import type { CostTracker } from "../cost-tracker.js";
import type { EscalationManager } from "../escalation.js";
import type { TaskRunner } from "../task-runner.js";

const CreateTaskSchema = z.object({
  prompt: z.string(),
  manifest: ManifestSchema.optional(),
});

const UpdateTaskSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  error: z.string().optional(),
  exitCode: z.number().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

const CreateSnapshotSchema = z.object({
  tag: z.string(),
  reason: z.string(),
});

function toTaskResponse(state: ManifestState) {
  return {
    id: state.manifest.id,
    prompt: state.manifest.environment.agent.prompt,
    status: state.status,
    manifestState: state,
    snapshots: state.snapshots,
    createdAt: state.manifest.createdAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    error: state.error,
    exitCode: state.exitCode,
  };
}

/**
 * Creates REST API route handlers.
 * Routes:
 * - GET  /api/log         — action log
 * - POST /api/manifest    — register a manifest
 * - POST /api/cost        — report LLM cost
 * - GET  /api/costs       — all costs
 * - POST /api/escalation  — request an escalation
 * - GET  /api/escalations — list pending escalations
 * - POST /api/escalations/:id/resolve — approve/deny
 * - POST /api/tasks       — create a task
 * - GET  /api/tasks       — list tasks
 * - GET  /api/tasks/:id   — get task detail
 * - PATCH /api/tasks/:id  — update task
 * - POST /api/tasks/:id/snapshots — add snapshot
 * - GET  /api/snapshots   — all snapshots
 */
export function createAPIRoutes(
  manifestManager: ManifestManager,
  actionLog: ActionLog,
  costTracker: CostTracker,
  escalationManager: EscalationManager,
  taskRunner?: TaskRunner,
): Hono {
  const app = new Hono();

  // GET /api/log
  app.get("/log", (c) => {
    return c.json(actionLog.getAll());
  });

  // POST /api/manifest — register a manifest
  app.post("/manifest", async (c) => {
    try {
      const body = await c.req.json();
      const manifest = ManifestSchema.parse(body);
      manifestManager.register(manifest);
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
    const body = await c.req.json<{
      manifestId?: string;
      reason: string;
      capability: unknown;
    }>();

    if (!body.reason || !body.capability) {
      return c.json(
        { error: "reason and capability are required" },
        400,
      );
    }

    // Determine manifest ID: from body or find the first registered manifest
    let manifestId = body.manifestId;
    if (!manifestId) {
      const all = manifestManager.list();
      if (all.length === 0) {
        return c.json({ error: "No manifest registered" }, 500);
      }
      manifestId = all[0].manifest.id;
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
      manifestId,
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

  // ── Task management endpoints ──────────────────────────

  // POST /api/tasks — create and run a task
  app.post("/tasks", async (c) => {
    try {
      const body = await c.req.json();
      const parsed = CreateTaskSchema.parse(body);

      let manifest = parsed.manifest;
      if (!manifest) {
        manifest = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          createdBy: "ui",
          capabilities: { network: [] },
          limits: {
            warning: { runtimeSeconds: 300, costUSD: 1 },
            limit: { runtimeSeconds: 600, costUSD: 5 },
          },
          escalation: {
            defaultAction: "request_human",
            approvalTimeoutSeconds: 300,
            snapshotOnPause: true,
          },
          environment: {
            snapshots: [],
            files: {},
            agent: { profile: "ollama-default", prompt: parsed.prompt },
          },
        };
      }

      const state = manifestManager.register(manifest);

      // If a runner is available, execute it
      if (taskRunner) {
        // Run in the background — don't await
        taskRunner.run(manifest.id).catch((err) => {
          manifestManager.update(manifest!.id, {
            status: "failed",
            completedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      return c.json(toTaskResponse(state), 201);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid request body";
      return c.json({ error: message }, 400);
    }
  });

  // GET /api/tasks — list tasks (optional ?status= filter)
  app.get("/tasks", (c) => {
    const status = c.req.query("status");
    const states = manifestManager.list(status ? { status } : undefined);
    return c.json(states.map(toTaskResponse));
  });

  // GET /api/tasks/:id — full task detail with log, escalations, costs
  app.get("/tasks/:id", (c) => {
    const id = c.req.param("id");
    const state = manifestManager.get(id);
    if (!state) {
      return c.json({ error: "Task not found" }, 404);
    }
    const log = actionLog.getAll().filter((e) => e.taskId === id);
    const escalations = escalationManager
      .getAll()
      .filter((e) => e.taskId === id || e.manifestId === id);
    const costs = costTracker.get(id);
    return c.json({
      task: toTaskResponse(state),
      log,
      escalations,
      costs: costs ?? { taskId: id, totalUSD: 0, requestCount: 0, llmCostUSD: 0 },
    });
  });

  // PATCH /api/tasks/:id — update a task
  app.patch("/tasks/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const body = await c.req.json();
      const updates = UpdateTaskSchema.parse(body);
      const state = manifestManager.update(id, updates);
      return c.json(toTaskResponse(state));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid request body";
      if (message.includes("Manifest not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 400);
    }
  });

  // POST /api/tasks/:id/snapshots — add a snapshot
  app.post("/tasks/:id/snapshots", async (c) => {
    const id = c.req.param("id");
    const state = manifestManager.get(id);
    if (!state) {
      return c.json({ error: "Task not found" }, 404);
    }
    try {
      const body = await c.req.json();
      const parsed = CreateSnapshotSchema.parse(body);
      const snapshot = {
        id: crypto.randomUUID(),
        tag: parsed.tag,
        createdAt: new Date().toISOString(),
        reason: parsed.reason,
      };
      manifestManager.addSnapshot(id, snapshot);
      return c.json({ ...snapshot, taskId: id }, 201);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid request body";
      return c.json({ error: message }, 400);
    }
  });

  // GET /api/snapshots — all snapshots across all tasks
  app.get("/snapshots", (c) => {
    return c.json(manifestManager.getAllSnapshots());
  });

  return app;
}
