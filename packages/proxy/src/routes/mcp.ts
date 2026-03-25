import { Hono } from "hono";
import type { StateManager } from "../state.js";
import type { ActionLog } from "../action-log.js";
import type { CostTracker } from "../cost-tracker.js";
import {
  findGrant,
  isMCPGrant,
  checkRateLimit,
} from "../enforcement.js";
import { handleMCPRequest } from "../mcp-bridge.js";
import type { JsonRpcRequest } from "../types.js";

/**
 * Creates MCP bridge route handlers.
 * Routes: POST /mcp/:name
 *
 * Acts as an MCP server (streamable HTTP transport) for each
 * MCPNetworkGrant. Forwards JSON-RPC requests upstream,
 * filtering tools/list and validating tools/call.
 */
export function createMCPRoutes(
  stateManager: StateManager,
  actionLog: ActionLog,
  costTracker: CostTracker,
): Hono {
  const app = new Hono();

  app.post("/:name", async (c) => {
    const name = c.req.param("name");

    let capabilities;
    try {
      capabilities = stateManager.getEffectiveCapabilities();
    } catch {
      return c.json({ error: "No manifest loaded" }, 500);
    }

    const grant = findGrant(capabilities, name);
    if (!grant) {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: `No MCP grant found for "${name}"` },
        },
        403,
      );
    }

    if (!isMCPGrant(grant)) {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32600,
            message: `Grant "${name}" is not an MCP grant`,
          },
        },
        400,
      );
    }

    // Rate limit check
    if (checkRateLimit(grant)) {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32000,
            message: `Rate limit exceeded for MCP grant "${name}"`,
          },
        },
        429,
      );
    }

    const taskId = stateManager.getManifest().id;

    let request: JsonRpcRequest;
    try {
      request = await c.req.json<JsonRpcRequest>();
    } catch {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Invalid JSON" },
        },
        400,
      );
    }

    // Log MCP tool calls
    if (request.method === "tools/call") {
      const params = request.params as
        | { name?: string; arguments?: unknown }
        | undefined;
      actionLog.add(taskId, "mcp_tool_call", {
        grantName: name,
        method: request.method,
        toolName: params?.name,
      });
    }

    costTracker.recordRequest(taskId);

    // Build incoming headers map
    const incomingHeaders: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      incomingHeaders[key] = value;
    });

    const response = await handleMCPRequest(grant, request, incomingHeaders);
    return c.json(response);
  });

  return app;
}
