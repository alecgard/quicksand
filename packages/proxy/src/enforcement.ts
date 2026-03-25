import type {
  AnyGrant,
  NetworkGrant,
  MCPNetworkGrant,
  CapabilitySet,
} from "@quicksand/manifest";
import type { RateLimitWindow } from "./types.js";

/**
 * Checks if a grant has allowedTools, indicating it's an MCPNetworkGrant.
 */
export function isMCPGrant(grant: AnyGrant): grant is MCPNetworkGrant {
  return "allowedTools" in grant;
}

/**
 * Matches a path against a pattern supporting `*` wildcards.
 * - `*` matches any sequence of characters within a single path segment
 * - Patterns like `/api/v1/logs/*` match `/api/v1/logs/foo` but not `/api/v1/logs/foo/bar`
 * - Use `/api/v1/**` style isn't required; `*` at the end of a path matches the rest
 *
 * Simple glob: each `*` maps to `[^/]*` except trailing `*` which maps to `.*`
 */
export function matchPath(pattern: string, path: string): boolean {
  // Normalize: remove trailing slashes for consistency
  const normalizedPattern = pattern.replace(/\/+$/, "");
  const normalizedPath = path.replace(/\/+$/, "");

  // Convert glob pattern to regex
  // Escape regex special chars except *
  let regex = normalizedPattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  return new RegExp(`^${regex}$`).test(normalizedPath);
}

/**
 * Finds a grant by name in the effective capabilities.
 */
export function findGrant(
  capabilities: CapabilitySet,
  grantName: string,
): AnyGrant | undefined {
  return capabilities.network.find((g) => g.name === grantName);
}

/**
 * Validates an HTTP request against a network grant.
 * Returns null if allowed, or an error message string if denied.
 */
export function validateRequest(
  grant: AnyGrant,
  method: string,
  path: string,
): string | null {
  // Check method
  if (
    grant.allowedMethods.length > 0 &&
    !grant.allowedMethods.includes(method.toUpperCase())
  ) {
    return `Method ${method} not allowed for grant "${grant.name}". Allowed: ${grant.allowedMethods.join(", ")}`;
  }

  // Check path
  if (grant.allowedPaths.length > 0) {
    const matched = grant.allowedPaths.some((pattern) =>
      matchPath(pattern, path),
    );
    if (!matched) {
      return `Path ${path} not allowed for grant "${grant.name}". Allowed patterns: ${grant.allowedPaths.join(", ")}`;
    }
  }

  return null;
}

/**
 * Validates an MCP tool call against the grant's allowedTools.
 * Returns null if allowed, or an error message if denied.
 */
export function validateToolCall(
  grant: MCPNetworkGrant,
  toolName: string,
): string | null {
  // Empty allowedTools means all tools are available
  if (grant.allowedTools.length === 0) return null;

  if (!grant.allowedTools.includes(toolName)) {
    return `Tool "${toolName}" not allowed for MCP grant "${grant.name}". Allowed: ${grant.allowedTools.join(", ")}`;
  }

  return null;
}

/**
 * Filters a tools/list response to only include allowed tools.
 */
export function filterToolsList(
  tools: Array<{ name: string; [key: string]: unknown }>,
  grant: MCPNetworkGrant,
): Array<{ name: string; [key: string]: unknown }> {
  // Empty allowedTools means all tools are available
  if (grant.allowedTools.length === 0) return tools;

  return tools.filter((tool) => grant.allowedTools.includes(tool.name));
}

/**
 * Rate limit state per grant, keyed by grant name.
 */
const rateLimitWindows = new Map<string, RateLimitWindow>();

/**
 * Checks rate limit for a grant. Returns true if the request should be
 * rate limited (rejected), false if it's allowed.
 */
export function checkRateLimit(grant: AnyGrant): boolean {
  if (!grant.rateLimit) return false;

  const now = Date.now();
  const windowMs = grant.rateLimit.windowSeconds * 1000;

  let window = rateLimitWindows.get(grant.name);
  if (!window) {
    window = { timestamps: [] };
    rateLimitWindows.set(grant.name, window);
  }

  // Remove timestamps outside the sliding window
  window.timestamps = window.timestamps.filter((t) => now - t < windowMs);

  if (window.timestamps.length >= grant.rateLimit.requests) {
    return true; // Rate limited
  }

  window.timestamps.push(now);
  return false;
}

/**
 * Resets rate limit tracking (useful for testing).
 */
export function resetRateLimits(): void {
  rateLimitWindows.clear();
}
