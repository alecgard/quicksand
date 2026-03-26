import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { createServer } from "@quicksand/proxy/server";
import type { Manifest } from "@quicksand/manifest";

const testManifest: Manifest = {
  id: "test-api",
  createdAt: "2026-03-25T00:00:00Z",
  createdBy: "test",
  capabilities: {
    network: [
      {
        name: "httpbin",
        baseURL: "https://httpbin.org",
        allowedPaths: ["/get", "/post"],
        allowedMethods: ["GET", "POST"],
      },
    ],
  },
  limits: {
    warning: { runtimeSeconds: 60, costUSD: 1.0 },
    limit: { runtimeSeconds: 120, costUSD: 2.0 },
  },
  escalation: {
    defaultAction: "request_human" as const,
    approvalTimeoutSeconds: 60,
    snapshotOnPause: false,
  },
  environment: {
    snapshots: [],
    files: {},
    agent: { profile: "ollama-default", prompt: "Test task" },
  },
};

describe("API Integration", () => {
  it("GET /health returns { ok: true }", async () => {
    const { app } = createServer();
    const res = await app.request("/health");
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body, { ok: true });
  });

  it("POST /api/manifest registers a manifest", async () => {
    const { app } = createServer();
    const postRes = await app.request("/api/manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testManifest),
    });
    assert.strictEqual(postRes.status, 200);
    const postBody = await postRes.json();
    assert.strictEqual(postBody.ok, true);
    assert.strictEqual(postBody.manifestId, "test-api");
  });

  it("POST /api/tasks creates a task with prompt (auto-generates manifest)", async () => {
    const { app } = createServer();
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "do something" }),
    });
    assert.strictEqual(res.status, 201);
    const task = await res.json();
    assert.strictEqual(task.prompt, "do something");
    // Status may be "pending" or "running" (TaskRunner fires in background)
    assert.ok(["pending", "running", "failed"].includes(task.status));
    assert.ok(task.id);
    assert.ok(task.manifestState);
  });

  it("POST /api/tasks creates a task with manifest", async () => {
    const { app } = createServer();
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "with manifest", manifest: testManifest }),
    });
    assert.strictEqual(res.status, 201);
    const task = await res.json();
    // Prompt comes from the manifest's agent config
    assert.strictEqual(task.prompt, testManifest.environment.agent.prompt);
    assert.ok(task.manifestState);
    assert.strictEqual(task.manifestState.manifest.id, "test-api");
  });

  it("GET /api/tasks lists tasks", async () => {
    const { app } = createServer();
    await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "task1" }),
    });
    await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "task2" }),
    });
    const res = await app.request("/api/tasks");
    assert.strictEqual(res.status, 200);
    const tasks = await res.json();
    assert.strictEqual(tasks.length, 2);
  });

  it("GET /api/tasks/:id returns task detail", async () => {
    const { app } = createServer();
    const createRes = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "detail test" }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/tasks/${created.id}`);
    assert.strictEqual(res.status, 200);
    const detail = await res.json();
    assert.strictEqual(detail.task.id, created.id);
    assert.ok(Array.isArray(detail.log));
    assert.ok(Array.isArray(detail.escalations));
    assert.ok(detail.costs);
  });

  it("PATCH /api/tasks/:id updates task status", async () => {
    const { app } = createServer();
    const createRes = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "patch test" }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/tasks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "running" }),
    });
    assert.strictEqual(res.status, 200);
    const updated = await res.json();
    assert.strictEqual(updated.status, "running");
  });

  it("POST /api/tasks/:id/snapshots records snapshot", async () => {
    const { app } = createServer();
    const createRes = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "snapshot test" }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/tasks/${created.id}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "v1", reason: "manual" }),
    });
    assert.strictEqual(res.status, 201);
    const snapshot = await res.json();
    assert.strictEqual(snapshot.tag, "v1");
    assert.strictEqual(snapshot.reason, "manual");
    assert.strictEqual(snapshot.taskId, created.id);
  });

  it("GET /api/snapshots returns all snapshots", async () => {
    const { app } = createServer();
    const createRes = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "snap all test" }),
    });
    const created = await createRes.json();

    await app.request(`/api/tasks/${created.id}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "s1", reason: "manual" }),
    });
    await app.request(`/api/tasks/${created.id}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "s2", reason: "completion" }),
    });

    const res = await app.request("/api/snapshots");
    assert.strictEqual(res.status, 200);
    const snaps = await res.json();
    assert.strictEqual(snaps.length, 2);
  });

  it("POST /api/escalation with loaded manifest creates escalation", async () => {
    const { app } = createServer({ manifest: testManifest });

    const res = await app.request("/api/escalation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "need extra access",
        capability: {
          name: "extra-api",
          baseURL: "https://extra.example.com",
          allowedPaths: ["/data"],
          allowedMethods: ["GET"],
        },
      }),
    });
    assert.strictEqual(res.status, 202);
    const esc = await res.json();
    assert.strictEqual(esc.status, "pending");
    assert.strictEqual(esc.reason, "need extra access");
  });

  it("GET /api/escalations returns escalations", async () => {
    const { app } = createServer({ manifest: testManifest });

    await app.request("/api/escalation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "r1",
        capability: {
          name: "api-1",
          baseURL: "https://api1.example.com",
          allowedPaths: [],
          allowedMethods: [],
        },
      }),
    });

    const res = await app.request("/api/escalations");
    assert.strictEqual(res.status, 200);
    const list = await res.json();
    assert.ok(list.length >= 1);
  });

  it("POST /api/escalations/:id/resolve approves/denies", async () => {
    const { app } = createServer({ manifest: testManifest });

    const escRes = await app.request("/api/escalation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "resolve test",
        capability: {
          name: "resolve-api",
          baseURL: "https://resolve.example.com",
          allowedPaths: [],
          allowedMethods: [],
        },
      }),
    });
    const esc = await escRes.json();

    const res = await app.request(`/api/escalations/${esc.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", approvedBy: "tester" }),
    });
    assert.strictEqual(res.status, 200);
    const resolved = await res.json();
    assert.strictEqual(resolved.status, "approved");
  });

  it("POST /api/cost reports LLM cost", async () => {
    const { app } = createServer();
    const res = await app.request("/api/cost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "cost-task", costUSD: 0.5 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.cost.llmCostUSD, 0.5);
  });

  it("GET /api/costs returns costs", async () => {
    const { app } = createServer();
    await app.request("/api/cost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "c1", costUSD: 1.0 }),
    });
    const res = await app.request("/api/costs");
    assert.strictEqual(res.status, 200);
    const costs = await res.json();
    assert.ok(costs.length >= 1);
  });

  it("GET /api/log returns action log", async () => {
    const { app } = createServer({ manifest: testManifest });
    const res = await app.request("/api/log");
    assert.strictEqual(res.status, 200);
    const log = await res.json();
    assert.ok(Array.isArray(log));
  });

  it("403 for requests to non-existent grants via /proxy/unknown/path", async () => {
    const { app } = createServer({ manifest: testManifest });
    const res = await app.request("/proxy/unknown/path", {
      headers: { "x-quicksand-task-id": "test-api" },
    });
    // Should get a 403 for unknown grant
    assert.strictEqual(res.status, 403);
  });
});
