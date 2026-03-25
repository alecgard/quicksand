import type {
  SandboxProvider,
  SandboxCreateConfig,
  SandboxHandle,
} from "./types.js";
import {
  createSandboxNetwork,
  removeSandboxNetwork,
  createSandbox as dockerCreateSandbox,
  startSandbox,
  stopSandbox,
  removeSandbox,
  execInSandbox,
  snapshotSandbox,
  waitForSandbox,
  streamSandboxLogs,
} from "@quicksand/platform-docker";

export class DockerProvider implements SandboxProvider {
  async createNetwork(name: string) {
    const network = await createSandboxNetwork(name);
    return { name: network.name, gateway: network.gateway };
  }

  async removeNetwork(name: string) {
    await removeSandboxNetwork(name);
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const instance = await dockerCreateSandbox(config);

    return {
      id: instance.id,
      containerId: instance.containerId,
      start: () => startSandbox(instance.containerId),
      stop: (timeout?: number) => stopSandbox(instance.containerId, timeout),
      remove: () => removeSandbox(instance.containerId),
      exec: (cmd: string[]) => execInSandbox(instance.containerId, cmd),
      snapshot: (tag: string) => snapshotSandbox(instance.containerId, tag),
      wait: () => waitForSandbox(instance.containerId),
      streamLogs: (onData: (data: string) => void) =>
        streamSandboxLogs(instance.containerId, onData),
    };
  }
}
