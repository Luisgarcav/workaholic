export const NODE_KINDS = ["folder", "project", "task"] as const

export type NodeKind = (typeof NODE_KINDS)[number]

export const NODE_KIND_ORDER: readonly NodeKind[] = ["folder", "project", "task"]

const ALLOWED_CHILD_KINDS: Record<NodeKind, readonly NodeKind[]> = {
  folder: ["folder", "project", "task"],
  project: ["task"],
  task: ["task"],
}

export function allowedChildKinds(parentKind: NodeKind | null): readonly NodeKind[] {
  return parentKind === null ? ["folder", "task"] : ALLOWED_CHILD_KINDS[parentKind]
}

export function canNestNode(kind: NodeKind, parentKind: NodeKind | null): boolean {
  return allowedChildKinds(parentKind).includes(kind)
}

export function nodeKindRank(kind: NodeKind): number {
  return NODE_KIND_ORDER.indexOf(kind)
}

export interface WorkNode {
  id: string
  parentId: string | null
  kind: NodeKind
  title: string
  content: string
  completedAt: number | null
  position: number
  trashRootId: string | null
  trashedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface FlatNode extends WorkNode {
  depth: number
  hasChildren: boolean
  isLastSibling: boolean
  ancestorHasNextSibling: boolean[]
}

export interface TrashRoot extends WorkNode {
  descendantCount: number
}

export type TimerMode = "work" | "break"
export type TimerStatus = "running" | "paused" | "completed" | "cancelled"

export interface TimerSession {
  id: string
  taskId: string | null
  taskTitle: string | null
  mode: TimerMode
  status: TimerStatus
  durationSeconds: number
  remainingSeconds: number
  startedAt: number
  targetEndAt: number | null
  completedAt: number | null
  cancelledAt: number | null
}

export interface PomodoroSettings {
  workMinutes: number
  breakMinutes: number
}

export interface DashboardStats {
  openTasks: number
  completedTasks: number
  workSessionsToday: number
}

export class DomainError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "INVALID_TITLE"
      | "INVALID_CONTENT"
      | "INVALID_SETTINGS"
      | "INVALID_PARENT"
      | "INVALID_KIND"
      | "CYCLE"
      | "ACTIVE_TIMER"
      | "NO_ACTIVE_TIMER"
      | "NOT_TRASH_ROOT",
    message: string,
  ) {
    super(message)
    this.name = "DomainError"
  }
}
