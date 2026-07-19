import { expect, test } from "bun:test"
import type { WorkNode } from "../src/core/types.ts"
import { flattenVisibleTree } from "../src/core/tree.ts"

function node(id: string, parentId: string | null, position: number): WorkNode {
  return {
    id,
    parentId,
    position,
    kind: "task",
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
