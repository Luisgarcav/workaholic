import { homedir } from "node:os"
import { TextAttributes, type KeyEvent, type TextareaRenderable } from "@opentui/core"
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { WorkaholicDatabase } from "../data/database.ts"
import type { FlatNode, NodeKind, TimerSession, TrashRoot, WorkNode } from "../core/types.ts"
import { DomainError } from "../core/types.ts"
import { clampSelection, flattenVisibleTree } from "../core/tree.ts"
import { theme } from "./theme.ts"

type View = "tree" | "trash"
type StatusTone = "info" | "success" | "warning" | "danger"

type Modal =
  | { type: "create"; parentId: string | null; kind: NodeKind; value: string }
  | { type: "rename"; nodeId: string; value: string }
  | { type: "edit-content"; nodeId: string; value: string }
  | { type: "settings"; field: "work" | "break" }
  | { type: "move"; nodeId: string; index: number }
  | { type: "trash"; nodeId: string }
  | { type: "delete"; nodeId: string }
  | { type: "cancel-timer" }
  | { type: "help" }
  | null

interface MoveTarget {
  id: string | null
  label: string
}

export interface WorkaholicAppProps {
  db: WorkaholicDatabase
  expiredTimers?: TimerSession[]
  onExit?: () => void
}

const KIND_LABEL: Record<NodeKind, string> = {
  folder: "folder",
  project: "project",
  task: "task",
}

const KIND_ORDER: NodeKind[] = ["task", "project", "folder"]

const COFFEE_ART = String.raw`    ( (
     ) )
  .--------.
  |        |]
  \        /
   '------'`

