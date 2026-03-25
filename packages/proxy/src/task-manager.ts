import type { Manifest, ManifestState } from "@quicksand/manifest";

export interface SnapshotRecord {
  id: string;
  taskId: string;
  tag: string;
  createdAt: string;
  reason: string; // "completion" | "escalation_pause" | "manual"
}

export interface TaskRecord {
  id: string;
  prompt: string;
  status: "pending" | "running" | "completed" | "failed";
  manifestState: ManifestState | null;
  snapshots: SnapshotRecord[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  exitCode?: number;
}

/**
 * In-memory multi-task tracker. Each task has its own
 * ManifestState, snapshots, and lifecycle timestamps.
 */
export class TaskManager {
  private tasks = new Map<string, TaskRecord>();
  private snapshots: SnapshotRecord[] = [];

  /**
   * Create a new task. If a manifest is provided, the task
   * gets a ManifestState immediately (status stays "pending"
   * ready to run). Otherwise manifestState is null.
   */
  createTask(prompt: string, manifest?: Manifest): TaskRecord {
    const id = crypto.randomUUID();
    const task: TaskRecord = {
      id,
      prompt,
      status: "pending",
      manifestState: manifest ? { manifest, grants: [] } : null,
      snapshots: [],
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(id, task);
    return task;
  }

  /** Update a task with partial fields. Returns the updated record. */
  updateTask(id: string, updates: Partial<TaskRecord>): TaskRecord {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }
    Object.assign(task, updates);
    return task;
  }

  /** Get a single task by ID. */
  getTask(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  /** List tasks, optionally filtered by status. */
  listTasks(filter?: { status?: string }): TaskRecord[] {
    const all = Array.from(this.tasks.values());
    if (filter?.status) {
      return all.filter((t) => t.status === filter.status);
    }
    return all;
  }

  /** Add a snapshot to a task. */
  addSnapshot(taskId: string, snapshot: SnapshotRecord): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    task.snapshots.push(snapshot);
    this.snapshots.push(snapshot);
  }

  /** Get snapshots, optionally filtered by task ID. */
  getSnapshots(taskId?: string): SnapshotRecord[] {
    if (taskId) {
      const task = this.tasks.get(taskId);
      return task ? task.snapshots : [];
    }
    return this.snapshots;
  }
}
