# Quicksand

Least-privilege scoped environments for AI agents.

## Overview

Quicksand is infrastructure for running AI agents in sandboxed environments where they can only access what they've been explicitly granted. The core principle: **the agent never touches the real world directly. Everything goes through a proxy that enforces a manifest.**

The agent runs in an isolated container with no internet access. All external interactions — MCP tool calls, API requests, git clones, package installs — route through a proxy that validates every request against the agent's manifest. Credentials never enter the sandbox. The proxy injects them at request time.

The project is local-first, built on Docker with clean abstractions so Cloudflare Sandbox can be added as a deployment target later.

## Architecture

```
User: "Fix the payments bug and ship it"
        ↓
Executor spins up orchestrator agent sandbox
        ↓
Orchestrator agent produces a Plan
  (list of steps, each with capabilities + prompt)
        ↓
Executor validates plan against org policy
        ↓
Human approves plan (or auto-approved)
        ↓
Executor runs each step:
  → Creates manifest from step capabilities
  → Spins up sandbox
  → Agent runs
  → Snapshots output
  → Passes snapshot to next step
        ↓
Step fails?
  → Executor sends failure context to orchestrator agent
  → Orchestrator revises the plan
  → Human approves revision
  → Executor continues
        ↓
All steps complete → done
```

### Core Components

