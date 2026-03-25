import type { Manifest, OrgPolicy, ManifestState } from "@quicksand/manifest";

/** Platform-agnostic sandbox provider interface */
export interface SandboxProvider {
  createNetwork(name: string): Promise<{ name: string; gateway: string }>;
  removeNetwork(name: string): Promise<void>;
  createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle>;
}

export interface SandboxCreateConfig {
  id: string;
  image: string;
  networkName: string;
  proxyIP: string;
  env: Record<string, string>;
  files: Record<string, string>;
  workdir: string;
  command: string[];
}

export interface SandboxHandle {
  id: string;
  containerId: string;
  start(): Promise<void>;
  stop(timeout?: number): Promise<void>;
  remove(): Promise<void>;
  exec(
    command: string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  snapshot(tag: string): Promise<string>;
  wait(): Promise<{ exitCode: number }>;
  streamLogs(onData: (data: string) => void): Promise<void>;
}

export interface TaskConfig {
  manifest: Manifest;
  orgPolicy?: OrgPolicy;
  /** Docker image for the sandbox. Defaults to "quicksand-sandbox:latest" */
  image?: string;
  /** Secrets to inject — maps secretRef names to actual values */
  secrets?: Record<string, string>;
  /** Stream agent output to console */
  streamOutput?: boolean;
}

export interface TaskResult {
  exitCode: number;
  manifestState: ManifestState;
  logs: string[];
}
