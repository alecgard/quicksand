import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { SandboxConfig, SandboxInstance, ExecResult } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Creates a sandbox container on the internal network with the proxy as
 * default gateway. The container has no outbound internet access. DNS is
 * set to the proxy IP so all resolution goes through the proxy.
 */
export async function createSandbox(
  config: SandboxConfig,
): Promise<SandboxInstance> {
  const args: string[] = [
    "create",
    "--name",
    config.id,
    "--network",
    config.networkName,
    "--dns",
    config.proxyIP,
    "--user",
    "1000:1000",
    "-w",
    config.workdir,
  ];

  // Environment variables
  for (const [key, value] of Object.entries(config.env)) {
    args.push("-e", `${key}=${value}`);
  }

  // Image and command
  args.push(config.image, ...config.command);

  let containerId: string;
  try {
    const { stdout } = await execFileAsync("docker", args);
    containerId = stdout.trim();
  } catch (err) {
    throw new Error(
      `Failed to create sandbox "${config.id}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Write files into the container if any are specified
  if (Object.keys(config.files).length > 0) {
    await writeFilesToSandbox(containerId, config.files);
  }

  return {
    id: config.id,
    containerId,
    status: "created",
  };
}

/**
 * Starts a created container.
 */
export async function startSandbox(containerId: string): Promise<void> {
  try {
    await execFileAsync("docker", ["start", containerId]);
  } catch (err) {
    throw new Error(
      `Failed to start sandbox "${containerId}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Stops a running container.
 */
export async function stopSandbox(
  containerId: string,
  timeout?: number,
): Promise<void> {
  const args = ["stop"];
  if (timeout !== undefined) {
    args.push("-t", String(timeout));
  }
  args.push(containerId);

  try {
    await execFileAsync("docker", args);
  } catch (err) {
    throw new Error(
      `Failed to stop sandbox "${containerId}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Removes a container.
 */
export async function removeSandbox(containerId: string): Promise<void> {
  try {
    await execFileAsync("docker", ["rm", "-f", containerId]);
  } catch (err) {
    throw new Error(
      `Failed to remove sandbox "${containerId}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Executes a command inside a running container and returns the result.
 */
export async function execInSandbox(
  containerId: string,
  command: string[],
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync("docker", [
      "exec",
      containerId,
      ...command,
    ]);
    return { exitCode: 0, stdout, stderr };
  } catch (err: unknown) {
    // execFile throws on non-zero exit codes
    const execErr = err as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (execErr.stdout !== undefined || execErr.stderr !== undefined) {
      return {
        exitCode: typeof execErr.code === "number" ? execErr.code : 1,
        stdout: execErr.stdout ?? "",
        stderr: execErr.stderr ?? "",
      };
    }
    throw new Error(
      `Failed to exec in sandbox "${containerId}": ${execErr.message ?? String(err)}`,
    );
  }
}

/**
 * Commits the current state of a container as a new image.
 * Returns the image ID.
 */
export async function snapshotSandbox(
  containerId: string,
  tag: string,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "commit",
      containerId,
      tag,
    ]);
    return stdout.trim();
  } catch (err) {
    throw new Error(
      `Failed to snapshot sandbox "${containerId}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Streams stdout/stderr from a container. Calls onData for each chunk
 * of output. Resolves when the log stream ends.
 */
export async function streamSandboxLogs(
  containerId: string,
  onData: (data: string) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn("docker", ["logs", "-f", containerId]);

    proc.stdout.on("data", (chunk: Buffer) => {
      onData(chunk.toString());
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      onData(chunk.toString());
    });

    proc.on("error", (err) => {
      reject(
        new Error(
          `Failed to stream logs for sandbox "${containerId}": ${err.message}`,
        ),
      );
    });

    proc.on("close", () => {
      resolve();
    });
  });
}

/**
 * Waits for a container to exit and returns the exit code.
 */
export async function waitForSandbox(
  containerId: string,
): Promise<{ exitCode: number }> {
  try {
    const { stdout } = await execFileAsync("docker", [
      "wait",
      containerId,
    ]);
    const exitCode = parseInt(stdout.trim(), 10);
    return { exitCode: isNaN(exitCode) ? 1 : exitCode };
  } catch (err) {
    throw new Error(
      `Failed to wait for sandbox "${containerId}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Writes files into a container (created or running) by creating a temp
 * directory with the file layout and using `docker cp` to copy it in.
 */
export async function writeFilesToSandbox(
  containerId: string,
  files: Record<string, string>,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "qs-sandbox-"));

  try {
    // Write each file into the temp directory, mirroring the absolute
    // path structure. We strip the leading slash so the paths are relative
    // within the temp dir.
    for (const [filePath, content] of Object.entries(files)) {
      const relativePath = filePath.startsWith("/")
        ? filePath.slice(1)
        : filePath;
      const fullPath = join(tempDir, relativePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf-8");
    }

    // Copy the temp directory contents into the container root
    await execFileAsync("docker", [
      "cp",
      `${tempDir}/.`,
      `${containerId}:/`,
    ]);
  } catch (err) {
    throw new Error(
      `Failed to write files to sandbox "${containerId}": ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
