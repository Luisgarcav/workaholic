import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { WorkaholicDatabase } from "../src/data/database.ts"
import { WorkaholicApp } from "../src/ui/app.tsx"

test("renders the empty screen and creates a task", async () => {
  const db = new WorkaholicDatabase(":memory:")
  const screen = await testRender(() => <WorkaholicApp db={db} />, { width: 110, height: 28 })

  try {
    await screen.renderOnce()
    expect(screen.captureCharFrame()).toContain("WORKAHOLIC")
    expect(screen.captureCharFrame()).toContain("Empty")

    screen.mockInput.pressKey("a")
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("Create item")

    await screen.mockInput.typeText("First task")
    screen.mockInput.pressEnter()
    await screen.flush()

    expect(db.listNodes()[0]?.title).toBe("First task")
    expect(screen.captureCharFrame()).toContain("First task")
  } finally {
    screen.renderer.destroy()
    db.close()
  }
})

test("renders persistent tree connectors and explicit item types", async () => {
  const db = new WorkaholicDatabase(":memory:")
  const project = db.createNode("project", "Project Atlas", null, 1)
  db.createNode("task", "Ship release", project.id, 2)
  db.createNode("task", "Inbox task", null, 3)
  const screen = await testRender(() => <WorkaholicApp db={db} />, { width: 110, height: 28 })

  try {
    await screen.renderOnce()
    const frame = screen.captureCharFrame()
    expect(frame).toContain("├─ ▾ [PRJ] Project Atlas")
    expect(frame).toContain("│  └─ [ ] [TASK] Ship release")
    expect(frame).toContain("└─ [ ] [TASK] Inbox task")
  } finally {
    screen.renderer.destroy()
    db.close()
  }
})

test("edits and persists custom Pomodoro durations", async () => {
  const db = new WorkaholicDatabase(":memory:")
  db.createNode("task", "Plan sprint", null)
  const screen = await testRender(() => <WorkaholicApp db={db} />, { width: 110, height: 28 })

  try {
    await screen.renderOnce()
    screen.mockInput.pressKey("s")
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("Pomodoro settings")

    screen.mockInput.pressBackspace()
    screen.mockInput.pressBackspace()
    await screen.mockInput.typeText("25")
    screen.mockInput.pressEnter()
    await screen.flush()
    screen.mockInput.pressBackspace()
    screen.mockInput.pressBackspace()
    await screen.mockInput.typeText("5")
    screen.mockInput.pressEnter()
    await screen.flush()

    expect(db.getSettings()).toEqual({ workMinutes: 25, breakMinutes: 5 })
    expect(screen.captureCharFrame()).toContain("p focus 25m · b break 5m")
  } finally {
    screen.renderer.destroy()
    db.close()
  }
})

test("edits multiline task details", async () => {
  const db = new WorkaholicDatabase(":memory:")
  const task = db.createNode("task", "Investigate timeout", null)
  const screen = await testRender(() => <WorkaholicApp db={db} />, { width: 110, height: 28 })

  try {
    await screen.renderOnce()
    screen.mockInput.pressKey("e")
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("Edit task details")

    await screen.mockInput.typeText("Reproduce locally")
    screen.mockInput.pressEnter()
    await screen.mockInput.typeText("Check request logs")
    screen.mockInput.pressKey("s", { ctrl: true })
    await screen.flush()

    expect(db.getNode(task.id)?.content).toBe("Reproduce locally\nCheck request logs")
    expect(screen.captureCharFrame()).toContain("Reproduce locally")
  } finally {
    screen.renderer.destroy()
    db.close()
  }
})

test("marks the focused task and draws hot coffee during a Pomodoro", async () => {
  const db = new WorkaholicDatabase(":memory:")
  const task = db.createNode("task", "Write migration", null)
  const screen = await testRender(() => <WorkaholicApp db={db} />, { width: 110, height: 28 })

  try {
    await screen.renderOnce()
    screen.mockInput.pressKey("p")
    await screen.flush()

    const frame = screen.captureCharFrame()
    expect(db.getActiveTimer()?.taskId).toBe(task.id)
    expect(frame).toContain("[FOCUS]")
    expect(frame).toContain(".--------.")
    expect(frame).toContain("FOCUS")
  } finally {
    screen.renderer.destroy()
    db.close()
  }
})
