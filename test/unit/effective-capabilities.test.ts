import { describe, it } from "node:test";
import assert from "node:assert";
import { effectiveCapabilities } from "@quicksand/manifest";
import type { ManifestState, Manifest, Grant } from "@quicksand/manifest";

const baseManifest: Manifest = {
  id: "test-caps",
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
    agent: { profile: "ollama-default", prompt: "Test" },
  },
};

describe("effectiveCapabilities", () => {
  it("returns manifest capabilities when no grants", () => {
    const state: ManifestState = { manifest: baseManifest, grants: [] };
    const caps = effectiveCapabilities(state);
    assert.strictEqual(caps.network.length, 1);
    assert.strictEqual(caps.network[0].name, "httpbin");
  });

  it("merges active grants into capabilities", () => {
    const grant: Grant = {
      id: "g1",
      requestedAt: "2026-03-25T00:00:00Z",
      approvedAt: "2026-03-25T00:01:00Z",
      approvedBy: "human:alice",
      reason: "needed",
      capability: {
        name: "new-api",
        baseURL: "https://new-api.example.com",
        allowedPaths: ["/data"],
        allowedMethods: ["GET"],
      },
    };
    const state: ManifestState = { manifest: baseManifest, grants: [grant] };
    const caps = effectiveCapabilities(state);
    assert.strictEqual(caps.network.length, 2);
    assert.strictEqual(caps.network[1].name, "new-api");
  });

  it("skips expired grants", () => {
    const grant: Grant = {
      id: "g-expired",
      requestedAt: "2020-01-01T00:00:00Z",
      approvedAt: "2020-01-01T00:01:00Z",
      approvedBy: "human:alice",
      reason: "needed",
      capability: {
        name: "expired-api",
        baseURL: "https://expired.example.com",
        allowedPaths: [],
        allowedMethods: [],
      },
      expiresAt: "2020-01-02T00:00:00Z", // expired in 2020
    };
    const state: ManifestState = { manifest: baseManifest, grants: [grant] };
    const caps = effectiveCapabilities(state);
    assert.strictEqual(caps.network.length, 1);
    assert.strictEqual(caps.network[0].name, "httpbin");
  });

  it("handles grants with no expiresAt (always active)", () => {
    const grant: Grant = {
      id: "g-no-expire",
      requestedAt: "2026-03-25T00:00:00Z",
      approvedAt: "2026-03-25T00:01:00Z",
      approvedBy: "human:alice",
      reason: "needed forever",
      capability: {
        name: "forever-api",
        baseURL: "https://forever.example.com",
        allowedPaths: [],
        allowedMethods: [],
      },
      // no expiresAt
    };
    const state: ManifestState = { manifest: baseManifest, grants: [grant] };
    const caps = effectiveCapabilities(state);
    assert.strictEqual(caps.network.length, 2);
    assert.strictEqual(caps.network[1].name, "forever-api");
  });
});