export function WorkaholicApp(props: WorkaholicAppProps) {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const initialNodes = props.db.listNodes()
  const [nodes, setNodes] = createSignal(initialNodes)
  const [expanded, setExpanded] = createSignal(new Set(initialNodes.filter((node) => node.trashedAt === null).map((node) => node.id)))
  const [selectedId, setSelectedId] = createSignal<string | null>(initialNodes.find((node) => node.trashedAt === null)?.id ?? null)
  const [view, setView] = createSignal<View>("tree")
  const [trashIndex, setTrashIndex] = createSignal(0)
  const [trashRoots, setTrashRoots] = createSignal(props.db.listTrashRoots())
  const [activeTimer, setActiveTimer] = createSignal(props.db.getActiveTimer())
  const [pomodoroSettings, setPomodoroSettings] = createSignal(props.db.getSettings())
  const [lastCompletedTimer, setLastCompletedTimer] = createSignal<TimerSession | null>(props.expiredTimers?.at(-1) ?? null)
  const [stats, setStats] = createSignal(props.db.getStats())
  const [clock, setClock] = createSignal(Date.now())
  const [modal, setModal] = createSignal<Modal>(null)
  const [status, setStatus] = createSignal<{ message: string; tone: StatusTone } | null>(null)

  let statusTimeout: ReturnType<typeof setTimeout> | undefined
  let clockInterval: ReturnType<typeof setInterval> | undefined
  let inputDraft = ""
  let contentDraft = ""
  let workMinutesDraft = ""
  let breakMinutesDraft = ""
  let contentEditor: TextareaRenderable | undefined

  const flatNodes = createMemo(() => flattenVisibleTree(nodes(), expanded()))
  const selectedIndex = createMemo(() => {
    const id = selectedId()
    return id === null ? 0 : Math.max(0, flatNodes().findIndex((node) => node.id === id))
  })
  const selectedNode = createMemo(() => flatNodes()[selectedIndex()] ?? null)
  const selectedTrash = createMemo(() => trashRoots()[clampSelection(trashIndex(), trashRoots().length)] ?? null)
  const isWide = createMemo(() => dimensions().width >= 76)
  const treeCapacity = createMemo(() => Math.max(4, dimensions().height - (isWide() ? 8 : 19)))
  const treeWindow = createMemo(() => windowItems(flatNodes(), selectedIndex(), treeCapacity()))
  const trashWindow = createMemo(() => windowItems(trashRoots(), trashIndex(), Math.max(4, dimensions().height - 8)))
  const remainingSeconds = createMemo(() => {
    const timer = activeTimer()
    if (!timer) return 0
    if (timer.status === "paused") return timer.remainingSeconds
    return Math.max(0, Math.ceil(((timer.targetEndAt ?? clock()) - clock()) / 1000))
  })
  const moveTargets = createMemo(() => {
    const current = modal()
    return current?.type === "move" ? buildMoveTargets(nodes(), current.nodeId) : []
  })

  const refresh = (preferredId?: string | null): void => {
    const currentId = preferredId === undefined ? selectedId() : preferredId
    setNodes(props.db.listNodes())
    setTrashRoots(props.db.listTrashRoots())
    setStats(props.db.getStats())
    setActiveTimer(props.db.getActiveTimer())
    setPomodoroSettings(props.db.getSettings())

    const visible = flatNodes()
    if (currentId && visible.some((node) => node.id === currentId)) setSelectedId(currentId)
    else setSelectedId(visible[clampSelection(selectedIndex(), visible.length)]?.id ?? null)
    setTrashIndex((index) => clampSelection(index, trashRoots().length))
  }

  const flash = (message: string, tone: StatusTone = "info"): void => {
    if (statusTimeout) clearTimeout(statusTimeout)
    setStatus({ message, tone })
    statusTimeout = setTimeout(() => setStatus(null), 3500)
  }

  const reportError = (error: unknown): void => {
    flash(error instanceof DomainError || error instanceof Error ? error.message : "An unexpected error occurred", "danger")
  }

  const runAction = (action: () => void): void => {
    try {
      action()
    } catch (error) {
      reportError(error)
    }
  }

  const notifyCompletion = (timer: TimerSession, restored = false): void => {
    setLastCompletedTimer(timer)
    const mode = timer.mode === "work" ? "Work session" : "Break"
    const message = restored
      ? `${mode} finished while Workaholic was closed`
      : `${mode} finished${timer.taskTitle ? `: ${timer.taskTitle}` : ""}`
    renderer.triggerNotification(message, "Workaholic")
    process.stdout.write("\x07")
    flash(message, timer.mode === "work" ? "success" : "info")
    refresh(timer.taskId)
  }

  const quit = (): void => {
    renderer.destroy()
    props.onExit?.()
  }

  const selectByOffset = (offset: number): void => {
    if (view() === "trash") {
      setTrashIndex((index) => clampSelection(index + offset, trashRoots().length))
      return
    }
    const list = flatNodes()
    const next = clampSelection(selectedIndex() + offset, list.length)
    setSelectedId(list[next]?.id ?? null)
  }

  const toggleExpanded = (force?: boolean): void => {
    const node = selectedNode()
    if (!node?.hasChildren) return
    setExpanded((current) => {
      const next = new Set(current)
      const shouldExpand = force ?? !next.has(node.id)
      if (shouldExpand) next.add(node.id)
      else next.delete(node.id)
      return next
    })
  }

  const selectParent = (): void => {
    const node = selectedNode()
    if (!node) return
    if (expanded().has(node.id) && node.hasChildren) {
      toggleExpanded(false)
      return
    }
    if (node.parentId) setSelectedId(node.parentId)
  }

  const openCreate = (atRoot: boolean): void => {
    inputDraft = ""
    setModal({ type: "create", parentId: atRoot ? null : selectedNode()?.id ?? null, kind: "task", value: "" })
  }

  const openSettings = (): void => {
    const settings = pomodoroSettings()
    workMinutesDraft = String(settings.workMinutes)
    breakMinutesDraft = String(settings.breakMinutes)
    setModal({ type: "settings", field: "work" })
  }

  const saveSettings = (): void => {
    const current = modal()
    if (current?.type !== "settings") return
    runAction(() => {
      const saved = props.db.updatePomodoroSettings(Number(workMinutesDraft), Number(breakMinutesDraft))
      setPomodoroSettings(saved)
      setModal(null)
      flash(`Pomodoro set to ${saved.workMinutes}m focus / ${saved.breakMinutes}m break`, "success")
    })
  }

  const submitInputModal = (submittedValue?: string): void => {
    const current = modal()
    if (!current || (current.type !== "create" && current.type !== "rename")) return
    runAction(() => {
      const value = submittedValue ?? inputDraft ?? current.value
      if (current.type === "create") {
        const created = props.db.createNode(current.kind, value, current.parentId)
        if (current.parentId) {
          setExpanded((items) => new Set(items).add(current.parentId!))
        }
        setModal(null)
        refresh(created.id)
        flash(`${capitalize(KIND_LABEL[current.kind])} created`, "success")
      } else {
        const renamed = props.db.renameNode(current.nodeId, value)
        setModal(null)
        refresh(renamed.id)
        flash("Title updated", "success")
      }
    })
  }

  const startTimer = (mode: "work" | "break"): void => {
    runAction(() => {
      let task: FlatNode | null = selectedNode()
      if (task?.kind !== "task" && mode === "break") {
        const previousTaskId = lastCompletedTimer()?.taskId
        task = previousTaskId ? flatNodes().find((node) => node.id === previousTaskId) ?? null : null
      }
      if (!task || task.kind !== "task") throw new DomainError("INVALID_KIND", "Select a task first")
      const timer = props.db.startTimer(mode, task.id)
      setActiveTimer(timer)
      setClock(Date.now())
      flash(mode === "work" ? "Focus Pomodoro started" : "Break started", "success")
    })
  }

  const toggleTimerPause = (): void => {
    runAction(() => {
      const timer = activeTimer()
      if (!timer) {
        startTimer("work")
        return
      }
      if (timer.status === "paused") {
        setActiveTimer(props.db.resumeTimer())
        flash("Pomodoro resumed", "success")
      } else {
        const paused = props.db.pauseTimer()
        setActiveTimer(paused)
        if (paused) flash("Pomodoro paused", "warning")
      }
    })
  }

  const handleModalKey = (key: KeyEvent, current: Exclude<Modal, null>): void => {
    if (key.name === "escape") {
      key.preventDefault()
      setModal(null)
      return
    }

    if (current.type === "edit-content" && key.ctrl && key.name === "s") {
      key.preventDefault()
      key.stopPropagation()
      runAction(() => {
        const updated = props.db.updateTaskContent(current.nodeId, contentDraft)
        setModal(null)
        refresh(updated.id)
        flash("Task details saved", "success")
      })
      return
    }

    if (current.type === "settings") {
      if (key.ctrl && key.name === "s") {
        key.preventDefault()
        key.stopPropagation()
        saveSettings()
      } else if (key.name === "tab" || key.name === "up" || key.name === "down") {
        key.preventDefault()
        setModal({ ...current, field: current.field === "work" ? "break" : "work" })
      }
      return
    }

    if (current.type === "create" && (key.name === "tab" || key.name === "left" || key.name === "right")) {
      key.preventDefault()
      const direction = key.name === "left" ? -1 : 1
      const index = KIND_ORDER.indexOf(current.kind)
      const kind = KIND_ORDER[(index + direction + KIND_ORDER.length) % KIND_ORDER.length]
      setModal({ ...current, kind })
      return
    }

    if (current.type === "move") {
      if (key.name === "up" || key.name === "k") {
        setModal({ ...current, index: clampSelection(current.index - 1, moveTargets().length) })
      } else if (key.name === "down" || key.name === "j") {
        setModal({ ...current, index: clampSelection(current.index + 1, moveTargets().length) })
      } else if (key.name === "return") {
        runAction(() => {
          const target = moveTargets()[clampSelection(current.index, moveTargets().length)]
          if (!target) return
          const moved = props.db.moveNode(current.nodeId, target.id)
          if (target.id) setExpanded((items) => new Set(items).add(target.id!))
          setModal(null)
          refresh(moved.id)
          flash("Item moved", "success")
        })
      }
      return
    }

    if (current.type === "trash" && (key.name === "y" || key.name === "return")) {
      runAction(() => {
        props.db.trashNode(current.nodeId)
        setModal(null)
        refresh()
        flash("Moved to Trash", "warning")
      })
      return
    }

    if (current.type === "delete" && (key.name === "y" || key.name === "return")) {
      runAction(() => {
        props.db.permanentlyDeleteTrashRoot(current.nodeId)
        setModal(null)
        refresh()
        flash("Deleted permanently", "warning")
      })
      return
    }

    if (current.type === "cancel-timer" && (key.name === "y" || key.name === "return")) {
      runAction(() => {
        props.db.cancelTimer()
        setActiveTimer(null)
        setModal(null)
        refresh()
        flash("Pomodoro cancelled", "warning")
      })
      return
    }

    if (current.type === "help" && (key.name === "return" || key.name === "?")) setModal(null)
  }

  useKeyboard((key) => {
    if (key.eventType === "release") return
    const currentModal = modal()
    if (currentModal) {
      handleModalKey(key, currentModal)
      return
    }

    if ((key.ctrl && key.name === "c") || key.name === "q") {
      quit()
      return
    }
    if (key.name === "?" || key.sequence === "?") {
      setModal({ type: "help" })
      return
    }
    if (key.name === "t") {
      setView((current) => (current === "tree" ? "trash" : "tree"))
      return
    }
    if (key.name === "escape" && view() === "trash") {
      setView("tree")
      return
    }
    if (key.name === "up" || (key.name === "k" && !key.shift)) {
      selectByOffset(-1)
      return
    }
    if (key.name === "down" || (key.name === "j" && !key.shift)) {
      selectByOffset(1)
      return
    }

    if (view() === "trash") {
      const item = selectedTrash()
      if (key.name === "u" && item) {
        runAction(() => {
          const restored = props.db.restoreTrashRoot(item.id)
          refresh(restored.id)
          setView("tree")
          flash("Item restored", "success")
        })
      } else if (key.name === "d" && item) {
        setModal({ type: "delete", nodeId: item.id })
      }
      return
    }

    if (key.name === "left" || key.name === "h") {
      selectParent()
      return
    }
    if (key.name === "right" || key.name === "l") {
      const node = selectedNode()
      if (!node) return
      if (node.hasChildren && !expanded().has(node.id)) toggleExpanded(true)
      else {
        const child = flatNodes()[selectedIndex() + 1]
        if (child?.parentId === node.id) setSelectedId(child.id)
      }
      return
    }
    if (key.name === "return") {
      toggleExpanded()
      return
    }
    if (key.name === "space") {
      const node = selectedNode()
      if (node?.kind === "task") {
        runAction(() => {
          props.db.toggleTask(node.id)
          refresh(node.id)
          flash(node.completedAt === null ? "Task completed" : "Task reopened", "success")
        })
      }
      return
    }
    if (key.name === "a") {
      key.preventDefault()
      key.stopPropagation()
      openCreate(key.shift === true)
      return
    }
    if (key.name === "r") {
      const node = selectedNode()
      if (node) {
        key.preventDefault()
        key.stopPropagation()
        inputDraft = node.title
        setModal({ type: "rename", nodeId: node.id, value: node.title })
      }
      return
    }
    if (key.name === "e") {
      const node = selectedNode()
      if (node?.kind === "task") {
        key.preventDefault()
        key.stopPropagation()
        contentDraft = node.content
        setModal({ type: "edit-content", nodeId: node.id, value: node.content })
      } else {
        flash("Select a task to edit its details", "warning")
      }
      return
    }
    if (key.name === "s") {
      key.preventDefault()
      key.stopPropagation()
      openSettings()
      return
    }
    if (key.name === "m") {
      const node = selectedNode()
      if (node) {
        const targets = buildMoveTargets(nodes(), node.id)
        const currentIndex = Math.max(0, targets.findIndex((target) => target.id === node.parentId))
        setModal({ type: "move", nodeId: node.id, index: currentIndex })
      }
      return
    }
    if (key.name === "d") {
      const node = selectedNode()
      if (node) setModal({ type: "trash", nodeId: node.id })
      return
    }
    if (key.name === "j" && key.shift) {
      const node = selectedNode()
      if (node) runAction(() => refresh(props.db.reorderNode(node.id, 1).id))
      return
    }
    if (key.name === "k" && key.shift) {
      const node = selectedNode()
      if (node) runAction(() => refresh(props.db.reorderNode(node.id, -1).id))
      return
    }
    if (key.name === "p") {
      toggleTimerPause()
      return
    }
    if (key.name === "b" && !activeTimer()) {
      startTimer("break")
      return
    }
    if (key.name === "x" && activeTimer()) setModal({ type: "cancel-timer" })
  })

  onMount(() => {
    for (const expired of props.expiredTimers ?? []) notifyCompletion(expired, true)
    clockInterval = setInterval(() => {
      const now = Date.now()
      setClock(now)
      const completed = props.db.reconcileExpiredTimers(now)
      if (completed.length > 0) {
        setActiveTimer(null)
        for (const timer of completed) notifyCompletion(timer)
      }
    }, 250)
  })

  onCleanup(() => {
    if (clockInterval) clearInterval(clockInterval)
    if (statusTimeout) clearTimeout(statusTimeout)
    props.onExit?.()
  })

  const renderTree = () => (
    <box
      title=" Work "
      border
      borderStyle="rounded"
      borderColor={view() === "tree" ? theme.accent : theme.border}
      flexDirection="column"
      flexGrow={1}
      minHeight={6}
      paddingX={1}
    >
      <Show when={flatNodes().length > 0} fallback={<text fg={theme.muted}>Empty. Press a to create your first task.</text>}>
        <Show when={treeWindow().hasBefore}>
          <text fg={theme.muted}>  ↑ more</text>
        </Show>
        <For each={treeWindow().items}>
          {(node) => {
            const selected = () => selectedId() === node.id && view() === "tree"
            const focused = () => activeTimer()?.taskId === node.id
            const prefix = () => nodePrefix(node, expanded().has(node.id))
            const branch = () => treeBranch(node)
            return (
              <text
                height={1}
                fg={focused() ? theme.accentStrong : node.completedAt ? theme.muted : kindColor(node.kind)}
                bg={selected() ? theme.selected : theme.panel}
                attributes={selected() || focused() ? TextAttributes.BOLD : node.completedAt ? TextAttributes.DIM : TextAttributes.NONE}
                truncate
              >
                {`${branch()}${prefix()} ${node.title}${focused() ? "  [FOCUS]" : ""}`}
              </text>
            )
          }}
        </For>
        <Show when={treeWindow().hasAfter}>
          <text fg={theme.muted}>  ↓ more</text>
        </Show>
      </Show>
    </box>
  )

  const renderTimer = () => {
    const timer = activeTimer()
    const selected = selectedNode()
    return (
      <box
        title=" Pomodoro "
        border
        borderStyle="rounded"
        borderColor={theme.border}
        flexDirection="column"
        width="100%"
        height={11}
        paddingX={1}
      >
        <Show
          when={timer}
          fallback={
            <box flexDirection="column">
              <text fg={theme.muted}>No active session</text>
              <text fg={selected?.kind === "task" ? theme.text : theme.warning} truncate>
                {selected?.kind === "task" ? selected.title : "Select a task"}
              </text>
              <text fg={theme.accent}>
                {`p focus ${pomodoroSettings().workMinutes}m · b break ${pomodoroSettings().breakMinutes}m`}
              </text>
            </box>
          }
        >
          {(current) => (
            <box flexDirection="row" height={7} gap={1} alignItems="center">
              <text fg={theme.warning} width={13}>{COFFEE_ART}</text>
              <box flexDirection="column" flexGrow={1}>
                <text fg={current().mode === "work" ? theme.accentStrong : theme.success} attributes={TextAttributes.BOLD}>
                  {current().mode === "work" ? "FOCUS" : "BREAK"}
                </text>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  {formatDuration(remainingSeconds())}
                </text>
                <text fg={theme.muted} truncate>{current().taskTitle ?? "Deleted task"}</text>
                <text fg={current().status === "paused" ? theme.warning : theme.success} truncate>
                  {current().status === "paused" ? "paused" : progressBar(remainingSeconds(), current().durationSeconds)}
                </text>
                <text fg={theme.accent} truncate>p pause · x cancel</text>
              </box>
            </box>
          )}
        </Show>
        <text fg={theme.muted}>
          {`${stats().workSessionsToday} Pomodoros today · ${stats().openTasks} open`}
        </text>
      </box>
    )
  }

  const renderTaskDetails = () => {
    const task = selectedNode()
    return (
      <box
        title=" Task details "
        border
        borderStyle="rounded"
        borderColor={task?.kind === "task" ? theme.task : theme.border}
        flexDirection="column"
        flexGrow={1}
        minHeight={6}
        paddingX={1}
        overflow="hidden"
      >
        <Show
          when={task?.kind === "task" ? task : null}
          fallback={<text fg={theme.muted}>Select a task to view its details.</text>}
        >
          {(current) => (
            <box flexDirection="column" flexGrow={1} overflow="hidden">
              <text fg={theme.text} attributes={TextAttributes.BOLD} truncate>
                {`${current().title}${activeTimer()?.taskId === current().id ? "  [FOCUS]" : ""}`}
              </text>
              <text fg={current().content ? theme.text : theme.muted} wrapMode="word" selectable flexGrow={1}>
                {current().content || "No details yet. Press e to add them."}
              </text>
              <text fg={theme.accent}>e edit details</text>
            </box>
          )}
        </Show>
      </box>
    )
  }

  const renderTrash = () => (
    <box
      title=" Trash "
      border
      borderStyle="rounded"
      borderColor={theme.warning}
      flexDirection="column"
      flexGrow={1}
      paddingX={1}
    >
      <Show when={trashRoots().length > 0} fallback={<text fg={theme.muted}>Trash is empty.</text>}>
        <Show when={trashWindow().hasBefore}><text fg={theme.muted}>  ↑ more</text></Show>
        <For each={trashWindow().items}>
          {(item) => (
            <text
              height={1}
              fg={theme.warning}
              bg={selectedTrash()?.id === item.id ? theme.selected : theme.panel}
              attributes={selectedTrash()?.id === item.id ? TextAttributes.BOLD : TextAttributes.NONE}
              truncate
            >
              {`${kindGlyph(item.kind)} ${item.title} (${item.descendantCount})`}
            </text>
          )}
        </For>
        <Show when={trashWindow().hasAfter}><text fg={theme.muted}>  ↓ more</text></Show>
      </Show>
    </box>
  )

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.background}>
      <box height={2} paddingX={1} justifyContent="space-between" alignItems="center">
        <text fg={theme.accentStrong} attributes={TextAttributes.BOLD}>WORKAHOLIC</text>
        <text fg={theme.muted} maxWidth="65%" truncate>{`${displayDataPath(props.db.path)} · ${stats().completedTasks} done`}</text>
      </box>

      <box
        flexGrow={1}
        flexDirection={isWide() ? "row" : "column"}
        gap={1}
        paddingX={1}
        opacity={modal() ? 0.55 : 1}
      >
        {view() === "tree" ? renderTree() : renderTrash()}
        <box
          flexDirection="column"
          width={isWide() ? 40 : "100%"}
          height={isWide() ? "100%" : 11}
          gap={1}
        >
          {renderTimer()}
          <Show when={isWide()}>{renderTaskDetails()}</Show>
        </box>
      </box>

      <box height={2} paddingX={1} alignItems="center">
        <Show
          when={status()}
          fallback={
            <text fg={theme.muted} truncate>
              {view() === "tree"
                ? "↑↓/jk navigate · space complete · a add · e details · s timer settings · p focus · ? help"
                : "↑↓/jk move · u restore · d delete · t back · ? help"}
            </text>
          }
        >
          {(current) => <text fg={toneColor(current().tone)} attributes={TextAttributes.BOLD}>{current().message}</text>}
        </Show>
      </box>

      <Show when={modal()?.type === "create" || modal()?.type === "rename"}>
        {(() => {
          const current = modal() as Extract<Modal, { type: "create" | "rename" }>
          return (
            <box
              position="absolute"
              top="30%"
              left="15%"
              width="70%"
              zIndex={100}
              border
              borderStyle="rounded"
              borderColor={theme.accent}
              backgroundColor={theme.panelAlt}
              flexDirection="column"
              padding={1}
              title={current.type === "create" ? " Create item " : " Rename item "}
            >
              <Show when={current.type === "create"}>
                <text fg={theme.muted}>{`Type: ${KIND_LABEL[current.type === "create" ? current.kind : "task"]}  (Tab/←/→ changes type)`}</text>
              </Show>
              <input
                value={current.value}
                placeholder="Title"
                maxLength={120}
                focused
                width="100%"
                textColor={theme.text}
                focusedTextColor={theme.text}
                backgroundColor={theme.panel}
                focusedBackgroundColor={theme.selected}
                onInput={(value) => {
                  inputDraft = value
                }}
                onSubmit={(value) => submitInputModal(typeof value === "string" ? value : inputDraft)}
              />
              <text fg={theme.muted}>Enter saves · Esc cancels</text>
            </box>
          )
        })()}
      </Show>

      <Show when={modal()?.type === "edit-content"}>
        {(() => {
          const current = modal() as Extract<Modal, { type: "edit-content" }>
          const task = () => props.db.getNode(current.nodeId)
          return (
            <box
              position="absolute"
              top="12%"
              left="10%"
              width="80%"
              height="76%"
              zIndex={100}
              border
              borderStyle="rounded"
              borderColor={theme.task}
              backgroundColor={theme.panelAlt}
              flexDirection="column"
              padding={1}
              title=" Edit task details "
            >
              <text fg={theme.text} attributes={TextAttributes.BOLD} truncate>{task()?.title ?? "Task"}</text>
              <textarea
                ref={(element) => {
                  contentEditor = element
                }}
                initialValue={current.value}
                placeholder="Add context, links, acceptance criteria, or notes…"
                focused
                flexGrow={1}
                width="100%"
                wrapMode="word"
                textColor={theme.text}
                focusedTextColor={theme.text}
                backgroundColor={theme.panel}
                focusedBackgroundColor={theme.panel}
                selectionBg={theme.selected}
                onContentChange={() => {
                  contentDraft = contentEditor?.plainText ?? contentDraft
                }}
              />
              <text fg={theme.muted}>Ctrl+S saves · Esc cancels · up to 50,000 characters</text>
            </box>
          )
        })()}
      </Show>

      <Show when={modal()?.type === "settings"}>
        {(() => {
          const current = modal() as Extract<Modal, { type: "settings" }>
          return (
            <box
              position="absolute"
              top="25%"
              left="20%"
              width="60%"
              zIndex={100}
              border
              borderStyle="rounded"
              borderColor={theme.accent}
              backgroundColor={theme.panelAlt}
              flexDirection="column"
              padding={1}
              title=" Pomodoro settings "
            >
              <text fg={current.field === "work" ? theme.accentStrong : theme.text}>Focus duration (minutes)</text>
              <input
                value={workMinutesDraft}
                placeholder="45"
                maxLength={3}
                focused={current.field === "work"}
                width="100%"
                textColor={theme.text}
                focusedTextColor={theme.text}
                backgroundColor={theme.panel}
                focusedBackgroundColor={theme.selected}
                onInput={(value) => {
                  workMinutesDraft = value
                }}
                onSubmit={() => setModal({ ...current, field: "break" })}
              />
              <text fg={current.field === "break" ? theme.accentStrong : theme.text}>Break duration (minutes)</text>
              <input
                value={breakMinutesDraft}
                placeholder="10"
                maxLength={3}
                focused={current.field === "break"}
                width="100%"
                textColor={theme.text}
                focusedTextColor={theme.text}
                backgroundColor={theme.panel}
                focusedBackgroundColor={theme.selected}
                onInput={(value) => {
                  breakMinutesDraft = value
                }}
                onSubmit={saveSettings}
              />
              <text fg={theme.muted}>1–180 minutes · Enter advances/saves · Esc cancels</text>
              <text fg={theme.muted}>Changes apply to new sessions.</text>
            </box>
          )
        })()}
      </Show>

      <Show when={modal()?.type === "move"}>
        {(() => {
          const current = modal() as Extract<Modal, { type: "move" }>
          const targetWindow = () => windowItems(moveTargets(), current.index, 9)
          return (
            <box
              position="absolute"
              top="18%"
              left="15%"
              width="70%"
              zIndex={100}
              border
              borderStyle="rounded"
              borderColor={theme.accent}
              backgroundColor={theme.panelAlt}
              flexDirection="column"
              padding={1}
              title=" Move into "
            >
              <Show when={targetWindow().hasBefore}><text fg={theme.muted}>↑ more</text></Show>
              <For each={targetWindow().items}>
                {(target) => (
                  <text
                    bg={moveTargets()[current.index]?.id === target.id ? theme.selected : theme.panelAlt}
                    fg={moveTargets()[current.index]?.id === target.id ? theme.accentStrong : theme.text}
                    truncate
                  >
                    {target.label}
                  </text>
                )}
              </For>
              <Show when={targetWindow().hasAfter}><text fg={theme.muted}>↓ more</text></Show>
              <text fg={theme.muted}>↑↓ chooses · Enter moves · Esc cancels</text>
            </box>
          )
        })()}
      </Show>

      <Show when={modal()?.type === "trash" || modal()?.type === "delete" || modal()?.type === "cancel-timer"}>
        {(() => {
          const current = modal() as Extract<Modal, { type: "trash" | "delete" | "cancel-timer" }>
          const copy =
            current.type === "trash"
              ? "Move this item and all of its descendants to Trash?"
              : current.type === "delete"
                ? "Permanently delete this subtree? This cannot be undone."
                : "Cancel the active Pomodoro?"
          return (
            <box
              position="absolute"
              top="35%"
              left="20%"
              width="60%"
              zIndex={100}
              border
              borderStyle="rounded"
              borderColor={current.type === "delete" ? theme.danger : theme.warning}
              backgroundColor={theme.panelAlt}
              flexDirection="column"
              padding={1}
              title=" Confirm "
            >
              <text fg={theme.text} wrapMode="word">{copy}</text>
              <text fg={theme.warning}>y/Enter confirms · Esc cancels</text>
            </box>
          )
        })()}
      </Show>

      <Show when={modal()?.type === "help"}>
        <box
          position="absolute"
          top="12%"
          left="10%"
          width="80%"
          zIndex={100}
          border
          borderStyle="rounded"
          borderColor={theme.accent}
          backgroundColor={theme.panelAlt}
          flexDirection="column"
          padding={1}
          title=" Help "
        >
          <text fg={theme.text}>↑↓ / j k    navigate</text>
          <text fg={theme.text}>←→ / h l    collapse/expand branch</text>
          <text fg={theme.text}>Space        complete or reopen task</text>
          <text fg={theme.text}>a / A        create child / create at root</text>
          <text fg={theme.text}>r · e · m    rename · edit details · move</text>
          <text fg={theme.text}>d · J / K    move to Trash · reorder down/up</text>
          <text fg={theme.text}>p · b · x    focus/pause · break · cancel timer</text>
          <text fg={theme.text}>s            Pomodoro settings</text>
          <text fg={theme.text}>t            switch Work/Trash</text>
          <text fg={theme.text}>q / Ctrl+C   quit (an active timer keeps time)</text>
          <text fg={theme.muted}>Esc closes this help</text>
        </box>
      </Show>
    </box>
  )
}

