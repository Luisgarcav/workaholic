import { expect, test } from "bun:test"
import type { NodeKind, WorkNode } from "../src/core/types.ts"
import { flattenVisibleTree } from "../src/core/tree.ts"

function node(id: string, parentId: string | null, position: number, kind: NodeKind = "task"): WorkNode {
  return {
    id,
    parentId,
    position,
    kind,
    title: id,
    content: "",
    completedAt: null,
    trashRootId: null,
    trashedAt: null,
    createdAt: position,
    updatedAt: position,
  }
}

test("flattens only expanded branches and preserves order", () => {
  const nodes = [node("root-b", null, 2), node("child", "root-a", 0), node("root-a", null, 1)]
  const collapsed = flattenVisibleTree(nodes, new Set())
  const expanded = flattenVisibleTree(nodes, new Set(["root-a"]))

  expect(collapsed.map((item) => item.id)).toEqual(["root-a", "root-b"])
  expect(expanded.map((item) => [item.id, item.depth])).toEqual([
    ["root-a", 0],
    ["child", 1],
    ["root-b", 0],
  ])
  expect(expanded.map((item) => [item.id, item.isLastSibling, item.ancestorHasNextSibling])).toEqual([
    ["root-a", false, []],
    ["child", true, [true]],
    ["root-b", true, []],
  ])
})

test("ignores items moved to Trash", () => {
  const trashed = { ...node("trash", null, 0), trashedAt: 1, trashRootId: "trash" }
  expect(flattenVisibleTree([trashed], new Set())).toEqual([])
})

test("sorts every level as directories, projects, then tasks", () => {
  const nodes = [
    node("root-task", null, 0, "task"),
    node("root-folder", null, 5, "folder"),
    node("folder-task", "root-folder", 0, "task"),
    node("folder-project", "root-folder", 5, "project"),
    node("nested-folder", "root-folder", 9, "folder"),
  ]

  expect(flattenVisibleTree(nodes, new Set(["root-folder"])).map((item) => item.id)).toEqual([
    "root-folder",
    "nested-folder",
    "folder-project",
    "folder-task",
    "root-task",
  ])
})
