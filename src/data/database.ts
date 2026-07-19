import { Database } from "bun:sqlite"
import type {
  DashboardStats,
  NodeKind,
  PomodoroSettings,
  TimerMode,
  TimerSession,
  TrashRoot,
  WorkNode,
} from "../core/types.ts"
import { DomainError, NODE_KINDS } from "../core/types.ts"

interface NodeRow {
  id: string
  parent_id: string | null
  kind: NodeKind
  title: string
  content: string
  completed_at: number | null
  position: number
  trash_root_id: string | null
  trashed_at: number | null
  created_at: number
  updated_at: number
}

interface TimerRow {
  id: string
  task_id: string | null
  task_title: string | null
  mode: TimerMode
  status: TimerSession["status"]
  duration_seconds: number
  remaining_seconds: number
  started_at: number
  target_end_at: number | null
  completed_at: number | null
  cancelled_at: number | null
}

const SCHEMA_VERSION = 2

function mapNode(row: NodeRow): WorkNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    completedAt: row.completed_at,
    position: row.position,
    trashRootId: row.trash_root_id,
    trashedAt: row.trashed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapTimer(row: TimerRow): TimerSession {
  return {
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    mode: row.mode,
    status: row.status,
    durationSeconds: row.duration_seconds,
    remainingSeconds: row.remaining_seconds,
    startedAt: row.started_at,
    targetEndAt: row.target_end_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
  }
}

function cleanTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, " ")
  if (title.length === 0 || title.length > 120) {
    throw new DomainError("INVALID_TITLE", "The title must be between 1 and 120 characters")
  }
  return title
}

export class WorkaholicDatabase {
  readonly path: string
  private readonly db: Database

  constructor(path: string) {
    this.path = path
    this.db = new Database(path, { create: true, strict: true })
    this.db.run("PRAGMA foreign_keys = ON")
    this.db.run("PRAGMA busy_timeout = 3000")
    this.db.run("PRAGMA journal_mode = DELETE")
    this.db.run("PRAGMA synchronous = FULL")
    this.migrate()
  }

  close(): void {
    this.db.close(false)
  }

  private migrate(): void {
    const versionRow = this.db.query("PRAGMA user_version").get() as { user_version: number }
    if (versionRow.user_version > SCHEMA_VERSION) {
      throw new Error(`The database uses schema ${versionRow.user_version}; this version only supports up to ${SCHEMA_VERSION}`)
    }
    if (versionRow.user_version === SCHEMA_VERSION) return

    const migrate = this.db.transaction(() => {
      if (versionRow.user_version < 1) {
        this.db.run(`
          CREATE TABLE nodes (
            id TEXT PRIMARY KEY,
            parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('folder', 'project', 'task')),
            title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
            content TEXT NOT NULL DEFAULT '',
            completed_at INTEGER,
            position INTEGER NOT NULL CHECK (position >= 0),
            trash_root_id TEXT,
            trashed_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            CHECK ((trash_root_id IS NULL) = (trashed_at IS NULL)),
            CHECK (kind = 'task' OR completed_at IS NULL)
          );

          CREATE INDEX nodes_parent_position ON nodes(parent_id, position);
          CREATE INDEX nodes_trash_root ON nodes(trash_root_id);

          CREATE TABLE pomodoro_sessions (
            id TEXT PRIMARY KEY,
            task_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
            mode TEXT NOT NULL CHECK (mode IN ('work', 'break')),
            status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'cancelled')),
            duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
            remaining_seconds INTEGER NOT NULL CHECK (remaining_seconds >= 0),
            started_at INTEGER NOT NULL,
            target_end_at INTEGER,
            completed_at INTEGER,
            cancelled_at INTEGER
          );

          CREATE UNIQUE INDEX one_active_timer
            ON pomodoro_sessions((1))
            WHERE status IN ('running', 'paused');
          CREATE INDEX pomodoro_task ON pomodoro_sessions(task_id, started_at DESC);

          CREATE TABLE settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );

          INSERT INTO settings(key, value) VALUES
            ('work_minutes', '45'),
            ('break_minutes', '10');
        `)
      }

      if (versionRow.user_version === 1) {
        this.db.run("ALTER TABLE nodes ADD COLUMN content TEXT NOT NULL DEFAULT ''")
      }

      this.db.run("PRAGMA user_version = 2")
    })

    migrate()
  }

  listNodes(): WorkNode[] {
    const rows = this.db
      .query("SELECT * FROM nodes ORDER BY parent_id, position, created_at")
      .all() as NodeRow[]
    return rows.map(mapNode)
  }

  getNode(id: string): WorkNode | null {
    const row = this.db.query("SELECT * FROM nodes WHERE id = $id").get({ id }) as NodeRow | null
    return row ? mapNode(row) : null
  }

