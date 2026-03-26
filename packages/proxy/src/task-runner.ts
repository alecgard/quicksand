import type { Manifest } from "@quicksand/manifest";
import type { TaskManager } from "./task-manager.js";
import type { StateManager } from "./state.js";
import type { ActionLog } from "./action-log.js";
import {
  createSandboxNetwork,
  removeSandboxNetwork,
  createSandbox,
  startSandbox,
  stopSandbox,
  removeSandbox,
  streamSandboxLogs,
  waitForSandbox,
  writeFilesToSandbox,
} from "@quicksand/platform-docker";
import { resolveAgentCommand } from "@quicksand/manifest";

/**
 * Runs tasks by spinning up Docker sandboxes that route through
 * the already-running proxy. Tasks execute in the background.
 */
export class TaskRunner {
  private proxyHost: string;
  private proxyPort: number;

  constructor(
    private taskManager: TaskManager,
    private stateManager: StateManager,
    private actionLog: ActionLog,
    opts: { proxyHost?: string; proxyPort?: number } = {},
  ) {
    this.proxyHost = opts.proxyHost ?? "172.20.0.2";
    this.proxyPort = opts.proxyPort ?? 8080;
  }

  /**
   * Run a task in the background. Creates the Docker network and
   * sandbox, starts the agent, and updates the task record as it
   * progresses.
   */
  async run(taskId: string): Promise<void> {
    const task = this.taskManager.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!task.manifestState) throw new Error(`Task ${taskId} has no manifest`);

    const manifest = task.manifestState.manifest;
    const networkName = `qs-${manifest.id}`;
    const containerId = `qs-sandbox-${manifest.id}`;
    const proxyURL = `http://${this.proxyHost}:${this.proxyPort}`;

    // Load this task's manifest into the proxy state so proxy
    // enforcement works for this task's requests
    this.stateManager.loadManifest(manifest);

    this.taskManager.updateTask(taskId, {
      status: "running",
      startedAt: new Date().toISOString(),
    });

    this.actionLog.add(taskId, "http_request", {
      type: "task_started",
      taskId,
      containerId,
    });

    let network: { name: string; gateway: string } | undefined;

    try {
      // Create isolated network with proxy as gateway
      const dockerNet = await createSandboxNetwork(networkName);
      network = { name: dockerNet.name, gateway: dockerNet.gateway };

      // Build files to inject
      const agentEnv = manifest.environment;
      const files: Record<string, string> = { ...agentEnv.files };
      files["/home/agent/.quicksand/proxy.json"] = JSON.stringify({
        proxyURL,
        taskId: manifest.id,
      });
      files["/home/agent/.quicksand/prompt.md"] = agentEnv.agent.prompt;

      // Create sandbox container
      const instance = await createSandbox({
        id: containerId,
        image: "quicksand-sandbox:latest",
        networkName,
        proxyIP: network.gateway,
        env: {
          QUICKSAND_PROXY_URL: proxyURL,
          QUICKSAND_TASK_ID: manifest.id,
          HTTP_PROXY: proxyURL,
          HTTPS_PROXY: proxyURL,
        },
        files,
        workdir: "/home/agent",
        command: resolveAgentCommand(
          agentEnv.agent.profile,
          agentEnv.agent.prompt,
          network.gateway,
          this.proxyPort,
        ),
      });

      // Start
      await startSandbox(instance.containerId);

      // Stream logs (fire and forget)
      streamSandboxLogs(instance.containerId, (data) => {
        this.actionLog.add(taskId, "http_request", {
          type: "agent_output",
          output: data.trim(),
        });
      }).catch(() => {});

      // Wait for completion
      const result = await waitForSandbox(instance.containerId);

      this.taskManager.updateTask(taskId, {
        status: result.exitCode === 0 ? "completed" : "failed",
        completedAt: new Date().toISOString(),
        exitCode: result.exitCode,
      });
    } catch (err) {
      this.taskManager.updateTask(taskId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      // Cleanup
      try { await stopSandbox(containerId, 10); } catch {}
      try { await removeSandbox(containerId); } catch {}
      try { if (network) await removeSandboxNetwork(networkName); } catch {}
    }
  }
}
