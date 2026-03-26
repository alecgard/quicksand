import type {
  AnyGrant,
  Grant,
  OrgPolicy,
  EscalationPolicy,
} from "@quicksand/manifest";
import type { PendingEscalation } from "./types.js";
import type { ManifestManager } from "./manifest-manager.js";
import type { ActionLog } from "./action-log.js";

/**
 * Manages escalation requests: checking org policy, storing
 * pending escalations, and resolving them.
 */
export class EscalationManager {
  private escalations = new Map<string, PendingEscalation>();

  constructor(
    private manifestManager: ManifestManager,
    private actionLog: ActionLog,
  ) {}

  /**
   * Process an escalation request. Checks org policy first,
   * then falls back to manifest escalation policy.
   *
   * Returns the escalation (which may already be resolved
   * if auto-approved or forbidden).
   */
  requestEscalation(
    manifestId: string,
    reason: string,
    capability: AnyGrant,
  ): PendingEscalation {
    const state = this.manifestManager.getOrThrow(manifestId);
    const manifest = state.manifest;
    const orgPolicy = this.manifestManager.getOrgPolicy();
    const taskId = manifest.id;

    const escalation: PendingEscalation = {
      id: crypto.randomUUID(),
      taskId,
      manifestId: manifest.id,
      reason,
      requestedAt: new Date().toISOString(),
      status: "pending",
      capability,
    };

    this.actionLog.add(taskId, "escalation_request", {
      escalationId: escalation.id,
      reason,
      capabilityName: capability.name,
    });

    // Check org policy autoApprove
    if (orgPolicy) {
      const autoApproved = orgPolicy.autoApprove.find(
        (g) => g.name === capability.name,
      );
      if (autoApproved) {
        escalation.status = "approved";
        const grant: Grant = {
          id: crypto.randomUUID(),
          requestedAt: escalation.requestedAt,
          approvedAt: new Date().toISOString(),
          approvedBy: "auto:org-policy",
          reason,
          capability: autoApproved,
        };
        this.manifestManager.addGrant(manifestId, grant);
        this.actionLog.add(taskId, "escalation_result", {
          escalationId: escalation.id,
          result: "approved",
          approvedBy: "auto:org-policy",
        });
        this.actionLog.add(taskId, "grant_added", {
          grantId: grant.id,
          capabilityName: autoApproved.name,
        });
        this.escalations.set(escalation.id, escalation);
        return escalation;
      }

      // Check org policy forbidden
      if (orgPolicy.forbidden.includes(capability.name)) {
        escalation.status = "denied";
        this.actionLog.add(taskId, "escalation_result", {
          escalationId: escalation.id,
          result: "denied",
          reason: "Forbidden by org policy",
        });
        this.escalations.set(escalation.id, escalation);
        return escalation;
      }
    }

    // Fall back to manifest escalation policy
    const policy: EscalationPolicy = manifest.escalation;
    if (policy.defaultAction === "deny") {
      escalation.status = "denied";
      this.actionLog.add(taskId, "escalation_result", {
        escalationId: escalation.id,
        result: "denied",
        reason: "Manifest escalation policy: deny",
      });
    }
    // else status stays "pending" for human review

    this.escalations.set(escalation.id, escalation);
    return escalation;
  }

  /**
   * Resolve a pending escalation (approve or deny).
   */
  resolve(
    escalationId: string,
    action: "approve" | "deny",
    approvedBy: string,
    expiresAt?: string,
  ): PendingEscalation | null {
    const escalation = this.escalations.get(escalationId);
    if (!escalation || escalation.status !== "pending") {
      return null;
    }

    const taskId = escalation.taskId;

    if (action === "approve") {
      escalation.status = "approved";
      const grant: Grant = {
        id: crypto.randomUUID(),
        requestedAt: escalation.requestedAt,
        approvedAt: new Date().toISOString(),
        approvedBy: `human:${approvedBy}`,
        reason: escalation.reason,
        capability: escalation.capability,
        expiresAt,
      };
      this.manifestManager.addGrant(escalation.manifestId, grant);
      this.actionLog.add(taskId, "escalation_result", {
        escalationId,
        result: "approved",
        approvedBy: `human:${approvedBy}`,
      });
      this.actionLog.add(taskId, "grant_added", {
        grantId: grant.id,
        capabilityName: escalation.capability.name,
      });
    } else {
      escalation.status = "denied";
      this.actionLog.add(taskId, "escalation_result", {
        escalationId,
        result: "denied",
        approvedBy: `human:${approvedBy}`,
      });
    }

    return escalation;
  }

  /** Get all escalations. */
  getAll(): PendingEscalation[] {
    return Array.from(this.escalations.values());
  }

  /** Get pending escalations only. */
  getPending(): PendingEscalation[] {
    return this.getAll().filter((e) => e.status === "pending");
  }

  /** Get a single escalation by ID. */
  get(id: string): PendingEscalation | undefined {
    return this.escalations.get(id);
  }
}
