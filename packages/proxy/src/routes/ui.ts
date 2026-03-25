import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

/**
 * Creates static file serving for the approval UI.
 * Serves files from the public/ directory at the root path.
 */
export function createUIRoutes(): Hono {
  const app = new Hono();

  app.use(
    "/*",
    serveStatic({
      root: "./packages/proxy/public",
    }),
  );

  return app;
}
