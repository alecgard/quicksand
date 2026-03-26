#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import {
  ManifestSchema,
  OrgPolicySchema,
  type Manifest,
  type OrgPolicy,
} from "@quicksand/manifest";
import { createServer } from "@quicksand/proxy";
import { Executor, DockerProvider } from "@quicksand/sandbox";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadEnvFile(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function loadJSON(filePath: string): unknown {
  const resolved = resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(resolved, "utf-8"));
  } catch (err) {
    console.error(
      `Failed to parse JSON from ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

function loadManifest(filePath: string): Manifest {
  const raw = loadJSON(filePath);
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    console.error("Invalid manifest:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

function loadOrgPolicy(filePath: string): OrgPolicy {
  const raw = loadJSON(filePath);
  const result = OrgPolicySchema.safeParse(raw);
  if (!result.success) {
    console.error("Invalid org policy:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

function collectSecrets(manifest: Manifest): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const grant of manifest.capabilities.network) {
    if (grant.auth) {
      for (const cred of grant.auth) {
        const value = process.env[cred.secretRef];
        if (value) {
          secrets[cred.secretRef] = value;
        }
      }
    }
  }
  return secrets;
}

function parseArg(
  args: string[],
  flag: string,
): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function printUsage(): void {
  console.log(`Usage:
  quicksand run <manifest.json> [options]
    Run a task with a manifest file.
    --policy <org-policy.json>   Optional org policy file
    --image <image>              Docker image override
    --stream                     Stream agent output to console

  quicksand validate <manifest.json>
    Validate a manifest file against schemas.

  quicksand proxy [manifest.json] [options]
    Start the proxy server and control plane UI.
    --port <port>                Port to listen on (default 7080)
    --policy <org-policy.json>   Optional org policy file

  quicksand help
    Show this help message.`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdRun(args: string[]): Promise<void> {
  const manifestPath = args[0];
  if (!manifestPath) {
    console.error("Usage: quicksand run <manifest.json>");
    process.exit(1);
  }

  const manifest = loadManifest(manifestPath);
  const policyPath = parseArg(args, "--policy");
  const orgPolicy = policyPath ? loadOrgPolicy(policyPath) : undefined;
  const image = parseArg(args, "--image");
  const streamOutput = hasFlag(args, "--stream");

  const secrets = collectSecrets(manifest);

  const provider = new DockerProvider();
  const executor = new Executor(provider);

  console.log(`Running task: ${manifest.id}`);

  try {
    const result = await executor.runTask({
      manifest,
      orgPolicy,
      image: image ?? undefined,
      secrets,
      streamOutput,
    });

    console.log(`\nTask completed with exit code: ${result.exitCode}`);
    console.log(`Grants issued: ${result.manifestState.grants.length}`);

    if (result.exitCode !== 0) {
      process.exit(result.exitCode);
    }
  } catch (err) {
    console.error(
      `Task failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

function cmdValidate(args: string[]): void {
  const manifestPath = args[0];
  if (!manifestPath) {
    console.error("Usage: quicksand validate <manifest.json>");
    process.exit(1);
  }

  const raw = loadJSON(manifestPath);
  const result = ManifestSchema.safeParse(raw);

  if (result.success) {
    console.log("Manifest is valid.");
    console.log(`  ID: ${result.data.id}`);
    console.log(
      `  Network grants: ${result.data.capabilities.network.length}`,
    );
    console.log(`  Agent profile: ${result.data.environment.agent.profile}`);
  } else {
    console.error("Manifest validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
}

function cmdProxy(args: string[]): void {
  const manifestPath = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const manifest = manifestPath ? loadManifest(manifestPath) : undefined;
  const policyPath = parseArg(args, "--policy");
  const orgPolicy = policyPath ? loadOrgPolicy(policyPath) : undefined;
  const portStr = parseArg(args, "--port");
  const port = portStr ? parseInt(portStr, 10) : 7080;

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error("Invalid port number");
    process.exit(1);
  }

  // Check Docker availability
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    console.warn("⚠ Docker is not running — task execution will fail. Start Docker to run sandboxes.");
  }

  const { app } = createServer({
    manifest,
    orgPolicy,
  });

  console.log(`Starting proxy server on port ${port}`);
  if (manifest) {
    console.log(`Manifest: ${manifest.id}`);
  } else {
    console.log("No manifest loaded — create tasks from the UI");
  }

  serve({ fetch: app.fetch, port });

  console.log(`Proxy listening on http://localhost:${port}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  loadEnvFile();

  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "run":
      cmdRun(commandArgs);
      break;
    case "validate":
      cmdValidate(commandArgs);
      break;
    case "proxy":
      cmdProxy(commandArgs);
      break;
    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;
    default:
      if (command) {
        console.error(`Unknown command: ${command}\n`);
      }
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

main();
