import { describe, it } from "node:test";
import assert from "node:assert";
import { EscalationManager } from "@quicksand/proxy/escalation";
import { StateManager } from "@quicksand/proxy/state";
import { ActionLog } from "@quicksand/proxy/action-log";
import type { Manifest, AnyGrant, OrgPolicy } from "@quicksand/manifest";

function makeManifest(
  escalationDefault: "request_human" | "deny" = "request_human",
): Manifest {
  return {
    id: "test-esc",
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
      defaultAction: escalationDefault,
      approvalTimeoutSeconds: 60,
      snapshotOnPause: false,
    },
    environment: {
      snapshots: [],
      files: {},
      agent: { profile: "ollama-default", prompt: "Test" },
    },
  };
}

const newCapability: AnyGrant = {
  name: "new-api",
  baseURL: "https://new-api.example.com",
  allowedPaths: ["/data"],
  allowedMethods: ["GET"],
};

function makeOrgPolicy(overrides: Partial<OrgPolicy> = {}): OrgPolicy {
  return {
    autoApprove: [],
    forbidden: [],
    maxTaskLimits: { runtimeSeconds: 300, costUSD: 10.0 },
    globalLimits: { maxConcurrentTasks: 5, costUSD: 50.0 },
    logging: { detail: "full", streamAgentOutput: false },
    agentProfiles: [],
    ...overrides,
  };
}

describe("EscalationManager", () => {
  it("auto-approves when org policy has autoApprove matching capability", () => {
    const state = new StateManager();
    const log = new ActionLog();
    state.loadManifest(makeManifest());
    state.loadOrgPolicy(
      makeOrgPolicy({
        autoApprove: [newCapability],
      }),
    );
    const esc = new EscalationManager(state, log);

    const result = esc.requestEscalation("need new-api", newCapability);
    assert.strictEqual(result.status, "approved");
    // Grant should have been added to state
    const grants = state.getState()!.grants;
    assert.strictEqual(grants.length, 1);
    assert.strictEqual(grants[0].capability.name, "new-api");
    assert.strictEqual(grants[0].approvedBy, "auto:org-policy");
  });

  it("denies when org policy has forbidden matching capability name", () => {
    const state = new StateManager();
    const log = new ActionLog();
    state.loadManifest(makeManifest());
    state.loadOrgPolicy(
      makeOrgPolicy({
        forbidden: ["new-api"],
      }),
    );
    const esc = new EscalationManager(state, log);

    const result = esc.requestEscalation("need new-api", newCapability);
    assert.strictEqual(result.status, "denied");
    // No grants added
    assert.strictEqual(state.getState()!.grants.length, 0);
  });

  it("denies when manifest defaultAction is 'deny'", () => {
    const state = new StateManager();
    const log = new ActionLog();
    state.loadManifest(makeManifest("deny"));
    const esc = new EscalationManager(state, log);

    const result = esc.requestEscalation("need new-api", newCapability);
    assert.strictEqual(result.status, "denied");
  });

  it("stays pending when manifest defaultAction is 'request_human'", () => {
    const state = new StateManager();
    const log = new ActionLog();
    state.loadManifest(makeManifest("request_human"));
    const esc = new EscalationManager(state, log);

    const result = esc.requestEscalation("need new-api", newCapability);
    assert.strictEqual(result.status, "pending");
  });

  it("resolve pending -> approved adds grant to state", () => {
    const state = new StateManager();
    const log = new ActionLog();
    state.loadManifest(makeManifest("request_human"));
    const esc = new EscalationManager(state, log);

    const pending = esc.requestEscalation("need new-api", newCapability);
    assert.strictEqual(pending.status, "pending");

    const resolved = esc.resolve(pending.id, "approve", "alice");
    assert.ok(resolved);
    assert.strictEqual(resolved!.status, "approved");
    const grants = state.getState()!.grants;
    assert.strictEqual(grants.length, 1);
    assert.strictEqual(grants[0].approvedBy, "human:alice");
  });

  it("resolve pending -> denied does not add grant", () => {
    const state = new StateManager();
    const log = new ActionLog();
    state.loadManifest(makeManifest("request_human"));
    const esc = new EscalationManager(state, log);

    const pending = esc.requestEscalation("need new-api", newCapability);
    const resolved = esc.resolve(pending.id, "deny", "bob");
    assert.ok(resolved);
    assert.strictEqual(resolved!.status, "denied");
    assert.strictEqual(state.getState()!.grants.length, 0);
  });

  it("resolve already-resolved returns null", () => {
    const state = new StateManager();
    const log = new ActionLog();
    state.loadManifest(makeManifest("request_human"));
    const esc = new EscalationManager(state, log);

    const pending = esc.requestEscalation("need new-api", newCapability);
    esc.resolve(pending.id, "approve", "alice");
    const again = esc.resolve(pending.id, "approve", "alice");
    assert.strictEqual(again, null);
  });

  it("resolve unknown ID returns null", () => {
    const state = new StateManager();
    const log = new ActionLog();
    state.loadManifest(makeManifest());
    const esc = new EscalationManager(state, log);

    const result = esc.resolve("nonexistent", "approve", "alice");
    assert.strictEqual(result, null);
  });

  it("getPending only returns pending escalations", () => {
    const state = new StateManager();
    const log = new ActionLog();
    state.loadManifest(makeManifest("request_human"));
    const esc = new EscalationManager(state, log);

    const e1 = esc.requestEscalation("reason1", newCapability);
    const e2 = esc.requestEscalation("reason2", {
      ...newCapability,
      name: "other-api",
    });
    esc.resolve(e1.id, "approve", "alice");

    const pending = esc.getPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].id, e2.id);
  });
});
