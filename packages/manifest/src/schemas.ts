import { z } from "zod";

// --- Primitives ---

export const RateLimitSchema = z.object({
  requests: z.number(),
  windowSeconds: z.number(),
});

export const CredentialPairSchema = z.object({
  placeholder: z.string(),
  secretRef: z.string(),
});

// --- Grants ---

export const NetworkGrantSchema = z.object({
  name: z.string(),
  baseURL: z.string(),
  allowedPaths: z.array(z.string()),
  allowedMethods: z.array(z.string()),
  rateLimit: RateLimitSchema.optional(),
  auth: z.array(CredentialPairSchema).optional(),
});

export const MCPNetworkGrantSchema = NetworkGrantSchema.extend({
  allowedTools: z.array(z.string()),
});

/** MCPNetworkGrant first so it matches when allowedTools is present */
export const AnyGrantSchema = z.union([
  MCPNetworkGrantSchema,
  NetworkGrantSchema,
]);

// --- Capability Set ---

export const CapabilitySetSchema = z.object({
  network: z.array(AnyGrantSchema),
});

// --- Resource Limits ---

export const ResourceThresholdsSchema = z.object({
  runtimeSeconds: z.number(),
  costUSD: z.number(),
});

export const ResourceLimitsSchema = z.object({
  warning: ResourceThresholdsSchema,
  limit: ResourceThresholdsSchema,
});

// --- Escalation ---

export const EscalationPolicySchema = z.object({
  defaultAction: z.enum(["request_human", "deny"]),
  approvalTimeoutSeconds: z.number(),
  snapshotOnPause: z.boolean(),
});

// --- Environment ---

export const AgentConfigSchema = z.object({
  profile: z.string(),
  prompt: z.string(),
});

export const EnvironmentConfigSchema = z.object({
  snapshots: z.array(z.string()),
  files: z.record(z.string(), z.string()),
  agent: AgentConfigSchema,
});

// --- Manifest ---

export const ManifestSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  capabilities: CapabilitySetSchema,
  limits: ResourceLimitsSchema,
  escalation: EscalationPolicySchema,
  environment: EnvironmentConfigSchema,
});

// --- Grant (runtime escalation) ---

export const GrantSchema = z.object({
  id: z.string(),
  requestedAt: z.string(),
  approvedAt: z.string(),
  approvedBy: z.string(),
  reason: z.string(),
  capability: AnyGrantSchema,
  expiresAt: z.string().optional(),
});

// --- Manifest State ---

export const ManifestStateSchema = z.object({
  manifest: ManifestSchema,
  grants: z.array(GrantSchema),
  // Execution lifecycle
  status: z.enum(["pending", "running", "completed", "failed"]).default("pending"),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
  exitCode: z.number().optional(),
  snapshots: z.array(z.object({
    id: z.string(),
    tag: z.string(),
    createdAt: z.string(),
    reason: z.string(),
  })).default([]),
});

// --- Plans ---

export const PlanStepSchema = z.object({
  name: z.string(),
  dependsOn: z.string(),
  profile: z.string(),
  prompt: z.string(),
  capabilities: z.array(AnyGrantSchema),
});

export const PlanSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  task: z.string(),
  steps: z.array(PlanStepSchema),
});

export const StepStateSchema = z.object({
  name: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  manifestId: z.string().optional(),
  snapshotRef: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});

export const PlanStateSchema = z.object({
  plan: PlanSchema,
  steps: z.array(StepStateSchema),
});

// --- Org Policy ---

export const GlobalThresholdsSchema = z.object({
  maxConcurrentTasks: z.number(),
  costUSD: z.number(),
});

export const LoggingConfigSchema = z.object({
  detail: z.enum(["full", "standard", "minimal"]),
  streamAgentOutput: z.boolean(),
});

export const AgentProfileSchema = z.object({
  name: z.string(),
  runtime: z.string(),
  model: z.string(),
  systemPrompt: z.string(),
});

export const OrgPolicySchema = z.object({
  autoApprove: z.array(AnyGrantSchema),
  forbidden: z.array(z.string()),
  maxTaskLimits: ResourceThresholdsSchema,
  globalLimits: GlobalThresholdsSchema,
  logging: LoggingConfigSchema,
  agentProfiles: z.array(AgentProfileSchema),
});

// --- Action Log ---

export const ActionLogEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  taskId: z.string(),
  type: z.enum([
    "http_request",
    "mcp_tool_call",
    "escalation_request",
    "escalation_result",
    "grant_added",
    "denied",
  ]),
  details: z.record(z.string(), z.unknown()),
});

// --- Escalation Request / Response ---

export const EscalationRequestSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  manifestId: z.string(),
  reason: z.string(),
  requestedAt: z.string(),
  status: z.enum(["pending", "approved", "denied", "timeout"]),
  capability: AnyGrantSchema,
});

export const EscalationResponseSchema = z.object({
  requestId: z.string(),
  action: z.enum(["approve", "deny"]),
  expiresAt: z.string().optional(),
  approvedBy: z.string(),
});
