import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DockerNetwork } from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_SUBNET = "172.20.0.0/24";
const DEFAULT_GATEWAY = "172.20.0.2";

/**
 * Creates an internal Docker network with no external connectivity.
 * The proxy sits at the gateway address, making it the only route
 * for sandbox containers.
 */
export async function createSandboxNetwork(
  name: string,
  subnet?: string,
): Promise<DockerNetwork> {
  const resolvedSubnet = subnet ?? DEFAULT_SUBNET;
  const gateway = DEFAULT_GATEWAY;

  try {
    await execFileAsync("docker", [
      "network",
      "create",
      "--internal",
      "--subnet",
      resolvedSubnet,
      "--gateway",
      gateway,
      name,
    ]);
  } catch (err) {
    throw new Error(
      `Failed to create Docker network "${name}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { name, subnet: resolvedSubnet, gateway };
}

/**
 * Removes a Docker network by name.
 */
export async function removeSandboxNetwork(name: string): Promise<void> {
  try {
    await execFileAsync("docker", ["network", "rm", name]);
  } catch (err) {
    throw new Error(
      `Failed to remove Docker network "${name}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Checks whether a Docker network with the given name exists.
 */
export async function networkExists(name: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "network",
      "ls",
      "--filter",
      `name=^${name}$`,
      "--format",
      "{{.Name}}",
    ]);
    return stdout.trim() === name;
  } catch {
    return false;
  }
}
