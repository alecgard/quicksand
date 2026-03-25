import { describe, it } from "node:test";
import assert from "node:assert";
import { resolveAgentCommand } from "@quicksand/sandbox/agent-command";

describe("resolveAgentCommand", () => {
  const gateway = "172.17.0.1";
  const port = 8080;

  it("claude-code profile returns claude command", () => {
    const cmd = resolveAgentCommand("claude-code", "do stuff", gateway, port);
    assert.strictEqual(cmd[0], "claude");
    assert.ok(cmd.includes("--dangerously-skip-permissions"));
    assert.ok(cmd.includes("-p"));
    assert.ok(cmd.includes("do stuff"));
  });

  it("claude-code-sonnet profile returns claude command", () => {
    const cmd = resolveAgentCommand(
      "claude-code-sonnet",
      "build app",
      gateway,
      port,
    );
    assert.strictEqual(cmd[0], "claude");
    assert.ok(cmd.includes("--dangerously-skip-permissions"));
    assert.ok(cmd.includes("build app"));
  });

  it("ollama-default profile returns ollama with default model", () => {
    const cmd = resolveAgentCommand(
      "ollama-default",
      "write code",
      gateway,
      port,
    );
    assert.strictEqual(cmd[0], "bash");
    assert.strictEqual(cmd[1], "-c");
    // Should use default model qwen2.5-coder:14b
    assert.ok(cmd[2].includes("qwen2.5-coder:14b"));
    assert.ok(cmd[2].includes(`http://${gateway}:${port}`));
    assert.ok(cmd[2].includes("write code"));
  });

  it("ollama-codellama profile returns ollama with codellama model", () => {
    const cmd = resolveAgentCommand(
      "ollama-codellama",
      "review this",
      gateway,
      port,
    );
    assert.strictEqual(cmd[0], "bash");
    assert.ok(cmd[2].includes("codellama"));
    assert.ok(!cmd[2].includes("qwen2.5-coder:14b"));
  });

  it("unknown profile defaults to ollama with default model", () => {
    const cmd = resolveAgentCommand(
      "some-unknown-profile",
      "hello",
      gateway,
      port,
    );
    assert.strictEqual(cmd[0], "bash");
    assert.ok(cmd[2].includes("qwen2.5-coder:14b"));
  });
});
