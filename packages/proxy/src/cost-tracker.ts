import type { CostEntry } from "./types.js";

/**
 * In-memory cost tracking per task.
 * Tracks request-based estimated costs and LLM costs reported externally.
 */
export class CostTracker {
  private costs = new Map<string, CostEntry>();

  /** Default estimated cost per proxied API request. */
  private static readonly COST_PER_REQUEST_USD = 0.001;

  private getOrCreate(taskId: string): CostEntry {
    let entry = this.costs.get(taskId);
    if (!entry) {
      entry = { taskId, totalUSD: 0, requestCount: 0, llmCostUSD: 0 };
      this.costs.set(taskId, entry);
    }
    return entry;
  }

  /** Record a proxied API request. */
  recordRequest(taskId: string): void {
    const entry = this.getOrCreate(taskId);
    entry.requestCount++;
    entry.totalUSD += CostTracker.COST_PER_REQUEST_USD;
  }

  /** Accept an externally reported LLM cost. */
  reportLLMCost(taskId: string, costUSD: number): void {
    const entry = this.getOrCreate(taskId);
    entry.llmCostUSD += costUSD;
    entry.totalUSD += costUSD;
  }

  /** Get cost entry for a task. */
  get(taskId: string): CostEntry | undefined {
    return this.costs.get(taskId);
  }

  /** Get all cost entries. */
  getAll(): CostEntry[] {
    return Array.from(this.costs.values());
  }
}
