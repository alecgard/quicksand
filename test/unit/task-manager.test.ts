import { describe, it } from "node:test";
import assert from "node:assert";
import { TaskManager } from "@quicksand/proxy/task-manager";
import type { Manifest } from "@quicksand/manifest";

const testManifest: Manifest = {
  id: "test-task-mgr",
  createdAt: "2026-03-25T00:00:00Z",
  createdBy: "test",
  capabilities: {
    network: [
      {
        name: "httpbin",
        baseURL: "https://httpbin.org",
        allowedPaths: ["/get"],
        allowedMethods: ["GET"],
      },
    ],
  },
  limits: {
    warning: { runtimeSeconds: 60, costUSD: 1.0 },
    limit: { runtimeSeconds: 120, costUSD: 2.0 },
  },
  escalation: {
    defaultAction: "request_human",
    approvalTimeoutSeconds: 60,
    snapshotOnPause: false,
  },
  environment: {
    snapshots: [],
    files: {},
    agent: { profile: "ollama-default", prompt: "Test task" },
  },
};

describe("TaskManager", () => {
  describe("createTask", () => {
    it("creates with correct defaults (status=pending, no manifestState)", () => {
      const mgr = new TaskManager();
      const task = mgr.createTask("do something");
      assert.strictEqual(task.status, "pending");
      assert.strictEqual(task.manifestState, null);
      assert.strictEqual(task.prompt, "do something");
      assert.ok(task.id);
      assert.ok(task.createdAt);
      assert.deepStrictEqual(task.snapshots, []);
    });

    it("creates with manifest and populates manifestState", () => {
      const mgr = new TaskManager();
      const task = mgr.createTask("do something", testManifest);
      assert.strictEqual(task.status, "pending");
      assert.ok(task.manifestState);
      assert.strictEqual(task.manifestState!.manifest.id, "test-task-mgr");
      assert.deepStrictEqual(task.manifestState!.grants, []);
    });
  });

  describe("updateTask", () => {
    it("updates fields on an existing task", () => {
      const mgr = new TaskManager();
      const task = mgr.createTask("prompt");
      const updated = mgr.updateTask(task.id, { status: "running" });
      assert.strictEqual(updated.status, "running");
      assert.strictEqual(updated.id, task.id);
    });

    it("throws for unknown task ID", () => {
      const mgr = new TaskManager();
      assert.throws(
        () => mgr.updateTask("nonexistent-id", { status: "running" }),
        { message: /Task not found/ },
      );
    });
  });

  describe("getTask", () => {
    it("returns undefined for unknown ID", () => {
      const mgr = new TaskManager();
      assert.strictEqual(mgr.getTask("no-such-id"), undefined);
    });

    it("returns the task for a known ID", () => {
      const mgr = new TaskManager();
      const task = mgr.createTask("hello");
      assert.strictEqual(mgr.getTask(task.id)?.prompt, "hello");
    });
  });

  describe("listTasks", () => {
    it("returns all tasks", () => {
      const mgr = new TaskManager();
      mgr.createTask("a");
      mgr.createTask("b");
      assert.strictEqual(mgr.listTasks().length, 2);
    });

    it("filters by status", () => {
      const mgr = new TaskManager();
      const t1 = mgr.createTask("a");
      mgr.createTask("b");
      mgr.updateTask(t1.id, { status: "running" });
      const running = mgr.listTasks({ status: "running" });
      assert.strictEqual(running.length, 1);
      assert.strictEqual(running[0].id, t1.id);
      const pending = mgr.listTasks({ status: "pending" });
      assert.strictEqual(pending.length, 1);
    });
  });

  describe("addSnapshot", () => {
    it("adds to task and global list", () => {
      const mgr = new TaskManager();
      const task = mgr.createTask("snap test");
      const snapshot = {
        id: "snap-1",
        taskId: task.id,
        tag: "v1",
        createdAt: new Date().toISOString(),
        reason: "manual",
      };
      mgr.addSnapshot(task.id, snapshot);
      assert.strictEqual(task.snapshots.length, 1);
      assert.strictEqual(task.snapshots[0].id, "snap-1");
      assert.strictEqual(mgr.getSnapshots().length, 1);
    });

    it("throws for unknown task", () => {
      const mgr = new TaskManager();
      assert.throws(
        () =>
          mgr.addSnapshot("bad-id", {
            id: "s",
            taskId: "bad-id",
            tag: "t",
            createdAt: "",
            reason: "manual",
          }),
        { message: /Task not found/ },
      );
    });
  });

  describe("getSnapshots", () => {
    it("returns all snapshots", () => {
      const mgr = new TaskManager();
      const t1 = mgr.createTask("a");
      const t2 = mgr.createTask("b");
      mgr.addSnapshot(t1.id, {
        id: "s1",
        taskId: t1.id,
        tag: "v1",
        createdAt: "",
        reason: "manual",
      });
      mgr.addSnapshot(t2.id, {
        id: "s2",
        taskId: t2.id,
        tag: "v2",
        createdAt: "",
        reason: "completion",
      });
      assert.strictEqual(mgr.getSnapshots().length, 2);
    });

    it("filters by taskId", () => {
      const mgr = new TaskManager();
      const t1 = mgr.createTask("a");
      const t2 = mgr.createTask("b");
      mgr.addSnapshot(t1.id, {
        id: "s1",
        taskId: t1.id,
        tag: "v1",
        createdAt: "",
        reason: "manual",
      });
      mgr.addSnapshot(t2.id, {
        id: "s2",
        taskId: t2.id,
        tag: "v2",
        createdAt: "",
        reason: "completion",
      });
      const snaps = mgr.getSnapshots(t1.id);
      assert.strictEqual(snaps.length, 1);
      assert.strictEqual(snaps[0].id, "s1");
    });
  });
});
