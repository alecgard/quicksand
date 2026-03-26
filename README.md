# Quicksand

Least-privilege scoped environments for AI agents.

Quicksand runs AI agents in sandboxed Docker containers with **zero direct internet access**. Every external interaction — MCP tool calls, API requests, git clones, package installs — routes through a proxy that enforces a capability manifest. Credentials never enter the sandbox.

## Architecture

```
┌─────────────────────────────────────────────┐
│ User                                        │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ Executor                                    │
│ (trusted, deterministic — not an agent)     │
│                                             │
│ Validates plans against OrgPolicy           │
│ Routes for human approval                   │
│ Spins up sandboxes per step                 │
│ Passes snapshots between steps              │
│ On failure → asks orchestrator to replan    │
└──────┬──────────────────────────┬───────────┘
       │                          │
       ▼                          ▼
┌─────────────────┐  ┌─────────────────┐
│ Sandbox         │  │ Sandbox ×N      │
│                 │  │ (one per step)  │
│ ┌─────────────┐ │  │ ┌─────────────┐ │
│ │Orchestrator │ │  │ │ Agent       │ │
│ │Agent        │ │  │ │             │ │
│ └─────────────┘ │  │ └─────────────┘ │
└────────┬────────┘  └────────┬────────┘
         │                    │
         └─────────┬──────────┘
                   │ all traffic
                   ▼
┌─────────────────────────────────────────────┐
│ Proxy (default gateway)                     │
│                                             │
│ Enforces Manifest                           │
│ Injects credentials (placeholder → secret)  │
│ MCP bridge (filters tools per grant)        │
│ HTTP allowlist enforcement                  │
│ Action logging + cost tracking              │
│ Escalation handling                         │
└──────────────────────┬──────────────────────┘
                       │ credential-injected
                       ▼
┌─────────────────────────────────────────────┐
│ External Services                           │
│ GitHub MCP · Datadog · PyPI · …             │
└─────────────────────────────────────────────┘

Every sandbox is the same implementation (Docker container,
no internet, non-root user). Only the Manifest differs:
orchestrator gets LLM + read-only registry, other agents
get task-specific grants.
```

## Key Interfaces

```
┌──────────────────┐
│ OrgPolicy        │
│                  │
│ autoApprove[]    │─── instant grant on escalation match
│ forbidden[]      │─── instant deny on escalation match
│ maxTaskLimits    │
│ globalLimits     │
│ agentProfiles    │
└────────┬─────────┘
         │ validates against
         ▼
┌──────────────────┐         ┌──────────────────┐
│ Executor         │────────▶│ Orchestrator     │
│                  │ replan  │ Agent (sandboxed) │
│ validates plans  │◀────────│                  │
│ routes approval  │         │ decomposes tasks  │
│ runs steps       │         │ proposes caps     │
└────────┬─────────┘         └────────┬─────────┘
         │ executes                   │ produces
         ▼                            ▼
┌──────────────────┐         ┌──────────────────┐
│ StepState        │         │ Plan             │
│                  │         │                  │
│ status           │         │ steps[]          │
│ manifestId       │         │   └ PlanStep     │
│ snapshotRef      │         │     profile      │
└────────┬─────────┘         │     prompt       │
         │ governed by       │     capabilities │
         ▼                   └─────────────────-┘
┌──────────────────┐
│ Manifest         │
│ (immutable)      │
│                  │
│ capabilities     │
│   network[]      │─── NetworkGrant
│                  │    MCPNetworkGrant
│ limits           │    CredentialPair
│ escalation       │
│ environment      │
└────────┬─────────┘
         │ tracked as
         ▼
┌──────────────────┐         ┌──────────────────┐
│ ManifestState    │◀────────│ Grant            │
│                  │ appends │                  │
│ manifest         │         │ capability       │
│ grants[]         │         │ approvedBy       │
│                  │         │ expiresAt?       │
│ effectiveCaps()  │         └──────────────────┘
│ merges manifest  │
│ + active grants  │
└──────────────────┘
```

## Security Model

- **Credentials never reach the sandbox.** The proxy holds all secrets and injects them via placeholder replacement (`__QS_CRED_<NAME>_<HASH>__`).
- **MCP tools are filtered.** The proxy connects to real MCP servers upstream and exposes only granted tools.
- **Network access is an allowlist.** Every reachable endpoint is explicitly listed in the manifest.
- **Agents can't escalate privileges.** Non-root user, no access to network config, DNS, or firewall rules.

## Escalation Flow

When an agent needs a capability not in its manifest:

1. Agent calls `request_capability` MCP tool with a natural language reason
2. Proxy checks OrgPolicy `autoApprove` list — if matched, grant is appended instantly
3. Proxy checks OrgPolicy `forbidden` list — if matched, denied instantly
4. Falls through to manifest's `escalation.defaultAction` (`deny` or `request_human`)
5. If `request_human`: sandbox is snapshotted, agent paused, request routes to approval UI
6. Human approves / denies / approves with expiry
7. Grant appended to ManifestState, proxy updated, sandbox resumed

## Project Structure

```
/packages
  /manifest       — types, validation, effectiveCapabilities()
  /proxy          — Hono server, MCP bridge, enforcement, action log, cost tracker
  /sandbox        — sandbox interface + Docker adapter

/apps
  /approval-ui    — web app for reviewing escalations

/platform
  /docker         — Docker sandbox + network impl
  /cloudflare     — Worker + CF Sandbox adapter (future)

/test
  /adversarial    — escape attempt tests
  /integration    — end-to-end runs

/configs
  /manifests      — test manifest JSON files
  /sandbox        — Dockerfile for agent container
```

Monorepo with pnpm workspaces. TypeScript throughout.

## Development

```bash
pnpm install
pnpm dev
```