function kindColor(kind: NodeKind): string {
  if (kind === "folder") return theme.folder
  if (kind === "project") return theme.project
  return theme.task
}

function kindGlyph(kind: NodeKind): string {
  if (kind === "folder") return "[DIR]"
  if (kind === "project") return "[PRJ]"
  return "[TASK]"
}

function nodePrefix(node: FlatNode, isExpanded: boolean): string {
  if (node.kind === "task") return `${node.completedAt ? "[x]" : "[ ]"} [TASK]`
  const disclosure = node.hasChildren ? (isExpanded ? "▾" : "▸") : "·"
  return `${disclosure} ${kindGlyph(node.kind)}`
}

function treeBranch(node: FlatNode): string {
  const ancestors = node.ancestorHasNextSibling.map((hasNext) => (hasNext ? "│  " : "   ")).join("")
  return `${ancestors}${node.isLastSibling ? "└─ " : "├─ "}`
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function progressBar(remaining: number, total: number): string {
  const width = 20
  const elapsedRatio = total === 0 ? 1 : 1 - remaining / total
  const filled = Math.max(0, Math.min(width, Math.round(elapsedRatio * width)))
  return `[${"=".repeat(filled)}${"·".repeat(width - filled)}]`
}

function toneColor(tone: StatusTone): string {
  if (tone === "success") return theme.success
  if (tone === "warning") return theme.warning
  if (tone === "danger") return theme.danger
  return theme.accent
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1)
}

