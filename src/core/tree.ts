import type { FlatNode, WorkNode } from "./types.ts"

export function flattenVisibleTree(nodes: WorkNode[], expanded: ReadonlySet<string>): FlatNode[] {
  const active = nodes.filter((node) => node.trashedAt === null)
  const children = new Map<string | null, WorkNode[]>()

  for (const node of active) {
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }

  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.position - right.position || left.createdAt - right.createdAt)
  }

  const result: FlatNode[] = []
  const visited = new Set<string>()

  const visit = (
    node: WorkNode,
    depth: number,
    ancestorHasNextSibling: boolean[],
    isLastSibling: boolean,
  ): void => {
    if (visited.has(node.id)) return
    visited.add(node.id)

    const descendants = children.get(node.id) ?? []
    result.push({
      ...node,
      depth,
      hasChildren: descendants.length > 0,
      isLastSibling,
      ancestorHasNextSibling,
    })
    if (!expanded.has(node.id)) return

    descendants.forEach((child, index) => {
      visit(
        child,
        depth + 1,
        [...ancestorHasNextSibling, !isLastSibling],
        index === descendants.length - 1,
      )
    })
  }

  const roots = children.get(null) ?? []
  roots.forEach((root, index) => visit(root, 0, [], index === roots.length - 1))

  return result
}

export function clampSelection(index: number, length: number): number {
  if (length === 0) return 0
  return Math.max(0, Math.min(index, length - 1))
}
