import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { WorkaholicDatabase } from "../src/data/database.ts"
import { WorkaholicApp } from "../src/ui/app.tsx"

test("creates directories, projects, tasks, and loose root tasks in canonical order", async () => {
  const db = new WorkaholicDatabase(":memory:")
  const screen = await testRender(() => <WorkaholicApp db={db} />, { width: 110, height: 28 })

  try {
    await screen.renderOnce()
    expect(screen.captureCharFrame()).toContain("WORKAHOLIC")
    expect(screen.captureCharFrame()).toContain("Empty")

    screen.mockInput.pressKey("a")
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("Create item")
    expect(screen.captureCharFrame()).toContain("Type: folder")

    await screen.mockInput.typeText("Work")
    screen.mockInput.pressEnter()
    await screen.flush()

    const folder = db.listNodes().find((node) => node.title === "Work")
    expect(folder?.kind).toBe("folder")

    screen.mockInput.pressKey("a")
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("Type: project")
    await screen.mockInput.typeText("Website")
    screen.mockInput.pressEnter()
    await screen.flush()

    const project = db.listNodes().find((node) => node.title === "Website")
    expect(project?.kind).toBe("project")
    expect(project?.parentId).toBe(folder?.id)

    screen.mockInput.pressKey("a")
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("Type: task")
    await screen.mockInput.typeText("Ship landing page")
    screen.mockInput.pressEnter()
    await screen.flush()

    const task = db.listNodes().find((node) => node.title === "Ship landing page")
    expect(task?.kind).toBe("task")
    expect(task?.parentId).toBe(project?.id)

    screen.mockInput.pressKey("a", { shift: true })
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("Type: folder")
    screen.mockInput.pressTab()
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("Type: task")
    await screen.mockInput.typeText("Loose reminder")
    screen.mockInput.pressEnter()
    await screen.flush()

    const looseTask = db.listNodes().find((node) => node.title === "Loose reminder")
    expect(looseTask?.kind).toBe("task")
    expect(looseTask?.parentId).toBeNull()
  } finally {
    screen.renderer.destroy()
    db.close()
  }
})

test("renders persistent tree connectors and explicit item types", async () => {
  const db = new WorkaholicDatabase(":memory:")
  const inbox = db.createNode("task", "Inbox task", null, 1)
  const folder = db.createNode("folder", "Work", null, 2)
  const looseTask = db.createNode("task", "Call client", folder.id, 3)
  const project = db.createNode("project", "Project Atlas", folder.id, 4)
  db.createNode("task", "Ship release", project.id, 5)
  const screen = await testRender(() => <WorkaholicApp db={db} />, { width: 110, height: 28 })

  try {
    await screen.renderOnce()
    const frame = screen.captureCharFrame()
    expect(frame).toContain("├─ ▾ [DIR] Work")
    expect(frame).toContain("│  ├─ ▾ [PRJ] Project Atlas")
    expect(frame).toContain("│  │  └─ [ ] [TASK] Ship release")
    expect(frame).toContain("│  └─ [ ] [TASK] Call client")
    expect(frame).toContain("└─ [ ] [TASK] Inbox task")
    expect(inbox.position).toBeLessThan(folder.position)
    expect(looseTask.position).toBeLessThan(project.position)
  } finally {
    screen.renderer.destroy()
    db.close()
  }
})

test("creates sibling tasks with a and a subtask only with c", async () => {
  const db = new WorkaholicDatabase(":memory:")
  const firstTask = db.createNode("task", "First task", null)
  const screen = await testRender(() => <WorkaholicApp db={db} />, { width: 110, height: 28 })

  try {
    await screen.renderOnce()
    screen.mockInput.pressKey("a")
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("Type: task")
    expect(screen.captureCharFrame()).toContain("Destination: / root")

    await screen.mockInput.typeText("Second task")
    screen.mockInput.pressEnter()
    await screen.flush()

    const secondTask = db.listNodes().find((node) => node.title === "Second task")
    expect(secondTask?.parentId).toBeNull()
    expect(db.getNode(firstTask.id)?.parentId).toBeNull()

    screen.mockInput.pressKey("c")
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("Destination: [TASK] Second task")
    await screen.mockInput.typeText("Explicit subtask")
    screen.mockInput.pressEnter()
    await screen.flush()

    const subtask = db.listNodes().find((node) => node.title === "Explicit subtask")
    expect(subtask?.parentId).toBe(secondTask?.id)
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