  createNode(kind: NodeKind, titleValue: string, parentId: string | null, now = Date.now()): WorkNode {
    if (!NODE_KINDS.includes(kind)) throw new DomainError("INVALID_KIND", "Invalid item type")
    const title = cleanTitle(titleValue)
    if (parentId !== null) this.requireActiveNode(parentId)

    const id = crypto.randomUUID()
    this.db
      .query(`
        INSERT INTO nodes(id, parent_id, kind, title, content, completed_at, position, trash_root_id, trashed_at, created_at, updated_at)
        SELECT $id, $parentId, $kind, $title, '', NULL, COALESCE(MAX(position) + 1, 0), NULL, NULL, $now, $now
        FROM nodes
        WHERE parent_id IS $parentId AND trashed_at IS NULL
      `)
      .run({ id, parentId, kind, title, now })

    return this.requireNode(id)
  }

  renameNode(id: string, titleValue: string, now = Date.now()): WorkNode {
    this.requireActiveNode(id)
    const title = cleanTitle(titleValue)
    this.db.query("UPDATE nodes SET title = $title, updated_at = $now WHERE id = $id").run({ id, title, now })
    return this.requireNode(id)
  }

  toggleTask(id: string, now = Date.now()): WorkNode {
    const node = this.requireActiveNode(id)
    if (node.kind !== "task") throw new DomainError("INVALID_KIND", "Only tasks can be completed")
    const completedAt = node.completedAt === null ? now : null
    this.db
      .query("UPDATE nodes SET completed_at = $completedAt, updated_at = $now WHERE id = $id")
      .run({ id, completedAt, now })
    return this.requireNode(id)
  }

  updateTaskContent(id: string, contentValue: string, now = Date.now()): WorkNode {
    const node = this.requireActiveNode(id)
    if (node.kind !== "task") throw new DomainError("INVALID_KIND", "Only tasks can have details")
    const content = contentValue.replace(/\r\n?/g, "\n")
    if (content.length > 50_000) {
      throw new DomainError("INVALID_CONTENT", "Task details cannot exceed 50,000 characters")
    }
    this.db.query("UPDATE nodes SET content = $content, updated_at = $now WHERE id = $id").run({ id, content, now })
    return this.requireNode(id)
  }

  moveNode(id: string, parentId: string | null, now = Date.now()): WorkNode {
    const node = this.requireActiveNode(id)
    if (node.parentId === parentId) return node

    if (parentId !== null) {
      this.requireActiveNode(parentId)
      const createsCycle = this.db
        .query(`
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM nodes WHERE parent_id = $id AND trashed_at IS NULL
            UNION ALL
            SELECT child.id FROM nodes child JOIN descendants parent ON child.parent_id = parent.id
            WHERE child.trashed_at IS NULL
          )
          SELECT 1 AS found FROM descendants WHERE id = $parentId LIMIT 1
        `)
        .get({ id, parentId }) as { found: number } | null
      if (parentId === id || createsCycle) throw new DomainError("CYCLE", "You cannot move an item inside itself")
    }

    this.db
      .query(`
        UPDATE nodes
        SET parent_id = $parentId,
            position = (
              SELECT COALESCE(MAX(position) + 1, 0)
              FROM nodes sibling
              WHERE sibling.parent_id IS $parentId AND sibling.trashed_at IS NULL
            ),
            updated_at = $now
        WHERE id = $id
      `)
      .run({ id, parentId, now })
    return this.requireNode(id)
  }

  reorderNode(id: string, direction: -1 | 1, now = Date.now()): WorkNode {
    const node = this.requireActiveNode(id)
    const siblings = this.db
      .query(`
        SELECT id, position FROM nodes
        WHERE parent_id IS $parentId AND trashed_at IS NULL
        ORDER BY position, created_at
      `)
      .all({ parentId: node.parentId }) as Array<{ id: string; position: number }>
    const currentIndex = siblings.findIndex((sibling) => sibling.id === id)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) return node

