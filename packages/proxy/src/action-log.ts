import type { ActionLogEntry } from "@quicksand/manifest";

/**
 * In-memory action log. Every proxied request, tool call,
 * escalation, and denial is recorded here.
 */
export class ActionLog {
  private entries: ActionLogEntry[] = [];

  add(
    taskId: string,
    type: ActionLogEntry["type"],
    details: Record<string, unknown>,
  ): ActionLogEntry {
    const entry: ActionLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      taskId,
      type,
      details,
    };
    this.entries.push(entry);
    return entry;
  }

  getAll(): ActionLogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }
}
