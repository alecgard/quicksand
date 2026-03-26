import { createServer } from "@quicksand/proxy";
import { serve } from "@hono/node-server";
import type {
  SandboxProvider,
  SandboxHandle,
  TaskConfig,
  TaskResult,
} from "./types.js";
import { resolveAgentCommand } from "@quicksand/manifest";

export class Executor {
  constructor(private provider: SandboxProvider) {}

  async runTask(config: TaskConfig): Promise<TaskResult> {
    const networkName = `qs-${config.manifest.id}`;
    const proxyPort = 7080;

    // 1. Create the proxy server in-process
    const { app, manifestManager } = createServer({
      manifest: config.manifest,
      orgPolicy: config.orgPolicy,
    });

    // Set secrets as env vars for the proxy's credential replacement
    if (config.secrets) {
      for (const [key, value] of Object.entries(config.secrets)) {
        process.env[key] = value;
      }
    }

    // 2. Start the Hono server
    const server = serve({ fetch: app.fetch, port: proxyPort });

    // 3. Create network
    const network = await this.provider.createNetwork(networkName);

    const logs: string[] = [];
    let sandbox: SandboxHandle | undefined;

    try {
      // 4. Create sandbox
      const image = config.image ?? "quicksand-sandbox:latest";

      // Build the files to inject — the agent config with proxy URL
      const agentEnv = config.manifest.environment;
      const files: Record<string, string> = { ...agentEnv.files };

      // Write a proxy config file the agent can use
      files["/home/agent/.quicksand/proxy.json"] = JSON.stringify({
        proxyURL: `http://${network.gateway}:${proxyPort}`,
        taskId: config.manifest.id,
      });

      // Write the task prompt
      files["/home/agent/.quicksand/prompt.md"] = agentEnv.agent.prompt;

      sandbox = await this.provider.createSandbox({
        id: `qs-sandbox-${config.manifest.id}`,
        image,
        networkName,
        proxyIP: network.gateway,
        env: {
          QUICKSAND_PROXY_URL: `http://${network.gateway}:${proxyPort}`,
          QUICKSAND_TASK_ID: config.manifest.id,
          HTTP_PROXY: `http://${network.gateway}:${proxyPort}`,
          HTTPS_PROXY: `http://${network.gateway}:${proxyPort}`,
        },
        files,
        workdir: "/home/agent",
        command: resolveAgentCommand(agentEnv.agent.profile, agentEnv.agent.prompt, network.gateway, proxyPort),
      });

      // 5. Start sandbox
      await sandbox.start();

      // 6. Stream logs if requested
      if (config.streamOutput) {
        sandbox
          .streamLogs((data: string) => {
            logs.push(data);
            process.stdout.write(data);
          })
          .catch(() => {});
      }

      // 7. Wait for completion
      const result = await sandbox.wait();

      const state = manifestManager.get(config.manifest.id);

      return {
        exitCode: result.exitCode,
        manifestState: state!,
        logs,
      };
    } finally {
      // Cleanup
      try {
        if (sandbox) await sandbox.stop(10);
      } catch {}
      try {
        if (sandbox) await sandbox.remove();
      } catch {}
      try {
        await this.provider.removeNetwork(networkName);
      } catch {}

      // Close the server
      if (server && typeof (server as any).close === "function") {
        (server as any).close();
      }

      // Clean up env vars
      if (config.secrets) {
        for (const key of Object.keys(config.secrets)) {
          delete process.env[key];
        }
      }
    }
  }
}