**Sandbox** — an isolated Docker container with no outbound network access. All traffic routes through the proxy at the network level (proxy is the container's default gateway). The agent runs here. It can be any MCP-compatible agent — Claude Code, custom loops, future frameworks. No custom harness needed.

**Proxy** — the policy enforcement point. Sits outside the sandbox, holds all credentials, enforces the manifest. Speaks MCP natively for MCP server grants (acting as a bridge between the agent and real MCP servers). Handles HTTP proxying for network grants (git, package registries, REST APIs). Logs every action. Tracks costs. Manages escalations. The proxy knows which sandbox is calling it via a token injected at sandbox creation time.

**Executor** — trusted, deterministic code (not an agent). Receives plans, validates against org policy, routes for approval, spins up sandboxes, passes snapshots between steps, handles failures by asking the orchestrator agent to replan.

**Orchestrator Agent** — itself runs in a sandbox with minimal capabilities (LLM access + read-only capability registry). Decomposes tasks into plans. Proposes capabilities per step. Generates manifests. The planner is sandboxed too.

### Security Model

The sandbox is a padded room with one phone line that goes to the proxy. The proxy is the only thing the sandbox can reach — enforced at the network level, not by convention.

- **Credentials never reach the sandbox.** The proxy holds all secrets and injects them into outbound requests using placeholder replacement. The agent uses synthetic placeholder strings; the proxy swaps them for real credentials on every request.
- **MCP tools are filtered.** The proxy connects to real MCP servers upstream and exposes only the granted tools. The agent sees separate MCP endpoints per server, each filtered by the manifest.
- **Network access is an allowlist.** Every endpoint the agent can reach is explicitly listed. Anything not listed is unreachable — the container has no route to the internet.
- **The agent can't escalate privileges.** It runs as a non-root user. It can't modify network config, DNS, or firewall rules.

### Credential Handling

Credentials use a placeholder replacement model. The orchestrator writes a config file into the sandbox with synthetic placeholder values. The agent uses these placeholders in requests however the target API requires (headers, query params, body — anywhere). The proxy does a find-and-replace, swapping every occurrence of the placeholder with the real credential before forwarding.

Placeholders use a unique synthetic format to avoid accidental collisions: `__QS_CRED_<NAME>_<HASH>__`

Multiple credentials per service are supported via multiple placeholder/secretRef pairs.

Known limitation: services requiring HMAC signing (e.g. AWS Signature V4) need the raw secret for computation. These should be wrapped in an MCP server instead.

### Observability

The proxy is the single observation point. Every external interaction flows through it, providing:

- Structured action log — every request, tool call, approval, denial
- Cost tracking per task
- Real-time agent stdout/stderr streaming
- Full audit trail including escalation history

Logging configuration (detail level, output streaming) is set at the org level, not per task.

### Snapshots

Point-in-time captures of sandbox filesystems. Used for:

- **Environment templates** — pre-baked environments with tools, runtimes, and packages installed. Restored in seconds instead of building from scratch.
- **Repo snapshots** — kept warm by GitHub webhooks or cron. Repo checked out, deps installed, ready to go.
- **Agent handover** — one agent's output snapshot becomes the next agent's input.
- **Checkpoint before escalation** — sandbox is snapshotted before pausing for human approval, enabling clean resume.
- **Audit trail** — snapshot after task completion for post-mortem inspection.

Locally, snapshots are Docker commits or filesystem copies. On Cloudflare, snapshots use R2 with squashfs compression and copy-on-write FUSE restore (~24 MB/s upload, ~93 MB/s download).

### Escalation Flow

When an agent needs a capability not in its manifest:

1. Agent calls the `request_capability` MCP tool (exposed by the proxy) with a natural language reason
1. Proxy checks org policy `autoApprove` list → if matched, grant is appended instantly using the pre-configured grant template
1. Proxy checks org policy `forbidden` list → if matched, denied instantly
1. Falls through to the manifest's `escalation.defaultAction`:
- `"deny"` → rejected, agent must work without it
- `"request_human"` → sandbox is snapshotted (if `snapshotOnPause` is true), agent is paused, request routes to approval UI
1. Human reviews: sees the agent's reason, current manifest, action log, and proposed grant
1. Approve / deny / approve with expiry
1. If approved: grant appended to `ManifestState.grants`, proxy updated, sandbox resumed
1. If denied or timeout: agent resumed with denial reason

The agent describes what it needs in natural language. The orchestrator resolves the request against the capability registry and proposes a concrete grant. The human reviews the resolved grant, not the raw request.

### Multi-Agent Plans

Complex tasks are decomposed into sequential steps by the orchestrator agent. Each step becomes a separate sandboxed agent run with its own manifest.

The orchestrator agent runs in its own sandbox with minimal capabilities (LLM access and read-only registry access). It produces a Plan — a list of steps with profiles, prompts, and proposed capabilities. The executor validates the plan against org policy, routes for approval, then runs each step deterministically.

Artefacts flow between steps via snapshots. Each step's output snapshot is restored as the next step's input. Capabilities don't carry over — each step gets a fresh manifest. The test agent can read the code the code agent wrote, but can't access Datadog just because the code agent could.

Steps are linear for now (each step depends on at most one predecessor). Parallel execution may be added later.

-----

## Type System

### Manifest

```typescript
/**
 * Complete capability specification for a single agent task
 * execution. Immutable after creation — escalations are
 * tracked separately as Grants.
 *
 * Pure allowlist. If it's not here, it's denied.
 */
interface Manifest {
  id: string;
  createdAt: string;
  createdBy: string;
  capabilities: CapabilitySet;
  limits: ResourceLimits;
  escalation: EscalationPolicy;
  environment: EnvironmentConfig;
}
```

### Capabilities

```typescript
/**
 * All external access the agent has.
 * Anything not listed is unreachable.
 */
interface CapabilitySet {
  network: (NetworkGrant | MCPNetworkGrant)[];
}

/**
 * An HTTP endpoint reachable through the proxy.
 * Covers REST APIs, git hosts, package registries —
 * anything over HTTP.
 */
interface NetworkGrant {
  /** Human-readable name, e.g. "github", "pypi", "datadog" */
  name: string;

  /** The real host the proxy forwards to */
  baseURL: string;

  /** Allowed URL paths. Wildcards supported. Empty = all. */
  allowedPaths: string[];

  /** Allowed HTTP methods. Empty = all. */
  allowedMethods: string[];

  /** Optional rate limit */
  rateLimit?: RateLimit;

  /**
   * Credential replacement pairs. The proxy replaces every
   * occurrence of each placeholder with the real credential
   * in the outbound request.
   */
  auth?: CredentialPair[];
}

/**
 * An MCP server reachable through the proxy. Extends
 * NetworkGrant with tool-level filtering. The proxy acts
 * as a native MCP bridge — connecting to the real server
 * upstream, filtering tools/list, and validating tools/call.
 *
 * The agent connects to these as standard MCP servers via
 * separate proxy endpoints (e.g. http://proxy:8080/mcp/github).
 */
interface MCPNetworkGrant extends NetworkGrant {
  /**
   * Tools the agent can use on this MCP server.
   * Empty array means all tools available.
   */
  allowedTools: string[];
}

interface CredentialPair {
  /** Synthetic placeholder, e.g. "__QS_CRED_DATADOG_API_KEY_a8f3__" */
  placeholder: string;

  /** Key into the proxy's secret store */
  secretRef: string;
}

interface RateLimit {
  requests: number;
  windowSeconds: number;
}
```

### Resource Limits

```typescript
/**
 * Cost and time budgets. Warning thresholds signal the agent
 * to wrap up. Limits are hard ceilings — the proxy stops
 * everything.
 */
interface ResourceLimits {
  warning: ResourceThresholds;
  limit: ResourceThresholds;
}

interface ResourceThresholds {
  /** Wall clock time in seconds */
  runtimeSeconds: number;

  /** Total spend in USD */
  costUSD: number;
}
```

### Escalation Policy

```typescript
/**
 * Controls what happens when the agent requests a capability
 * not in its manifest. The proxy checks org policy first
 * (autoApprove / forbidden), then falls back to this.
 */
interface EscalationPolicy {
  /**
   * What to do when org policy doesn't have an opinion.
   * "request_human" — pause, snapshot, route to approval UI
   * "deny" — reject immediately
   */
  defaultAction: "request_human" | "deny";

  /** Max seconds to wait for human approval before denying */
  approvalTimeoutSeconds: number;

  /** Snapshot the sandbox before pausing for approval */
  snapshotOnPause: boolean;
}
```

### Environment Config

```typescript
/**
 * Sandbox setup before the agent starts.
 */
interface EnvironmentConfig {
  /**
   * Snapshots restored in order. Typically base environment
   * first, then repo snapshots, then context. Last write
   * wins on filesystem conflicts.
   */
  snapshots: string[];

  /** Files written after snapshots are applied */
  files: Record<string, string>;

  agent: AgentConfig;
}

interface AgentConfig {
  /** References an AgentProfile in org policy */
  profile: string;

  /** Task-specific prompt for this invocation */
  prompt: string;
}
```

### Manifest State

```typescript
/**
 * The live state of a task. The manifest is the plan (immutable).
 * Grants are the reality (append-only).
 */
interface ManifestState {
  manifest: Manifest;
  grants: Grant[];
}

/**
 * Computes the effective capabilities by merging the
 * original manifest with all active grants.
 */
function effectiveCapabilities(state: ManifestState): CapabilitySet {
  const caps = clone(state.manifest.capabilities);
  for (const grant of state.grants) {
    if (grant.expiresAt && new Date() > new Date(grant.expiresAt)) {
      continue;
    }
    caps.network.push(grant.capability);
  }
  return caps;
}

interface Grant {
  id: string;
  requestedAt: string;
  approvedAt: string;

  /** "auto:org-policy" or "human:alec" */
  approvedBy: string;

  /** Agent's natural language reason for the request */
  reason: string;

  /** The actual capability granted */
  capability: NetworkGrant | MCPNetworkGrant;

  /** Optional expiry — grant auto-revokes after this time */
  expiresAt?: string;
}
```

### Plans

```typescript
/**
 * A plan is the orchestrator agent's output. Decomposes a
 * task into sequential steps, each becoming a separate
 * sandboxed agent run.
 */
interface Plan {
  id: string;
  createdAt: string;

  /** The original task that triggered this plan */
  task: string;

  /** Ordered steps, each becomes a sandbox with its own manifest */
  steps: PlanStep[];
}

interface PlanStep {
  /** Unique name within this plan, e.g. "investigate", "fix", "test" */
  name: string;

  /**
   * Step that must complete before this one runs.
   * Its snapshot becomes this step's input.
   * Empty string means this is the first step.
   */
  dependsOn: string;

  /** References an AgentProfile in org policy */
  profile: string;

  /** Task-specific prompt for this step */
  prompt: string;

  /** Capabilities this step needs */
  capabilities: (NetworkGrant | MCPNetworkGrant)[];
}

/**
 * Tracks execution of a plan.
 */
interface PlanState {
  plan: Plan;
  steps: StepState[];
}

interface StepState {
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  manifestId?: string;
  snapshotRef?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
```

### Org Policy

```typescript
/**
 * Organisation-level policy. Managed in the UI.
 * Applies across all tasks and agents.
 */
interface OrgPolicy {
  /**
   * Pre-configured grants approved instantly on escalation.
   * Full grant templates with all constraints baked in.
   */
  autoApprove: (NetworkGrant | MCPNetworkGrant)[];

  /**
   * Names that are always denied. Matched against the name
   * field of any requested grant.
   */
  forbidden: string[];

  /** Maximum any single task can be set to */
  maxTaskLimits: ResourceThresholds;

  /** Ceiling across all running tasks combined */
  globalLimits: GlobalThresholds;

  /** Logging configuration for all tasks */
  logging: LoggingConfig;

  /** Reusable agent configurations */
  agentProfiles: AgentProfile[];
}

interface GlobalThresholds {
  maxConcurrentTasks: number;

  /** Total spend across all tasks per billing period */
  costUSD: number;
}

interface LoggingConfig {
  /**
   * "full" — log request and response bodies
   * "standard" — log request metadata, no bodies
   * "minimal" — log tool names and status codes only
   */
  detail: "full" | "standard" | "minimal";

  /** Stream agent stdout/stderr to orchestrator in real-time */
  streamAgentOutput: boolean;
}

interface AgentProfile {
  /** e.g. "claude-code-sonnet", "custom-debug-agent" */
  name: string;

  /** e.g. "claude-code", "custom" */
  runtime: string;

  /** e.g. "claude-sonnet-4-6" */
  model: string;

  /** Base instructions prepended to every task using this profile */
  systemPrompt: string;
}
```

-----

## Local Development

### Docker Networking

The sandbox runs on an internal Docker network with the proxy as the default gateway. The sandbox has no route to the internet.

```yaml
services:
  proxy:
    build: ./cmd/proxy
    networks:
      sandbox-net:
        ipv4_address: 172.20.0.2
      external:

  sandbox:
    build: ./configs/sandbox
    networks:
      sandbox-net:
        ipv4_address: 172.20.0.3

networks:
  sandbox-net:
    internal: true
    ipam:
      config:
        - subnet: 172.20.0.0/24
          gateway: 172.20.0.2
```

### Project Structure

```
/packages
  /manifest       → types, validation, effectiveCapabilities()
  /proxy          → Hono server, MCP bridge, enforcement,
                    action log, cost tracker
  /orchestrator   → planner, escalation, snapshot management
  /sandbox        → sandbox interface + Docker adapter

/apps
  /approval-ui    → web app for reviewing escalations

/platform
  /docker         → Docker sandbox + network impl
  /cloudflare     → Worker + CF Sandbox adapter (later)

/test
  /adversarial    → escape attempt tests
  /integration    → end-to-end runs

/configs
  /manifests      → test manifest JSON files
  /sandbox        → Dockerfile for agent container
```

Monorepo with pnpm workspaces. TypeScript throughout. The `/packages` layer is platform-agnostic. `/platform` adapters plug in at runtime.

### Sandbox Dockerfile

```dockerfile
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    curl git nodejs npm python3 pip \
    build-essential jq

RUN npm install -g @anthropic-ai/claude-code

RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent
```

Fat base image with everything pre-installed, non-root user.

-----

## Cloudflare Deployment (Future)

The same abstractions deploy to Cloudflare Sandbox:

- **Proxy** → Cloudflare Worker with the same enforcement logic
- **Sandbox** → CF Sandbox container (VM-level isolation per sandbox)
- **Snapshots** → R2 storage with squashfs compression and copy-on-write FUSE restore
- **Manifest/Grant state** → Durable Objects or KV
- **Snapshot pipeline** → Workers triggered by GitHub webhooks

CF Sandbox provides stronger isolation guarantees (VM-level), native R2 integration for snapshots, and edge deployment. The core proxy enforcement logic is identical — same TypeScript, different transport layer.

-----

## Build Phases

### Phase 1 — Proof of enforcement model

- Docker sandbox with no outbound network
- Proxy as a Hono server that loads a hardcoded manifest
- One real MCP server behind the proxy (mcp-github)
- Claude Code running in the sandbox, pointing at the proxy
- Adversarial test suite proving the agent can't escape
- Action logging at the proxy

### Phase 2 — Dynamic manifests and escalation

- Orchestrator agent generates manifests from task descriptions
- Capability registry (JSON file to start)
- Escalation flow with auto-approve from org policy
- Cost tracking at the proxy
- Approval UI (web app)

### Phase 3 — Multi-agent plans

- Plan type and executor
- Orchestrator agent running in its own sandbox
- Snapshot-based handover between steps
- Plan approval UI
- Replanning on step failure

### Phase 4 — Operational polish

- Snapshot pipeline (GitHub webhooks, cron)
- Multiple agent profiles
- Org policy management UI
- Cloudflare Sandbox deployment adapter

-----

## Example Manifest

```json
{
  "id": "task-2847",
  "createdAt": "2026-03-25T14:00:00Z",
  "createdBy": "planner",
  "capabilities": {
    "network": [
      {
        "name": "github-mcp",
        "baseURL": "http://mcp-github:3000",
        "allowedPaths": [],
        "allowedMethods": ["POST"],
        "allowedTools": ["get_file", "search_code", "list_commits"],
        "auth": [
          {
            "placeholder": "__QS_CRED_GITHUB_TOKEN_f29a__",
            "secretRef": "GITHUB_TOKEN"
          }
        ]
      },
      {
        "name": "datadog",
        "baseURL": "https://api.datadoghq.com",
        "allowedPaths": ["/api/v1/logs/*", "/api/v1/query"],
        "allowedMethods": ["GET", "POST"],
        "auth": [
          {
            "placeholder": "__QS_CRED_DD_API_KEY_c83b__",
            "secretRef": "DATADOG_API_KEY"
          },
          {
            "placeholder": "__QS_CRED_DD_APP_KEY_d12e__",
            "secretRef": "DATADOG_APP_KEY"
          }
        ]
      },
      {
        "name": "pypi",
        "baseURL": "https://pypi.org",
        "allowedPaths": [],
        "allowedMethods": ["GET"]
      }
    ]
  },
  "limits": {
    "warning": {
      "runtimeSeconds": 300,
      "costUSD": 3.0
    },
    "limit": {
      "runtimeSeconds": 600,
      "costUSD": 5.0
    }
  },
  "escalation": {
    "defaultAction": "request_human",
    "approvalTimeoutSeconds": 300,
    "snapshotOnPause": true
  },
  "environment": {
    "snapshots": ["base-dev-v4", "payments@main-abc123"],
    "files": {
      "/workspace/task.md": "Investigate latency spike on payments service at 14:32 today."
    },
    "agent": {
      "profile": "claude-code-sonnet",
      "prompt": "Investigate why p99 latency spiked on the payments service. Check logs, recent commits, and correlate with deployment timeline."
    }
  }
}
```
