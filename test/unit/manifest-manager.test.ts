import { describe, it } from "node:test";
import assert from "node:assert";
import { ManifestManager } from "@quicksand/proxy/manifest-manager";
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

describe("ManifestManager", () => {
  describe("register", () => {
    it("registers with correct defaults (status=pending, empty grants/snapshots)", () => {
      const mgr = new ManifestManager();
      const state = mgr.register(testManifest);
      assert.strictEqual(state.status, "pending");
      assert.strictEqual(state.manifest.id, "test-task-mgr");
      assert.deepStrictEqual(state.grants, []);
      assert.deepStrictEqual(state.snapshots, []);
    });
  });

  describe("get", () => {
    it("returns undefined for unknown ID", () => {
      const mgr = new ManifestManager();
      assert.strictEqual(mgr.get("no-such-id"), undefined);
    });

    it("returns the state for a known ID", () => {
      const mgr = new ManifestManager();
      mgr.register(testManifest);
      assert.strictEqual(mgr.get("test-task-mgr")?.manifest.id, "test-task-mgr");
    });
  });

  describe("getOrThrow", () => {
    it("throws for unknown ID", () => {
      const mgr = new ManifestManager();
      assert.throws(
        () => mgr.getOrThrow("nonexistent-id"),
        { message: /Manifest not found/ },
      );
    });
  });

  describe("update", () => {
    it("updates fields on an existing manifest state", () => {
      const mgr = new ManifestManager();
      mgr.register(testManifest);
      const updated = mgr.update("test-task-mgr", { status: "running" });
      assert.strictEqual(updated.status, "running");
      assert.strictEqual(updated.manifest.id, "test-task-mgr");
    });

    it("throws for unknown manifest ID", () => {
      const mgr = new ManifestManager();
      assert.throws(
        () => mgr.update("nonexistent-id", { status: "running" }),
        { message: /Manifest not found/ },
      );
    });
  });

  describe("list", () => {
    it("returns all manifest states", () => {
      const mgr = new ManifestManager();
      mgr.register(testManifest);
      mgr.register({ ...testManifest, id: "second" });
      assert.strictEqual(mgr.list().length, 2);
    });

    it("filters by status", () => {
      const mgr = new ManifestManager();
      mgr.register(testManifest);
      mgr.register({ ...testManifest, id: "second" });
      mgr.update("test-task-mgr", { status: "running" });
      const running = mgr.list({ status: "running" });
      assert.strictEqual(running.length, 1);
      assert.strictEqual(running[0].manifest.id, "test-task-mgr");
      const pending = mgr.list({ status: "pending" });
      assert.strictEqual(pending.length, 1);
    });
  });

  describe("addGrant", () => {
    it("appends a grant to the manifest state", () => {
      const mgr = new ManifestManager();
      mgr.register(testManifest);
      mgr.addGrant("test-task-mgr", {
        id: "grant-1",
        requestedAt: "2026-03-25T00:00:00Z",
        approvedAt: "2026-03-25T00:01:00Z",
        approvedBy: "auto:org-policy",
        reason: "need access",
        capability: {
          name: "extra",
          baseURL: "https://extra.example.com",
          allowedPaths: [],
          allowedMethods: [],
        },
      });
      const state = mgr.getOrThrow("test-task-mgr");
      assert.strictEqual(state.grants.length, 1);
      assert.strictEqual(state.grants[0].id, "grant-1");
    });
  });

  describe("addSnapshot", () => {
    it("adds to manifest state and getAllSnapshots", () => {
      const mgr = new ManifestManager();
      mgr.register(testManifest);
      const snapshot = {
        id: "snap-1",
        tag: "v1",
        createdAt: new Date().toISOString(),
        reason: "manual",
      };
      mgr.addSnapshot("test-task-mgr", snapshot);
      const state = mgr.getOrThrow("test-task-mgr");
      assert.strictEqual(state.snapshots.length, 1);
      assert.strictEqual(state.snapshots[0].id, "snap-1");
      assert.strictEqual(mgr.getAllSnapshots().length, 1);
      assert.strictEqual(mgr.getAllSnapshots()[0].manifestId, "test-task-mgr");
    });

    it("throws for unknown manifest", () => {
      const mgr = new ManifestManager();
      assert.throws(
        () =>
          mgr.addSnapshot("bad-id", {
            id: "s",
            tag: "t",
            createdAt: "",
            reason: "manual",
          }),
        { message: /Manifest not found/ },
      );
    });
  });

  describe("getEffectiveCapabilities", () => {
    it("returns manifest capabilities when no grants", () => {
      const mgr = new ManifestManager();
      mgr.register(testManifest);
      const caps = mgr.getEffectiveCapabilities("test-task-mgr");
      assert.strictEqual(caps.network.length, 1);
      assert.strictEqual(caps.network[0].name, "httpbin");
    });

    it("includes active grants in effective capabilities", () => {
      const mgr = new ManifestManager();
      mgr.register(testManifest);
      mgr.addGrant("test-task-mgr", {
        id: "grant-1",
        requestedAt: "2026-03-25T00:00:00Z",
        approvedAt: "2026-03-25T00:01:00Z",
        approvedBy: "auto:org-policy",
        reason: "need access",
        capability: {
          name: "extra",
          baseURL: "https://extra.example.com",
          allowedPaths: [],
          allowedMethods: [],
        },
      });
      const caps = mgr.getEffectiveCapabilities("test-task-mgr");
      assert.strictEqual(caps.network.length, 2);
    });
  });

  describe("getAllSnapshots", () => {
    it("returns all snapshots across manifests", () => {
      const mgr = new ManifestManager();
      mgr.register(testManifest);
      mgr.register({ ...testManifest, id: "second" });
      mgr.addSnapshot("test-task-mgr", {
        id: "s1",
        tag: "v1",
        createdAt: "",
        reason: "manual",
      });
      mgr.addSnapshot("second", {
        id: "s2",
        tag: "v2",
        createdAt: "",
        reason: "completion",
      });
      const all = mgr.getAllSnapshots();
      assert.strictEqual(all.length, 2);
      assert.strictEqual(all[0].manifestId, "test-task-mgr");
      assert.strictEqual(all[1].manifestId, "second");
    });
  });
});
