#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { createServer } from "./server.js";

const port = parseInt(process.env.PORT || "7080", 10);
const { app } = createServer();

console.log(`Quicksand proxy starting on port ${port}`);

serve({ fetch: app.fetch, port });

console.log(`Quicksand proxy listening on http://localhost:${port}`);
