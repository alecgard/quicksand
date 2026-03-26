import { readFileSync } from "node:fs";
import {
  effectiveCapabilities,
  type ManifestState,
  type Manifest,
  type Grant,
  type OrgPolicy,
  type CapabilitySet,
  ManifestSchema,
  OrgPolicySchema,
} from "@quicksand/manifest";

export class ManifestManager {
  private manifests = new Map<string, ManifestState>();
  private orgPolicy: OrgPolicy | null = null;

  /** Register a manifest. Uses manifest.id as the key. */
  register(manifest: Manifest): ManifestState {
    const state: ManifestState = {
      manifest,
      grants: [],
      status: "pending",
      snapshots: [],
    };
    this.manifests.set(manifest.id, state);
    return state;
  }

  /** Get a manifest state by ID. */
  get(id: string): ManifestState | undefined {
    return this.manifests.get(id);
  }

  /** Get a manifest state by ID, throwing if not found. */
  getOrThrow(id: string): ManifestState {
    const state = this.manifests.get(id);
    if (!state) throw new Error(`Manifest not found: ${id}`);
    return state;
  }

  /** List all manifest states, optionally filtered by status. */
  list(filter?: { status?: string }): ManifestState[] {
    const all = Array.from(this.manifests.values());
    if (filter?.status) {
      return all.filter((s) => s.status === filter.status);
    }
    return all;
  }

  /** Update execution state fields. */
  update(
    id: string,
    updates: Partial<
      Pick<
        ManifestState,
        "status" | "startedAt" | "completedAt" | "error" | "exitCode"
      >
    >,
  ): ManifestState {
    const state = this.getOrThrow(id);
    Object.assign(state, updates);
    return state;
  }

  /** Append a grant to a manifest. */
  addGrant(id: string, grant: Grant): void {
    const state = this.getOrThrow(id);
    state.grants.push(grant);
  }

  /** Add a snapshot to a manifest. */
  addSnapshot(
    id: string,
    snapshot: { id: string; tag: string; createdAt: string; reason: string },
  ): void {
    const state = this.getOrThrow(id);
    state.snapshots.push(snapshot);
  }

  /** Get effective capabilities for a manifest (base + active grants). */
  getEffectiveCapabilities(id: string): CapabilitySet {
    const state = this.getOrThrow(id);
    return effectiveCapabilities(state);
  }

  /** Load org policy. */
  loadOrgPolicy(policy: OrgPolicy): void {
    this.orgPolicy = policy;
  }

  loadOrgPolicyFromFile(filePath: string): void {
    const raw = readFileSync(filePath, "utf-8");
    this.orgPolicy = OrgPolicySchema.parse(JSON.parse(raw));
  }

  getOrgPolicy(): OrgPolicy | null {
    return this.orgPolicy;
  }

  /** Get all snapshots across all manifests. */
  getAllSnapshots(): Array<{
    id: string;
    manifestId: string;
    tag: string;
    createdAt: string;
    reason: string;
  }> {
    const result: Array<{
      id: string;
      manifestId: string;
      tag: string;
      createdAt: string;
      reason: string;
    }> = [];
    for (const [manifestId, state] of this.manifests) {
      for (const snap of state.snapshots) {
        result.push({ ...snap, manifestId });
      }
    }
    return result;
  }
}
