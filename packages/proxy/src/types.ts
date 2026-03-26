import type {
  Manifest,
  ManifestState,
  OrgPolicy,
} from "@quicksand/manifest";

/** Configuration accepted by the server factory. */
export interface ProxyConfig {
  /** Pre-loaded manifest (takes precedence over MANIFEST_PATH env var) */
  manifest?: Manifest;

  /** Pre-loaded org policy (takes precedence over ORG_POLICY_PATH env var) */
  orgPolicy?: OrgPolicy;

  /** Port to listen on (default: 7080) */
  port?: number;
}

/** Sliding-window rate limit tracker entry. */
export interface RateLimitWindow {
  timestamps: number[];
}

/** In-memory escalation with a pending/resolved status. */
export interface PendingEscalation {
  id: string;
  taskId: string;
  manifestId: string;
  reason: string;
  requestedAt: string;
  status: "pending" | "approved" | "denied" | "timeout";
  capability: import("@quicksand/manifest").AnyGrant;
}

/** Cost tracking entry per task. */
export interface CostEntry {
  taskId: string;
  totalUSD: number;
  requestCount: number;
  llmCostUSD: number;
}

/** JSON-RPC request shape for MCP. */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

/** JSON-RPC response shape for MCP. */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
