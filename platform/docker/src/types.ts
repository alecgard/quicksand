/**
 * Docker-specific configuration types for sandbox containers and networking.
 */

export interface SandboxConfig {
  /** Unique sandbox ID */
  id: string;
  /** Docker image to use */
  image: string;
  /** Proxy container's IP on the internal network */
  proxyIP: string;
  /** Internal network name */
  networkName: string;
  /** Files to write into the container after creation */
  files: Record<string, string>;
  /** Environment variables for the container */
  env: Record<string, string>;
  /** Working directory inside the container */
  workdir: string;
  /** Command to run */
  command: string[];
}

export interface SandboxInstance {
  id: string;
  containerId: string;
  status: "created" | "running" | "stopped" | "removed";
}

export interface DockerNetwork {
  name: string;
  subnet: string;
  gateway: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
