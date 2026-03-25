import type { CredentialPair } from "@quicksand/manifest";

/**
 * Replaces placeholder strings with real secret values from environment
 * variables. Each secretRef maps directly to an env var of the same name.
 */
export function replaceCredentials(
  input: string,
  auth: CredentialPair[] | undefined,
): string {
  if (!auth || auth.length === 0) return input;

  let result = input;
  for (const { placeholder, secretRef } of auth) {
    const secret = process.env[secretRef];
    if (secret) {
      // Replace all occurrences of the placeholder
      result = result.split(placeholder).join(secret);
    }
  }
  return result;
}

/**
 * Replaces credential placeholders in request headers.
 * Returns a new Headers-compatible record.
 */
export function replaceCredentialsInHeaders(
  headers: Record<string, string>,
  auth: CredentialPair[] | undefined,
): Record<string, string> {
  if (!auth || auth.length === 0) return headers;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = replaceCredentials(value, auth);
  }
  return result;
}

/**
 * Replaces credential placeholders in a URL string.
 */
export function replaceCredentialsInURL(
  url: string,
  auth: CredentialPair[] | undefined,
): string {
  return replaceCredentials(url, auth);
}
