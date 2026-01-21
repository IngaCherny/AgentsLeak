import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Node, Edge } from 'reactflow';
import { layoutGraph } from './layout';

/**
 * Hook that manages expand/collapse state for a directed graph.
 *
 * - Click a node to collapse/expand its subtree
 * - Hidden descendants are removed from layout
 * - Collapsed nodes get `_collapsed`, `_hiddenCount`, `_hasChildren` data fields
 * - When `defaultCollapsed` is true, all non-leaf nodes except the root start collapsed
 */
export function useCollapsibleGraph(
  allNodes: Node[],
  allEdges: Edge[],
  options?: { defaultCollapsed?: boolean },
) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const initialized = useRef(false);

  // Auto-collapse on first data load when defaultCollapsed is enabled
  useEffect(() => {
    if (!options?.defaultCollapsed || initialized.current || allNodes.length === 0) return;
    initialized.current = true;

    // Build parent→children map
    const childrenMap = new Map<string, string[]>();
    const hasParent = new Set<string>();
    for (const e of allEdges) {
      if (!childrenMap.has(e.source)) childrenMap.set(e.source, []);
      childrenMap.get(e.source)!.push(e.target);
      hasParent.add(e.target);
    }

    // Find root nodes (no incoming edges) — typically the session node
    const rootIds = allNodes
      .filter((n) => !hasParent.has(n.id))
      .map((n) => n.id);

    // Collapse every node that has children, EXCEPT roots
    const toCollapse = new Set<string>();
    for (const n of allNodes) {
      const children = childrenMap.get(n.id);
      if (children && children.length > 0 && !rootIds.includes(n.id)) {
        toCollapse.add(n.id);
      }
    }

    if (toCollapse.size > 0) {
      setCollapsedIds(toCollapse);
    }
  }, [allNodes, allEdges, options?.defaultCollapsed]);

  const result = useMemo(() => {
    if (allNodes.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Build parent → children map from directed edges
    const childrenMap = new Map<string, string[]>();
    for (const e of allEdges) {
      if (!childrenMap.has(e.source)) childrenMap.set(e.source, []);
      childrenMap.get(e.source)!.push(e.target);
    }

    // Collect all hidden node IDs (descendants of collapsed nodes)
    const hiddenIds = new Set<string>();
    for (const cid of collapsedIds) {
      // Only collapse if the node actually exists
      if (!childrenMap.has(cid)) continue;
      const stack = [...(childrenMap.get(cid) || [])];
      while (stack.length) {
        const id = stack.pop()!;
        if (hiddenIds.has(id)) continue;
        hiddenIds.add(id);
        for (const child of childrenMap.get(id) || []) {
          if (!hiddenIds.has(child)) stack.push(child);
        }
      }
    }

    // Filter visible nodes, augment with collapse metadata
    const visible = allNodes
      .filter((n) => !hiddenIds.has(n.id))
      .map((n) => {
        const hasChildren = childrenMap.has(n.id) && (childrenMap.get(n.id)!.length > 0);
        const isCollapsed = collapsedIds.has(n.id);
        const hiddenCount = isCollapsed ? countDescendants(n.id, childrenMap) : 0;

        return {
          ...n,
          data: {
            ...n.data,
            _collapsed: isCollapsed,
            _childCount: (childrenMap.get(n.id) || []).length,
            _hasChildren: hasChildren,
            _hiddenCount: hiddenCount,
          },
        };
      });

    // Filter edges — both endpoints must be visible
    const visEdges = allEdges.filter(
      (e) => !hiddenIds.has(e.source) && !hiddenIds.has(e.target)
    );

    // Layout only the visible nodes
    const layouted = layoutGraph(visible, visEdges);

    return { nodes: layouted, edges: visEdges };
  }, [allNodes, allEdges, collapsedIds]);

  const toggleCollapse = useCallback((nodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  return {
    nodes: result.nodes,
    edges: result.edges,
    collapsedIds,
    toggleCollapse,
  };
}

/** Count all descendants of a node recursively. */
function countDescendants(
  nodeId: string,
  childrenMap: Map<string, string[]>
): number {
  let count = 0;
  const stack = [...(childrenMap.get(nodeId) || [])];
  const visited = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    count++;
    for (const child of childrenMap.get(id) || []) {
      if (!visited.has(child)) stack.push(child);
    }
  }
  return count;
}
