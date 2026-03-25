import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  matchPath,
  validateRequest,
  validateToolCall,
  filterToolsList,
  checkRateLimit,
  resetRateLimits,
} from "@quicksand/proxy/enforcement";
import type { NetworkGrant, MCPNetworkGrant } from "@quicksand/manifest";

// ---------------------------------------------------------------------------
// matchPath
// ---------------------------------------------------------------------------

describe("matchPath", () => {
  it("exact match", () => {
    assert.strictEqual(matchPath("/api/v1/logs", "/api/v1/logs"), true);
  });

  it("wildcard at end", () => {
    assert.strictEqual(matchPath("/api/v1/logs/*", "/api/v1/logs/foo"), true);
  });

  it("wildcard in middle", () => {
    assert.strictEqual(
      matchPath("/api/*/logs", "/api/v1/logs"),
      true,
    );
  });

  it("no match", () => {
    assert.strictEqual(matchPath("/api/v1/logs", "/api/v2/logs"), false);
  });

  it("empty allowedPaths means caller should skip — but matchPath itself just matches", () => {
    // matchPath is always called with a concrete pattern, so an empty string
    // pattern only matches an empty path.
    assert.strictEqual(matchPath("", ""), true);
    assert.strictEqual(matchPath("", "/anything"), false);
  });
});

// ---------------------------------------------------------------------------
// validateRequest
// ---------------------------------------------------------------------------

describe("validateRequest", () => {
  const grant: NetworkGrant = {
    name: "test-api",
    baseURL: "https://api.example.com",
    allowedPaths: ["/v1/data", "/v1/status/*"],
    allowedMethods: ["GET", "POST"],
  };

  it("allowed method and path passes", () => {
    const result = validateRequest(grant, "GET", "/v1/data");
    assert.strictEqual(result, null);
  });

  it("disallowed method fails", () => {
    const result = validateRequest(grant, "DELETE", "/v1/data");
    assert.ok(result !== null);
    assert.ok(result.includes("DELETE"));
  });

  it("disallowed path fails", () => {
    const result = validateRequest(grant, "GET", "/v2/secret");
    assert.ok(result !== null);
    assert.ok(result.includes("/v2/secret"));
  });

  it("empty methods means all allowed", () => {
    const openGrant: NetworkGrant = {
      ...grant,
      allowedMethods: [],
    };
    const result = validateRequest(openGrant, "DELETE", "/v1/data");
    assert.strictEqual(result, null);
  });

  it("empty paths means all allowed", () => {
    const openGrant: NetworkGrant = {
      ...grant,
      allowedPaths: [],
    };
    const result = validateRequest(openGrant, "GET", "/any/path/here");
    assert.strictEqual(result, null);
  });
});

// ---------------------------------------------------------------------------
// validateToolCall
// ---------------------------------------------------------------------------

describe("validateToolCall", () => {
  const grant: MCPNetworkGrant = {
    name: "github-mcp",
    baseURL: "http://mcp-github:3000",
    allowedPaths: [],
    allowedMethods: ["POST"],
    allowedTools: ["get_file", "search_code"],
  };

  it("allowed tool passes", () => {
    const result = validateToolCall(grant, "get_file");
    assert.strictEqual(result, null);
  });

  it("disallowed tool fails", () => {
    const result = validateToolCall(grant, "delete_repo");
    assert.ok(result !== null);
    assert.ok(result.includes("delete_repo"));
  });

  it("empty allowedTools means all allowed", () => {
    const openGrant: MCPNetworkGrant = {
      ...grant,
      allowedTools: [],
    };
    const result = validateToolCall(openGrant, "anything");
    assert.strictEqual(result, null);
  });
});

// ---------------------------------------------------------------------------
// filterToolsList
// ---------------------------------------------------------------------------

describe("filterToolsList", () => {
  const grant: MCPNetworkGrant = {
    name: "github-mcp",
    baseURL: "http://mcp-github:3000",
    allowedPaths: [],
    allowedMethods: ["POST"],
    allowedTools: ["get_file", "search_code"],
  };

  const allTools = [
    { name: "get_file", description: "Get a file" },
    { name: "search_code", description: "Search code" },
    { name: "delete_repo", description: "Delete a repo" },
    { name: "create_issue", description: "Create an issue" },
  ];

  it("filters to only allowed tools", () => {
    const result = filterToolsList(allTools, grant);
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(
      result.map((t) => t.name),
      ["get_file", "search_code"],
    );
  });

  it("empty allowedTools returns all", () => {
    const openGrant: MCPNetworkGrant = {
      ...grant,
      allowedTools: [],
    };
    const result = filterToolsList(allTools, openGrant);
    assert.strictEqual(result.length, allTools.length);
  });
});

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("under limit allows requests", () => {
    const grant: NetworkGrant = {
      name: "rate-test",
      baseURL: "https://example.com",
      allowedPaths: [],
      allowedMethods: [],
      rateLimit: { requests: 5, windowSeconds: 60 },
    };

    // First request should be allowed
    assert.strictEqual(checkRateLimit(grant), false);
    assert.strictEqual(checkRateLimit(grant), false);
    assert.strictEqual(checkRateLimit(grant), false);
  });

  it("at limit blocks requests", () => {
    const grant: NetworkGrant = {
      name: "rate-test-block",
      baseURL: "https://example.com",
      allowedPaths: [],
      allowedMethods: [],
      rateLimit: { requests: 2, windowSeconds: 60 },
    };

    // Use up the limit
    assert.strictEqual(checkRateLimit(grant), false);
    assert.strictEqual(checkRateLimit(grant), false);
    // Third request should be blocked
    assert.strictEqual(checkRateLimit(grant), true);
  });

  it("no rate limit always allows", () => {
    const grant: NetworkGrant = {
      name: "no-rate-limit",
      baseURL: "https://example.com",
      allowedPaths: [],
      allowedMethods: [],
    };

    for (let i = 0; i < 100; i++) {
      assert.strictEqual(checkRateLimit(grant), false);
    }
  });
});
