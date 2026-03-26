import { Hono } from "hono";
import type { ManifestManager } from "../manifest-manager.js";
import type { ActionLog } from "../action-log.js";
import type { CostTracker } from "../cost-tracker.js";
import { findGrant, validateRequest, checkRateLimit } from "../enforcement.js";
import {
  replaceCredentials,
  replaceCredentialsInHeaders,
  replaceCredentialsInURL,
} from "../credentials.js";

/**
 * Creates the HTTP proxy route handler.
 * Routes: POST /proxy/:grantName/*
 *
 * The proxy reconstructs the target URL from the grant's
 * baseURL + the path after the grant name.
 */
export function createProxyRoutes(
  manifestManager: ManifestManager,
  actionLog: ActionLog,
  costTracker: CostTracker,
): Hono {
  const app = new Hono();

  // Catch-all: Hono strips the /proxy prefix since this is mounted via app.route("/proxy", ...)
  // So the path here is /:grantName/rest/of/path
  app.all("/*", async (c) => {
    const url = new URL(c.req.url);
    // Full pathname still includes /proxy, extract after it
    const fullPath = url.pathname;
    const proxyIdx = fullPath.indexOf("/proxy/");
    const afterProxy = proxyIdx !== -1 ? fullPath.slice(proxyIdx + "/proxy/".length) : fullPath.slice(1);
    const slashIdx = afterProxy.indexOf("/");
    const grantName = slashIdx === -1 ? afterProxy : afterProxy.slice(0, slashIdx);
    const targetPath = slashIdx === -1 ? "/" : afterProxy.slice(slashIdx);

    if (!grantName) {
      return c.json({ error: "Missing grant name in proxy URL" }, 400);
    }

    // Resolve which manifest this request belongs to
    const taskId = c.req.header("x-quicksand-task-id");
    if (!taskId) {
      return c.json({ error: "Missing X-Quicksand-Task-Id header" }, 400);
    }

    let capabilities;
    try {
      capabilities = manifestManager.getEffectiveCapabilities(taskId);
    } catch {
      return c.json({ error: `No manifest found for task ${taskId}` }, 404);
    }

    const grant = findGrant(capabilities, grantName);
    if (!grant) {
      actionLog.add(taskId, "denied", {
        reason: `No grant found for "${grantName}"`,
        method: c.req.method,
        path: targetPath,
      });
      return c.json({ error: `No grant found for "${grantName}"` }, 403);
    }

    // Rate limit check
    if (checkRateLimit(grant)) {
      return c.json(
        { error: `Rate limit exceeded for grant "${grantName}"` },
        429,
      );
    }

    // Validate method and path
    const validationError = validateRequest(grant, c.req.method, targetPath);
    if (validationError) {
      actionLog.add(taskId, "denied", {
        reason: validationError,
        method: c.req.method,
        path: targetPath,
        grantName,
      });
      return c.json({ error: validationError }, 403);
    }

    // Build target URL
    const baseURL = grant.baseURL.replace(/\/+$/, "");
    let targetURL = `${baseURL}${targetPath}`;

    // Forward query string
    if (url.search) {
      targetURL += url.search;
    }

    // Replace credentials in URL
    targetURL = replaceCredentialsInURL(targetURL, grant.auth);

    // Build forwarded headers
    const incomingHeaders: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      // Skip hop-by-hop headers and host
      const skip = ["host", "connection", "transfer-encoding", "content-length"];
      if (!skip.includes(key.toLowerCase())) {
        incomingHeaders[key] = value;
      }
    });
    const headers = replaceCredentialsInHeaders(incomingHeaders, grant.auth);

    // Build body
    let body: string | null = null;
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const rawBody = await c.req.text();
      if (rawBody) {
        body = replaceCredentials(rawBody, grant.auth);
      }
    }

    // Log the request
    actionLog.add(taskId, "http_request", {
      grantName,
      method: c.req.method,
      path: targetPath,
      targetURL,
    });

    // Track cost
    costTracker.recordRequest(taskId);

    // Forward the request
    try {
      const response = await fetch(targetURL, {
        method: c.req.method,
        headers,
        body,
      });

      // Forward response
      const responseBody = await response.arrayBuffer();
      const responseHeaders = new Headers();
      response.headers.forEach((value, key) => {
        // Skip hop-by-hop headers
        const skip = ["transfer-encoding", "connection"];
        if (!skip.includes(key.toLowerCase())) {
          responseHeaders.set(key, value);
        }
      });

      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown fetch error";
      return c.json({ error: `Upstream request failed: ${message}` }, 502);
    }
  });

  return app;
}