    const target = siblings[targetIndex]
    const current = siblings[currentIndex]
    const swap = this.db.transaction(() => {
      this.db.query("UPDATE nodes SET position = $position, updated_at = $now WHERE id = $id").run({
        id: current.id,
        position: target.position,
        now,
      })
      this.db.query("UPDATE nodes SET position = $position, updated_at = $now WHERE id = $id").run({
        id: target.id,
        position: current.position,
        now,
      })
    })
    swap()
    return this.requireNode(id)
  }

  trashNode(id: string, now = Date.now()): void {
    this.requireActiveNode(id)
    const activeTimer = this.db
      .query(`
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM nodes WHERE id = $id AND trashed_at IS NULL
          UNION ALL
          SELECT child.id FROM nodes child JOIN subtree parent ON child.parent_id = parent.id
          WHERE child.trashed_at IS NULL
        )
        SELECT 1 AS found
        FROM pomodoro_sessions timer JOIN subtree ON timer.task_id = subtree.id
        WHERE timer.status IN ('running', 'paused')
        LIMIT 1
      `)
      .get({ id }) as { found: number } | null
    if (activeTimer) throw new DomainError("ACTIVE_TIMER", "Cancel the Pomodoro before moving that task to Trash")

    this.db
      .query(`
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM nodes WHERE id = $id AND trashed_at IS NULL
          UNION ALL
          SELECT child.id FROM nodes child JOIN subtree parent ON child.parent_id = parent.id
          WHERE child.trashed_at IS NULL
        )
        UPDATE nodes
        SET trashed_at = $now, trash_root_id = $id, updated_at = $now
        WHERE id IN (SELECT id FROM subtree)
      `)
      .run({ id, now })
  }

  listTrashRoots(): TrashRoot[] {
    const rows = this.db
      .query(`
        SELECT root.*,
          (WITH RECURSIVE subtree(id) AS (
            SELECT root.id
            UNION ALL
            SELECT child.id FROM nodes child JOIN subtree parent ON child.parent_id = parent.id
          ) SELECT COUNT(*) FROM subtree) AS descendant_count
        FROM nodes root
        WHERE root.trash_root_id = root.id
        ORDER BY root.trashed_at DESC
      `)
      .all() as Array<NodeRow & { descendant_count: number }>
    return rows.map((row) => ({ ...mapNode(row), descendantCount: row.descendant_count }))
  }

  restoreTrashRoot(id: string, now = Date.now()): WorkNode {
    const root = this.requireNode(id)
    if (root.trashRootId !== id) throw new DomainError("NOT_TRASH_ROOT", "That item is not a Trash root")

    const restore = this.db.transaction(() => {
      const parent = root.parentId ? this.getNode(root.parentId) : null
      const parentId = parent && parent.trashedAt === null ? parent.id : null
      const nextPosition = this.db
        .query("SELECT COALESCE(MAX(position) + 1, 0) AS value FROM nodes WHERE parent_id IS $parentId AND trashed_at IS NULL")
        .get({ parentId }) as { value: number }

      this.db
        .query("UPDATE nodes SET trashed_at = NULL, trash_root_id = NULL, updated_at = $now WHERE trash_root_id = $id")
        .run({ id, now })
      this.db
        .query("UPDATE nodes SET parent_id = $parentId, position = $position, updated_at = $now WHERE id = $id")
        .run({ id, parentId, position: nextPosition.value, now })
    })
    restore()
    return this.requireNode(id)
  }

  permanentlyDeleteTrashRoot(id: string): void {
    const root = this.requireNode(id)
    if (root.trashRootId !== id) throw new DomainError("NOT_TRASH_ROOT", "That item is not a Trash root")
    this.db.query("DELETE FROM nodes WHERE id = $id").run({ id })
  }

  getSettings(): PomodoroSettings {
    const rows = this.db.query("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>
    const values = new Map(rows.map((row) => [row.key, Number.parseInt(row.value, 10)]))
    return {
      workMinutes: values.get("work_minutes") ?? 45,
      breakMinutes: values.get("break_minutes") ?? 10,
    }
  }

  updatePomodoroSettings(workMinutes: number, breakMinutes: number): PomodoroSettings {
    if (
      !Number.isInteger(workMinutes) ||
      !Number.isInteger(breakMinutes) ||
      workMinutes < 1 ||
      workMinutes > 180 ||
      breakMinutes < 1 ||
      breakMinutes > 180
    ) {
      throw new DomainError("INVALID_SETTINGS", "Focus and break durations must be whole minutes between 1 and 180")
    }

    const save = this.db.transaction(() => {
      this.db
        .query("INSERT INTO settings(key, value) VALUES ('work_minutes', $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run({ value: String(workMinutes) })
      this.db
        .query("INSERT INTO settings(key, value) VALUES ('break_minutes', $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run({ value: String(breakMinutes) })
    })
    save()
    return this.getSettings()
  }

  getActiveTimer(): TimerSession | null {
    const row = this.db
      .query(`
        SELECT timer.*, task.title AS task_title
        FROM pomodoro_sessions timer
        LEFT JOIN nodes task ON task.id = timer.task_id
        WHERE timer.status IN ('running', 'paused')
        LIMIT 1
      `)
      .get() as TimerRow | null
    return row ? mapTimer(row) : null
  }

  startTimer(mode: TimerMode, taskId: string, now = Date.now()): TimerSession {
    const task = this.requireActiveNode(taskId)
    if (task.kind !== "task") throw new DomainError("INVALID_KIND", "Select a task before starting a Pomodoro")
    if (this.getActiveTimer()) throw new DomainError("ACTIVE_TIMER", "A Pomodoro is already active")

    const settings = this.getSettings()
    const durationSeconds = (mode === "work" ? settings.workMinutes : settings.breakMinutes) * 60
    const id = crypto.randomUUID()
    this.db
      .query(`
        INSERT INTO pomodoro_sessions(
          id, task_id, mode, status, duration_seconds, remaining_seconds,
          started_at, target_end_at, completed_at, cancelled_at
        ) VALUES (
          $id, $taskId, $mode, 'running', $durationSeconds, $durationSeconds,
          $now, $targetEndAt, NULL, NULL
        )
      `)
      .run({ id, taskId, mode, durationSeconds, now, targetEndAt: now + durationSeconds * 1000 })
    return this.getActiveTimer()!
  }

  pauseTimer(now = Date.now()): TimerSession | null {
    const timer = this.getActiveTimer()
    if (!timer) throw new DomainError("NO_ACTIVE_TIMER", "There is no active Pomodoro")
    if (timer.status === "paused") return timer
    if (timer.targetEndAt !== null && timer.targetEndAt <= now) {
      this.reconcileExpiredTimers(now)
      return null
    }

    const remainingSeconds = Math.max(1, Math.ceil(((timer.targetEndAt ?? now) - now) / 1000))
    this.db
      .query(`
        UPDATE pomodoro_sessions
        SET status = 'paused', remaining_seconds = $remainingSeconds, target_end_at = NULL
        WHERE id = $id
      `)
      .run({ id: timer.id, remainingSeconds })
    return this.getActiveTimer()
  }

  resumeTimer(now = Date.now()): TimerSession {
    const timer = this.getActiveTimer()
    if (!timer) throw new DomainError("NO_ACTIVE_TIMER", "There is no active Pomodoro")
    if (timer.status === "running") return timer
    this.db
      .query("UPDATE pomodoro_sessions SET status = 'running', target_end_at = $targetEndAt WHERE id = $id")
      .run({ id: timer.id, targetEndAt: now + timer.remainingSeconds * 1000 })
    return this.getActiveTimer()!
  }

  cancelTimer(now = Date.now()): TimerSession {
    const timer = this.getActiveTimer()
    if (!timer) throw new DomainError("NO_ACTIVE_TIMER", "There is no active Pomodoro")
    this.db
      .query(`
        UPDATE pomodoro_sessions
        SET status = 'cancelled', cancelled_at = $now, target_end_at = NULL
        WHERE id = $id
      `)
      .run({ id: timer.id, now })
    return { ...timer, status: "cancelled", cancelledAt: now, targetEndAt: null }
  }

  reconcileExpiredTimers(now = Date.now()): TimerSession[] {
    const rows = this.db
      .query(`
        SELECT timer.*, task.title AS task_title
        FROM pomodoro_sessions timer
        LEFT JOIN nodes task ON task.id = timer.task_id
        WHERE timer.status = 'running' AND timer.target_end_at <= $now
      `)
      .all({ now }) as TimerRow[]
    if (rows.length === 0) return []

    const complete = this.db.transaction(() => {
      for (const row of rows) {
        this.db
          .query(`
            UPDATE pomodoro_sessions
            SET status = 'completed', remaining_seconds = 0,
                completed_at = target_end_at, target_end_at = NULL
            WHERE id = $id
          `)
          .run({ id: row.id })
      }
    })
    complete()
    return rows.map((row) =>
      mapTimer({ ...row, status: "completed", remaining_seconds: 0, completed_at: row.target_end_at, target_end_at: null }),
    )
  }

  getStats(now = Date.now()): DashboardStats {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const taskCounts = this.db
      .query(`
        SELECT
          SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END) AS open_tasks,
          SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed_tasks
        FROM nodes
        WHERE kind = 'task' AND trashed_at IS NULL
      `)
      .get() as { open_tasks: number | null; completed_tasks: number | null }
    const workSessions = this.db
      .query(`
        SELECT COUNT(*) AS value
        FROM pomodoro_sessions
        WHERE mode = 'work' AND status = 'completed' AND completed_at >= $start
      `)
      .get({ start: start.getTime() }) as { value: number }
    return {
      openTasks: taskCounts.open_tasks ?? 0,
      completedTasks: taskCounts.completed_tasks ?? 0,
      workSessionsToday: workSessions.value,
    }
  }

  private requireNode(id: string): WorkNode {
    const node = this.getNode(id)
    if (!node) throw new DomainError("NOT_FOUND", "The item no longer exists")
    return node
  }

  private requireActiveNode(id: string): WorkNode {
    const node = this.requireNode(id)
    if (node.trashedAt !== null) throw new DomainError("NOT_FOUND", "The item is in Trash")
    return node
  }
}
