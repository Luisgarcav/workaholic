import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DomainError } from "../src/core/types.ts"
import { WorkaholicDatabase } from "../src/data/database.ts"

describe("WorkaholicDatabase", () => {
  let db: WorkaholicDatabase

  beforeEach(() => {
    db = new WorkaholicDatabase(":memory:")
  })

  afterEach(() => {
    db.close()
  })

  test("creates a flexible tree and completes only the selected task", () => {
    const folder = db.createNode("folder", "Client", null, 1)
    const project = db.createNode("project", "Redesign", folder.id, 2)
    const task = db.createNode("task", "Prepare proposal", project.id, 3)
    const subtask = db.createNode("task", "Review costs", task.id, 4)

    const completed = db.toggleTask(task.id, 10)

    expect(completed.completedAt).toBe(10)
    expect(db.getNode(subtask.id)?.completedAt).toBeNull()
    expect(db.listNodes()).toHaveLength(4)
  })

  test("prevents cycles when moving nodes", () => {
    const parent = db.createNode("folder", "Parent", null)
    const child = db.createNode("project", "Child", parent.id)
    const grandchild = db.createNode("task", "Grandchild", child.id)

    expect(() => db.moveNode(parent.id, grandchild.id)).toThrow(DomainError)
    expect(db.getNode(parent.id)?.parentId).toBeNull()
  })

  test("moves a subtree to Trash and restores it", () => {
    const project = db.createNode("project", "Project", null, 1)
    const task = db.createNode("task", "Task", project.id, 2)

    db.trashNode(project.id, 50)
    expect(db.getNode(project.id)?.trashRootId).toBe(project.id)
    expect(db.getNode(task.id)?.trashRootId).toBe(project.id)
    expect(db.listTrashRoots()[0]?.descendantCount).toBe(2)

    db.restoreTrashRoot(project.id, 60)
    expect(db.getNode(project.id)?.trashedAt).toBeNull()
    expect(db.getNode(task.id)?.trashedAt).toBeNull()
  })

  test("protects a focused task and reconciles timer expiration", () => {
    const task = db.createNode("task", "Deep work", null, 0)
    const timer = db.startTimer("work", task.id, 1_000)

    expect(timer.durationSeconds).toBe(45 * 60)
    expect(() => db.trashNode(task.id, 2_000)).toThrow("Cancel the Pomodoro")

    const finished = db.reconcileExpiredTimers(1_000 + 45 * 60 * 1_000)
    expect(finished).toHaveLength(1)
    expect(finished[0]?.status).toBe("completed")
    expect(db.getActiveTimer()).toBeNull()
  })

  test("pauses and resumes using the remaining seconds", () => {
    const task = db.createNode("task", "Task", null, 0)
    db.startTimer("work", task.id, 0)

    const paused = db.pauseTimer(60_000)
    expect(paused?.status).toBe("paused")
    expect(paused?.remainingSeconds).toBe(44 * 60)

    const resumed = db.resumeTimer(100_000)
    expect(resumed.status).toBe("running")
    expect(resumed.targetEndAt).toBe(100_000 + 44 * 60 * 1_000)
  })

  test("counts tasks and sessions for the current day", () => {
    const now = new Date(2026, 6, 17, 12, 0, 0).getTime()
    const open = db.createNode("task", "Pending", null, now)
    const done = db.createNode("task", "Done", null, now)
    db.toggleTask(done.id, now)
    db.startTimer("work", open.id, now - 45 * 60 * 1_000)
    db.reconcileExpiredTimers(now)

    expect(db.getStats(now)).toEqual({ openTasks: 1, completedTasks: 1, workSessionsToday: 1 })
  })

  test("stores multiline details only on tasks", () => {
    const task = db.createNode("task", "Document API", null, 1)
    const folder = db.createNode("folder", "Reference", null, 2)

    const updated = db.updateTaskContent(task.id, "Context\r\n\rAcceptance criteria", 10)

    expect(updated.content).toBe("Context\n\nAcceptance criteria")
    expect(db.getNode(task.id)?.updatedAt).toBe(10)
    expect(() => db.updateTaskContent(folder.id, "Not allowed")).toThrow("Only tasks")
    expect(() => db.updateTaskContent(task.id, "x".repeat(50_001))).toThrow("50,000")
  })

  test("customizes Pomodoro durations for new sessions", () => {
    const task = db.createNode("task", "Write tests", null)

    expect(db.getSettings()).toEqual({ workMinutes: 45, breakMinutes: 10 })
    expect(db.updatePomodoroSettings(25, 5)).toEqual({ workMinutes: 25, breakMinutes: 5 })
    expect(db.startTimer("work", task.id).durationSeconds).toBe(25 * 60)
    db.cancelTimer()
    expect(db.startTimer("break", task.id).durationSeconds).toBe(5 * 60)
    expect(() => db.updatePomodoroSettings(0, 5)).toThrow("between 1 and 180")
    expect(() => db.updatePomodoroSettings(25.5, 5)).toThrow(DomainError)
  })
})

test("keeps nodes, details, and settings in one persistent file", () => {
  const directory = mkdtempSync(join(tmpdir(), "workaholic-test-"))
  const path = join(directory, "workaholic.db")
  const db = new WorkaholicDatabase(path)
  const task = db.createNode("task", "Persistent", null)
  db.updateTaskContent(task.id, "Keep this context")
  db.updatePomodoroSettings(50, 15)
  db.close()

  const reopened = new WorkaholicDatabase(path)
  expect(reopened.listNodes()[0]?.title).toBe("Persistent")
  expect(reopened.listNodes()[0]?.content).toBe("Keep this context")
  expect(reopened.getSettings()).toEqual({ workMinutes: 50, breakMinutes: 15 })
  reopened.close()
  expect(readdirSync(directory)).toEqual(["workaholic.db"])
  rmSync(directory, { recursive: true, force: true })
})

test("migrates version 1 data by adding empty task details", () => {
  const directory = mkdtempSync(join(tmpdir(), "workaholic-v1-test-"))
  const path = join(directory, "workaholic.db")
  const legacy = new Database(path, { create: true })
  legacy.run(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      completed_at INTEGER,
      position INTEGER NOT NULL,
      trash_root_id TEXT,
      trashed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  legacy
    .query(`
      INSERT INTO nodes(
        id, parent_id, kind, title, completed_at, position,
        trash_root_id, trashed_at, created_at, updated_at
      ) VALUES ('legacy-task', NULL, 'task', 'Existing task', NULL, 0, NULL, NULL, 1, 1)
    `)
    .run()
  legacy.run("PRAGMA user_version = 1")
  legacy.close()

  const migrated = new WorkaholicDatabase(path)
  expect(migrated.getNode("legacy-task")?.content).toBe("")
  expect(migrated.updateTaskContent("legacy-task", "New details").content).toBe("New details")
  migrated.close()
  rmSync(directory, { recursive: true, force: true })
})
