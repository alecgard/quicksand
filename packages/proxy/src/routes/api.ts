import { Hono } from "hono";
import { z } from "zod";
import { AnyGrantSchema, ManifestSchema, ManifestStateSchema } from "@quicksand/manifest";
import type { StateManager } from "../state.js";
import type { ActionLog } from "../action-log.js";
import type { CostTracker } from "../cost-tracker.js";
import type { EscalationManager } from "../escalation.js";
import type { TaskManager } from "../task-manager.js";

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
  manifestState: ManifestStateSchema.optional(),
});

const CreateSnapshotSchema = z.object({
  tag: z.string(),
  reason: z.string(),
});

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
 * - POST /api/tasks       — create a task
 * - GET  /api/tasks       — list tasks
 * - GET  /api/tasks/:id   — get task detail
 * - PATCH /api/tasks/:id  — update task
 * - POST /api/tasks/:id/manifest — attach manifest
 * - GET  /api/tasks/:id/snapshots — task snapshots
 * - POST /api/tasks/:id/snapshots — add snapshot
 * - GET  /api/snapshots   — all snapshots
 */
export function createAPIRoutes(
  stateManager: StateManager,
  actionLog: ActionLog,
  costTracker: CostTracker,
  escalationManager: EscalationManager,
  taskManager?: TaskManager,
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

  // ── Task management endpoints ──────────────────────────

  // POST /api/tasks — create a new task
  app.post("/tasks", async (c) => {
    if (!taskManager) {
      return c.json({ error: "Task manager not available" }, 500);
    }
    try {
      const body = await c.req.json();
      const parsed = CreateTaskSchema.parse(body);
      const task = taskManager.createTask(parsed.prompt, parsed.manifest);
      return c.json(task, 201);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid request body";
      return c.json({ error: message }, 400);
    }
  });

  // GET /api/tasks — list tasks (optional ?status= filter)
  app.get("/tasks", (c) => {
    if (!taskManager) {
      return c.json({ error: "Task manager not available" }, 500);
    }
    const status = c.req.query("status");
    const tasks = taskManager.listTasks(status ? { status } : undefined);
    return c.json(tasks);
  });

  // GET /api/tasks/:id — full task detail with log, escalations, costs
  app.get("/tasks/:id", (c) => {
    if (!taskManager) {
      return c.json({ error: "Task manager not available" }, 500);
    }
    const id = c.req.param("id");
    const task = taskManager.getTask(id);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }
    const log = actionLog.getAll().filter((e) => e.taskId === task.id);
    const escalations = escalationManager
      .getAll()
      .filter((e) => e.taskId === task.id);
    const costs = costTracker.get(task.id);
    return c.json({
      task,
      log,
      escalations,
      costs: costs ?? { taskId: task.id, totalUSD: 0, requestCount: 0, llmCostUSD: 0 },
    });
  });

  // PATCH /api/tasks/:id — update a task
  app.patch("/tasks/:id", async (c) => {
    if (!taskManager) {
      return c.json({ error: "Task manager not available" }, 500);
    }
    const id = c.req.param("id");
    try {
      const body = await c.req.json();
      const updates = UpdateTaskSchema.parse(body);
      const task = taskManager.updateTask(id, updates);
      return c.json(task);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid request body";
      if (message.includes("Task not found")) {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 400);
    }
  });

  // POST /api/tasks/:id/manifest — attach manifest to a pending task
  app.post("/tasks/:id/manifest", async (c) => {
    if (!taskManager) {
      return c.json({ error: "Task manager not available" }, 500);
    }
    const id = c.req.param("id");
    const task = taskManager.getTask(id);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }
    try {
      const body = await c.req.json();
      const manifest = ManifestSchema.parse(body);
      taskManager.updateTask(id, {
        manifestState: { manifest, grants: [] },
      });
      return c.json({ ok: true, taskId: id, manifestId: manifest.id });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid manifest";
      return c.json({ error: message }, 400);
    }
  });

  // GET /api/tasks/:id/snapshots — snapshots for a task
  app.get("/tasks/:id/snapshots", (c) => {
    if (!taskManager) {
      return c.json({ error: "Task manager not available" }, 500);
    }
    const id = c.req.param("id");
    const task = taskManager.getTask(id);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }
    return c.json(taskManager.getSnapshots(id));
  });

  // POST /api/tasks/:id/snapshots — add a snapshot
  app.post("/tasks/:id/snapshots", async (c) => {
    if (!taskManager) {
      return c.json({ error: "Task manager not available" }, 500);
    }
    const id = c.req.param("id");
    const task = taskManager.getTask(id);
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }
    try {
      const body = await c.req.json();
      const parsed = CreateSnapshotSchema.parse(body);
      const snapshot = {
        id: crypto.randomUUID(),
        taskId: id,
        tag: parsed.tag,
        createdAt: new Date().toISOString(),
        reason: parsed.reason,
      };
      taskManager.addSnapshot(id, snapshot);
      return c.json(snapshot, 201);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid request body";
      return c.json({ error: message }, 400);
    }
  });

  // GET /api/snapshots — all snapshots across all tasks
  app.get("/snapshots", (c) => {
    if (!taskManager) {
      return c.json({ error: "Task manager not available" }, 500);
    }
    return c.json(taskManager.getSnapshots());
  });

  return app;
}
