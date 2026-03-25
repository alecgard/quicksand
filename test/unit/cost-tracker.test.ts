import { describe, it } from "node:test";
import assert from "node:assert";
import { CostTracker } from "@quicksand/proxy/cost-tracker";

describe("CostTracker", () => {
  it("recordRequest increments count and cost", () => {
    const tracker = new CostTracker();
    tracker.recordRequest("task-1");
    tracker.recordRequest("task-1");
    tracker.recordRequest("task-1");
    const entry = tracker.get("task-1");
    assert.ok(entry);
    assert.strictEqual(entry!.requestCount, 3);
    assert.strictEqual(entry!.totalUSD, 0.003);
    assert.strictEqual(entry!.llmCostUSD, 0);
  });

  it("reportLLMCost adds to total", () => {
    const tracker = new CostTracker();
    tracker.reportLLMCost("task-2", 0.5);
    tracker.reportLLMCost("task-2", 0.25);
    const entry = tracker.get("task-2");
    assert.ok(entry);
    assert.strictEqual(entry!.llmCostUSD, 0.75);
    assert.strictEqual(entry!.totalUSD, 0.75);
    assert.strictEqual(entry!.requestCount, 0);
  });

  it("get returns undefined for unknown task", () => {
    const tracker = new CostTracker();
    assert.strictEqual(tracker.get("nonexistent"), undefined);
  });

  it("getAll returns all entries", () => {
    const tracker = new CostTracker();
    tracker.recordRequest("task-a");
    tracker.recordRequest("task-b");
    tracker.reportLLMCost("task-c", 1.0);
    const all = tracker.getAll();
    assert.strictEqual(all.length, 3);
    const ids = all.map((e) => e.taskId).sort();
    assert.deepStrictEqual(ids, ["task-a", "task-b", "task-c"]);
  });
});