function displayDataPath(path: string): string {
  const home = homedir()
  if (path === home) return "~"
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`
  return path
}

function windowItems<T>(items: T[], selectedIndex: number, capacity: number): { items: T[]; hasBefore: boolean; hasAfter: boolean } {
  if (items.length <= capacity) return { items, hasBefore: false, hasAfter: false }
  const safeIndex = clampSelection(selectedIndex, items.length)
  const start = Math.max(0, Math.min(safeIndex - Math.floor(capacity / 2), items.length - capacity))
  return {
    items: items.slice(start, start + capacity),
    hasBefore: start > 0,
    hasAfter: start + capacity < items.length,
  }
}

function buildMoveTargets(nodes: WorkNode[], movingId: string): MoveTarget[] {
  const active = nodes.filter((node) => node.trashedAt === null)
  const descendants = new Set<string>([movingId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of active) {
      if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
        descendants.add(node.id)
        changed = true
      }
    }
  }

  const byId = new Map(active.map((node) => [node.id, node]))
  const pathFor = (node: WorkNode): string => {
    const parts = [node.title]
    const seen = new Set([node.id])
    let parentId = node.parentId
    while (parentId) {
      if (seen.has(parentId)) break
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      parts.unshift(parent.title)
      parentId = parent.parentId
    }
    return parts.join(" / ")
  }

  return [
    { id: null, label: "/ root" },
    ...active
      .filter((node) => !descendants.has(node.id))
      .sort((left, right) => pathFor(left).localeCompare(pathFor(right)))
      .map((node) => ({ id: node.id, label: `${kindGlyph(node.kind)} ${pathFor(node)}` })),
  ]
}
