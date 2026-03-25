import type { z } from "zod";
import type {
  RateLimitSchema,
  CredentialPairSchema,
  NetworkGrantSchema,
  MCPNetworkGrantSchema,
  AnyGrantSchema,
  CapabilitySetSchema,
  ResourceThresholdsSchema,
  ResourceLimitsSchema,
  EscalationPolicySchema,
  AgentConfigSchema,
  EnvironmentConfigSchema,
  ManifestSchema,
  GrantSchema,
  ManifestStateSchema,
  PlanStepSchema,
  PlanSchema,
  StepStateSchema,
  PlanStateSchema,
  GlobalThresholdsSchema,
  LoggingConfigSchema,
  AgentProfileSchema,
  OrgPolicySchema,
  ActionLogEntrySchema,
  EscalationRequestSchema,
  EscalationResponseSchema,
} from "./schemas.js";

export type RateLimit = z.infer<typeof RateLimitSchema>;
export type CredentialPair = z.infer<typeof CredentialPairSchema>;
export type NetworkGrant = z.infer<typeof NetworkGrantSchema>;
export type MCPNetworkGrant = z.infer<typeof MCPNetworkGrantSchema>;
export type AnyGrant = z.infer<typeof AnyGrantSchema>;
export type CapabilitySet = z.infer<typeof CapabilitySetSchema>;
export type ResourceThresholds = z.infer<typeof ResourceThresholdsSchema>;
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;
export type EscalationPolicy = z.infer<typeof EscalationPolicySchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;
export type Manifest = z.infer<typeof ManifestSchema>;
export type Grant = z.infer<typeof GrantSchema>;
export type ManifestState = z.infer<typeof ManifestStateSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type StepState = z.infer<typeof StepStateSchema>;
export type PlanState = z.infer<typeof PlanStateSchema>;
export type GlobalThresholds = z.infer<typeof GlobalThresholdsSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type OrgPolicy = z.infer<typeof OrgPolicySchema>;
export type ActionLogEntry = z.infer<typeof ActionLogEntrySchema>;
export type EscalationRequest = z.infer<typeof EscalationRequestSchema>;
export type EscalationResponse = z.infer<typeof EscalationResponseSchema>;
