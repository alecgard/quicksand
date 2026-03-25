/**
 * Resolves the agent command based on the profile name.
 * Supports claude-code and ollama runtimes. Defaults to ollama.
 */
export function resolveAgentCommand(
  profile: string,
  prompt: string,
  proxyGateway: string,
  proxyPort: number,
): string[] {
  // Claude Code profiles
  if (profile === "claude-code-sonnet" || profile.startsWith("claude-code")) {
    return ["claude", "--dangerously-skip-permissions", "-p", prompt];
  }

  // Ollama profiles (default)
  // Extracts model from profile name if formatted as "ollama-<model>",
  // otherwise uses the default model
  const ollamaModel = profile.startsWith("ollama-") && profile !== "ollama-default"
    ? profile.slice("ollama-".length)
    : "qwen2.5-coder:14b";

  const ollamaURL = `http://${proxyGateway}:${proxyPort}`;

  return [
    "bash", "-c",
    [
      `export OLLAMA_HOST="${ollamaURL}"`,
      `ollama run ${ollamaModel} "${prompt.replace(/"/g, '\\"')}"`,
    ].join(" && "),
  ];
}
