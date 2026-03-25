import type { MCPNetworkGrant } from "@quicksand/manifest";
import { filterToolsList, validateToolCall } from "./enforcement.js";
import {
  replaceCredentials,
  replaceCredentialsInHeaders,
} from "./credentials.js";
import type { JsonRpcRequest, JsonRpcResponse } from "./types.js";

/**
 * Forwards a JSON-RPC request to the upstream MCP server,
 * with credential injection.
 */
async function forwardToUpstream(
  grant: MCPNetworkGrant,
  request: JsonRpcRequest,
  incomingHeaders: Record<string, string>,
): Promise<JsonRpcResponse> {
  const url = replaceCredentials(grant.baseURL, grant.auth);

  // Build headers, replacing credentials and forwarding relevant ones
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Forward authorization-type headers from the incoming request
  for (const key of ["authorization", "x-api-key"]) {
    if (incomingHeaders[key]) {
      headers[key] = incomingHeaders[key];
    }
  }

  // Replace credentials in headers
  const finalHeaders = replaceCredentialsInHeaders(headers, grant.auth);

  // Replace credentials in the request body
  const bodyStr = replaceCredentials(JSON.stringify(request), grant.auth);

  const response = await fetch(url, {
    method: "POST",
    headers: finalHeaders,
    body: bodyStr,
  });

  if (!response.ok) {
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: {
        code: -32000,
        message: `Upstream MCP server returned ${response.status}: ${response.statusText}`,
      },
    };
  }

  const result = (await response.json()) as JsonRpcResponse;
  return result;
}

/**
 * Handles an MCP JSON-RPC request for a given grant.
 * - Intercepts tools/list and filters results
 * - Validates tools/call against allowedTools
 * - Passes through other methods (initialize, notifications, etc.)
 */
export async function handleMCPRequest(
  grant: MCPNetworkGrant,
  request: JsonRpcRequest,
  incomingHeaders: Record<string, string>,
): Promise<JsonRpcResponse> {
  const method = request.method;

  // Validate tools/call before forwarding
  if (method === "tools/call") {
    const params = request.params as
      | { name?: string; arguments?: unknown }
      | undefined;
    const toolName = params?.name;
    if (toolName) {
      const error = validateToolCall(grant, toolName);
      if (error) {
        return {
          jsonrpc: "2.0",
          id: request.id ?? null,
          error: { code: -32600, message: error },
        };
      }
    }
  }

  // Forward to upstream
  const response = await forwardToUpstream(grant, request, incomingHeaders);

  // Filter tools/list response
  if (method === "tools/list" && response.result) {
    const result = response.result as { tools?: Array<{ name: string; [key: string]: unknown }> };
    if (result.tools) {
      result.tools = filterToolsList(result.tools, grant);
    }
  }

  return response;
}
