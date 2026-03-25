import type { ManifestState, CapabilitySet } from "./types.js";

/**
 * Computes the effective capabilities by merging the
 * original manifest with all active (non-expired) grants.
 */
export function effectiveCapabilities(state: ManifestState): CapabilitySet {
  const caps: CapabilitySet = JSON.parse(
    JSON.stringify(state.manifest.capabilities)
  );

  for (const grant of state.grants) {
    if (grant.expiresAt && new Date() > new Date(grant.expiresAt)) {
      continue;
    }
    caps.network.push(grant.capability);
  }

  return caps;
}
