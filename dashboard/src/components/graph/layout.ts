import { Node, Edge } from 'reactflow';
import dagre from 'dagre';

// Node dimensions for dagre layout
export const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  session: { width: 110, height: 110 },
  user: { width: 110, height: 110 },
  tool: { width: 150, height: 48 },
  command_group: { width: 130, height: 40 },
  file: { width: 160, height: 44 },
  directory_cluster: { width: 170, height: 48 },
  process: { width: 160, height: 44 },
  domain: { width: 150, height: 44 },
};

/**
 * Find connected components in a graph using BFS.
 * Returns array of node-id sets, one per component.
 */
function findConnectedComponents(nodes: Node[], edges: Edge[]): Set<string>[] {
  const adj: Record<string, Set<string>> = {};
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Build adjacency list (undirected)
  for (const n of nodes) adj[n.id] = new Set();
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      adj[e.source].add(e.target);
      adj[e.target].add(e.source);
    }
  }

  const visited = new Set<string>();
  const components: Set<string>[] = [];

  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const component = new Set<string>();
    const queue = [n.id];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      component.add(cur);
      for (const neighbor of adj[cur]) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    components.push(component);
  }

  return components;
}

/**
 * Layout a single connected subgraph with dagre (LR).
 * Returns positioned nodes and the bounding box dimensions.
 */
function layoutSubgraph(
  nodes: Node[],
  edges: Edge[]
): { nodes: Node[]; width: number; height: number } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 100, edgesep: 20 });

  nodes.forEach((node) => {
    const dim = NODE_DIMENSIONS[node.type || 'process'];
    g.setNode(node.id, { width: dim.width, height: dim.height });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const positioned = nodes.map((node) => {
    const pos = g.node(node.id);
    const dim = NODE_DIMENSIONS[node.type || 'process'];
    const x = pos.x - dim.width / 2;
    const y = pos.y - dim.height / 2;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + dim.width);
    maxY = Math.max(maxY, y + dim.height);
    return { ...node, position: { x, y } };
  });

  // Normalize to 0,0 origin
  const normalized = positioned.map((n) => ({
    ...n,
    position: { x: n.position.x - minX, y: n.position.y - minY },
  }));

  return {
    nodes: normalized,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Smart layout that handles disconnected graphs:
 * - Connected components are laid out with dagre LR individually
 * - Isolated nodes (no edges) are arranged in a compact grid
 * - Components are arranged top-to-bottom, orphan grid to the right
 */
export function layoutGraph(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [{ ...nodes[0], position: { x: 0, y: 0 } }];
  }

  const components = findConnectedComponents(nodes, edges);

  // Separate into connected subgraphs (2+ nodes) and orphans (single nodes)
  const connectedComponents: Set<string>[] = [];
  const orphanIds: string[] = [];

  for (const comp of components) {
    if (comp.size === 1) {
      orphanIds.push([...comp][0]);
    } else {
      connectedComponents.push(comp);
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const allPositioned: Node[] = [];
  let currentY = 0;
  let maxComponentWidth = 0;
  const COMPONENT_GAP = 80;

  // Layout each connected component with dagre
  for (const comp of connectedComponents) {
    const compNodes = [...comp].map((id) => nodeMap.get(id)!).filter(Boolean);
    const compEdges = edges.filter(
      (e) => comp.has(e.source) && comp.has(e.target)
    );

    const result = layoutSubgraph(compNodes, compEdges);

    // Offset by currentY
    for (const n of result.nodes) {
      allPositioned.push({
        ...n,
        position: { x: n.position.x, y: n.position.y + currentY },
      });
    }

    maxComponentWidth = Math.max(maxComponentWidth, result.width);
    currentY += result.height + COMPONENT_GAP;
  }

  // Layout orphan nodes in a grid to the right of connected components
  if (orphanIds.length > 0) {
    const GRID_COLS = Math.max(3, Math.ceil(Math.sqrt(orphanIds.length)));
    const CELL_W = 180;
    const CELL_H = 70;
    const gridStartX = connectedComponents.length > 0 ? maxComponentWidth + 150 : 0;
    const gridStartY = 0;

    orphanIds.forEach((id, i) => {
      const node = nodeMap.get(id);
      if (!node) return;
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      allPositioned.push({
        ...node,
        position: {
          x: gridStartX + col * CELL_W,
          y: gridStartY + row * CELL_H,
        },
      });
    });
  }

  return allPositioned;
}
