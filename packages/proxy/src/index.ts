import { serve } from "@hono/node-server";
import { createServer } from "./server.js";

const port = parseInt(process.env.PORT || "8080", 10);
const { app } = createServer();

console.log(`Quicksand proxy starting on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Quicksand proxy listening on http://localhost:${port}`);

// Re-export for programmatic use
export { createServer } from "./server.js";
export type { ProxyConfig } from "./types.js";
export type { ServerInstance } from "./server.js";
