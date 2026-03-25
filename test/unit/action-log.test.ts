import { describe, it } from "node:test";
import assert from "node:assert";
import { ActionLog } from "@quicksand/proxy/action-log";

describe("ActionLog", () => {
  it("add creates entry with UUID and timestamp", () => {
    const log = new ActionLog();
    const entry = log.add("task-1", "http_request", { url: "/foo" });
    assert.ok(entry.id);
    assert.ok(entry.timestamp);
    assert.strictEqual(entry.taskId, "task-1");
    assert.strictEqual(entry.type, "http_request");
    assert.deepStrictEqual(entry.details, { url: "/foo" });
  });

  it("getAll returns entries in order", () => {
    const log = new ActionLog();
    log.add("t1", "http_request", { n: 1 });
    log.add("t1", "escalation_request", { n: 2 });
    log.add("t1", "denied", { n: 3 });
    const all = log.getAll();
    assert.strictEqual(all.length, 3);
    assert.deepStrictEqual(all[0].details, { n: 1 });
    assert.deepStrictEqual(all[1].details, { n: 2 });
    assert.deepStrictEqual(all[2].details, { n: 3 });
  });

  it("clear empties the log", () => {
    const log = new ActionLog();
    log.add("t1", "http_request", {});
    log.add("t1", "denied", {});
    assert.strictEqual(log.getAll().length, 2);
    log.clear();
    assert.strictEqual(log.getAll().length, 0);
  });
});
