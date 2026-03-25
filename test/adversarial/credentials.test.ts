import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import {
  replaceCredentials,
  replaceCredentialsInHeaders,
  replaceCredentialsInURL,
} from "@quicksand/proxy/credentials";
import type { CredentialPair } from "@quicksand/manifest";

describe("replaceCredentials", () => {
  const savedEnv: Record<string, string | undefined> = {};

  function setEnv(key: string, value: string): void {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("replaces single placeholder", () => {
    setEnv("TEST_API_KEY", "real-secret-123");

    const auth: CredentialPair[] = [
      { placeholder: "__QS_CRED_API_KEY_abc1__", secretRef: "TEST_API_KEY" },
    ];

    const result = replaceCredentials(
      "Bearer __QS_CRED_API_KEY_abc1__",
      auth,
    );
    assert.strictEqual(result, "Bearer real-secret-123");
  });

  it("replaces multiple placeholders", () => {
    setEnv("DD_API_KEY", "dd-key-abc");
    setEnv("DD_APP_KEY", "dd-app-xyz");

    const auth: CredentialPair[] = [
      { placeholder: "__QS_CRED_DD_API_KEY_c83b__", secretRef: "DD_API_KEY" },
      { placeholder: "__QS_CRED_DD_APP_KEY_d12e__", secretRef: "DD_APP_KEY" },
    ];

    const result = replaceCredentials(
      "api_key=__QS_CRED_DD_API_KEY_c83b__&app_key=__QS_CRED_DD_APP_KEY_d12e__",
      auth,
    );
    assert.strictEqual(result, "api_key=dd-key-abc&app_key=dd-app-xyz");
  });

  it("handles missing env vars gracefully", () => {
    // Ensure the env var does not exist
    delete process.env["NONEXISTENT_SECRET"];

    const auth: CredentialPair[] = [
      {
        placeholder: "__QS_CRED_MISSING_a000__",
        secretRef: "NONEXISTENT_SECRET",
      },
    ];

    const result = replaceCredentials(
      "key=__QS_CRED_MISSING_a000__",
      auth,
    );
    // Placeholder should remain since the env var is missing
    assert.strictEqual(result, "key=__QS_CRED_MISSING_a000__");
  });

  it("replaces in headers", () => {
    setEnv("GH_TOKEN", "ghp_realtoken123");

    const auth: CredentialPair[] = [
      { placeholder: "__QS_CRED_GH_TOKEN_f29a__", secretRef: "GH_TOKEN" },
    ];

    const headers: Record<string, string> = {
      Authorization: "token __QS_CRED_GH_TOKEN_f29a__",
      "Content-Type": "application/json",
    };

    const result = replaceCredentialsInHeaders(headers, auth);
    assert.strictEqual(result["Authorization"], "token ghp_realtoken123");
    assert.strictEqual(result["Content-Type"], "application/json");
  });

  it("replaces in URLs", () => {
    setEnv("API_TOKEN", "tok_secret");

    const auth: CredentialPair[] = [
      { placeholder: "__QS_CRED_TOKEN_b2c3__", secretRef: "API_TOKEN" },
    ];

    const result = replaceCredentialsInURL(
      "https://api.example.com/v1?token=__QS_CRED_TOKEN_b2c3__",
      auth,
    );
    assert.strictEqual(
      result,
      "https://api.example.com/v1?token=tok_secret",
    );
  });
});
