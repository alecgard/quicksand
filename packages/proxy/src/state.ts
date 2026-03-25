import { readFileSync } from "node:fs";
import {
  type Manifest,
  type ManifestState,
  type Grant,
  type CapabilitySet,
  type OrgPolicy,
  ManifestSchema,
  OrgPolicySchema,
  effectiveCapabilities,
} from "@quicksand/manifest";

/**
 * Manages the live ManifestState: the immutable manifest plus
 * append-only grants from escalation approvals.
 */
export class StateManager {
  private state: ManifestState | null = null;
  private orgPolicy: OrgPolicy | null = null;

  /** Load manifest from a Manifest object. */
  loadManifest(manifest: Manifest): void {
    this.state = { manifest, grants: [] };
  }

  /** Load manifest from a JSON file path. */
  loadManifestFromFile(filePath: string): void {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = ManifestSchema.parse(JSON.parse(raw));
    this.loadManifest(parsed);
  }

  /** Load org policy from an OrgPolicy object. */
  loadOrgPolicy(policy: OrgPolicy): void {
    this.orgPolicy = policy;
  }

  /** Load org policy from a JSON file path. */
  loadOrgPolicyFromFile(filePath: string): void {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = OrgPolicySchema.parse(JSON.parse(raw));
    this.orgPolicy = parsed;
  }

  /** Get the current ManifestState, or null if no manifest loaded. */
  getState(): ManifestState | null {
    return this.state;
  }

  /** Get the current org policy, or null if not loaded. */
  getOrgPolicy(): OrgPolicy | null {
    return this.orgPolicy;
  }

  /** Get the manifest, throwing if not loaded. */
  getManifest(): Manifest {
    if (!this.state) {
      throw new Error("No manifest loaded");
    }
    return this.state.manifest;
  }

  /** Compute effective capabilities (manifest + active grants). */
  getEffectiveCapabilities(): CapabilitySet {
    if (!this.state) {
      throw new Error("No manifest loaded");
    }
    return effectiveCapabilities(this.state);
  }

  /** Append a grant (from an approved escalation). */
  addGrant(grant: Grant): void {
    if (!this.state) {
      throw new Error("No manifest loaded");
    }
    this.state.grants.push(grant);
  }
}
