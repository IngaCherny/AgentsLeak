import { useCallback, useEffect, useState, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  MarkerType,
  Panel,
  ConnectionMode,
  EdgeMouseHandler,
} from 'reactflow';
import { Loader2, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDarkMode } from '@/lib/useDarkMode';
import { apiClient } from '@/api/client';
import type { Graph, GraphNode as ApiGraphNode, GraphEdge as ApiGraphEdge } from '@/api/types';
import SessionNode, { SessionNodeData } from './custom-nodes/SessionNode';
import FileNode, { FileNodeData, FileRisk } from './custom-nodes/FileNode';
import ProcessNode, { ProcessNodeData } from './custom-nodes/ProcessNode';
import DomainNode, { DomainNodeData } from './custom-nodes/DomainNode';
import ToolNode, { ToolNodeData, TOOL_RISK } from './custom-nodes/ToolNode';
import CommandGroupNode, { CommandGroupNodeData } from './custom-nodes/CommandGroupNode';
import DirectoryNode, { DirectoryNodeData } from './custom-nodes/DirectoryNode';
import UserNode, { UserNodeData } from './custom-nodes/UserNode';
import { useCollapsibleGraph } from './useCollapsibleGraph';

const nodeTypes = {
  session: SessionNode,
  file: FileNode,
  process: ProcessNode,
  domain: DomainNode,
  tool: ToolNode,
  command_group: CommandGroupNode,
  directory_cluster: DirectoryNode,
  user: UserNode,
};

export type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d';

interface GlobalGraphProps {
  timeRange: TimeRange;
  className?: string;
  showMinimap?: boolean;
  endpoint?: string;
  source?: string;
}

function getFileRisk(path: string): FileRisk {
  const lower = path.toLowerCase();
  if (/\.(pem|key|p12|pfx)$/.test(lower) || /id_rsa|id_ed25519/.test(lower) || /ssh.*key/.test(lower)) return 'critical';
  if (/\.env/.test(lower) || /secrets?\./.test(lower) || /credentials/.test(lower) || /password/.test(lower)) return 'high';
  if (/config\.(json|ya?ml|toml)/.test(lower) || /\.conf$/.test(lower)) return 'medium';
  if (/node_modules|\.git\//.test(lower)) return 'low';
  return 'none';
}

function isSensitiveFile(path: string): boolean {
  const risk = getFileRisk(path);
  return risk === 'critical' || risk === 'high';
}

function relationToOp(relation: string): 'read' | 'write' | 'delete' {
  if (relation === 'writes' || relation === 'creates' || relation === 'modifies') return 'write';
  if (relation === 'deletes') return 'delete';
  return 'read';
}

function edgeColor(relation: string, isDark: boolean): string {
  switch (relation) {
    case 'reads': return isDark ? '#666666' : '#C8C8C8';
    case 'writes': case 'creates': case 'modifies': return isDark ? '#a0a0a0' : '#1A1A1A';
    case 'deletes': return '#D90429';
    case 'executes': case 'spawns': return isDark ? '#888888' : '#8B8B8B';
    case 'connects_to': case 'fetches': return '#C4516C';
    case 'uses': case 'invokes': return isDark ? '#888888' : '#525252';
    default: return isDark ? '#666666' : '#C8C8C8';
  }
}

function edgeOpacity(count: number): number {
  return Math.min(0.4 + count * 0.15, 1);
}

function getTimeRangeDate(timeRange: TimeRange): string | undefined {
  const now = new Date();
  switch (timeRange) {
    case '1h': return new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    case '6h': return new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    case '24h': return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    case '7d': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case '30d': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
}

/** Transform API data to raw ReactFlow nodes + edges (no layout). */
function transformApiData(data: { nodes: ApiGraphNode[]; edges: ApiGraphEdge[] }, isDark = false) {
  const rfNodes: Node[] = data.nodes.map((n: ApiGraphNode) => {
    switch (n.node_type) {
      case 'session':
        return {
          id: n.id,
          type: 'session',
          position: { x: 0, y: 0 },
          data: {
            sessionId: n.value,
            projectName: n.label,
            status: 'active',
            eventCount: n.access_count,
            alertCount: n.alert_count,
            sessionSource: n.color || undefined,
          } as SessionNodeData,
        };
      case 'file':
        return {
          id: n.id,
          type: 'file',
          position: { x: 0, y: 0 },
          data: {
            fileName: n.label,
            fullPath: n.value,
            risk: getFileRisk(n.value),
            isSensitive: isSensitiveFile(n.value),
            operations: ['read'],
          } as FileNodeData,
        };
      case 'directory':
        if (n.id.startsWith('dir:')) {
          return {
            id: n.id,
            type: 'directory_cluster',
            position: { x: 0, y: 0 },
            data: {
              dirPath: n.value,
              fileCount: Math.round(n.size / 1.5) || 1,
              accessCount: n.access_count,
              alertCount: n.alert_count,
            } as DirectoryNodeData,
          };
        }
        return {
          id: n.id,
          type: 'file',
          position: { x: 0, y: 0 },
          data: {
            fileName: n.label,
            fullPath: n.value,
            risk: getFileRisk(n.value),
            isSensitive: isSensitiveFile(n.value),
            operations: ['read'],
          } as FileNodeData,
        };
      case 'command':
        return {
          id: n.id,
          type: 'command_group',
          position: { x: 0, y: 0 },
          data: {
            command: n.label,
            accessCount: n.access_count,
            alertCount: n.alert_count,
          } as CommandGroupNodeData,
        };
      case 'process':
        return {
          id: n.id,
          type: 'process',
          position: { x: 0, y: 0 },
          data: {
            command: n.label,
            fullCommand: n.value,
            isBlocked: false,
            isRunning: false,
          } as ProcessNodeData,
        };
      case 'url':
      case 'network':
      case 'ip_address':
        return {
          id: n.id,
          type: 'domain',
          position: { x: 0, y: 0 },
          data: {
            domain: n.label,
            isExternal: true,
            isSuspicious: n.alert_count > 0,
            requestCount: n.access_count,
            protocols: ['https'],
          } as DomainNodeData,
        };
      case 'tool':
        return {
          id: n.id,
          type: 'tool',
          position: { x: 0, y: 0 },
          data: {
            toolName: n.label,
            risk: TOOL_RISK[n.label] || 'low',
            accessCount: n.access_count,
            alertCount: n.alert_count,
          } as ToolNodeData,
        };
      case 'user':
        return {
          id: n.id,
          type: 'user',
          position: { x: 0, y: 0 },
          data: {
            label: n.label,
            sessionCount: n.access_count,
            alertCount: n.alert_count,
          } as UserNodeData,
        };
      default:
        return {
          id: n.id,
          type: 'process',
          position: { x: 0, y: 0 },
          data: {
            command: n.label,
            fullCommand: n.value,
            isBlocked: false,
            isRunning: false,
          } as ProcessNodeData,
        };
    }
  });

  // Update file operations based on edges
  const fileOpsMap: Record<string, Set<'read' | 'write' | 'delete'>> = {};
  data.edges.forEach((e: ApiGraphEdge) => {
    const targetNode = data.nodes.find(n => n.id === e.target_id);
    if (targetNode && (targetNode.node_type === 'file' || targetNode.node_type === 'directory')) {
      if (!fileOpsMap[e.target_id]) fileOpsMap[e.target_id] = new Set();
      fileOpsMap[e.target_id].add(relationToOp(e.relation));
    }
  });
  rfNodes.forEach(n => {
    if (n.type === 'file' && fileOpsMap[n.id]) {
      (n.data as FileNodeData).operations = Array.from(fileOpsMap[n.id]);
    }
  });

  // Create styled edges
  const rfEdges: Edge[] = data.edges.map((e: ApiGraphEdge) => {
    const color = edgeColor(e.relation, isDark);
    const isDanger = e.relation === 'deletes' || e.relation === 'connects_to';
    const opacity = edgeOpacity(e.count);
    return {
      id: e.id,
      source: e.source_id,
      target: e.target_id,
      label: e.relation.replace(/_/g, ' '),
      data: { relation: e.relation, count: e.count },
      style: {
        stroke: color,
        strokeWidth: Math.min(1.5 + e.count * 0.5, 4),
        strokeDasharray: ['reads', 'connects_to', 'fetches'].includes(e.relation) ? '6,4' : undefined,
        opacity,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 16,
        height: 12,
      },
      animated: isDanger,
      labelStyle: { fill: color, fontSize: 8, fontFamily: 'JetBrains Mono, monospace', fontWeight: 500 },
      labelBgStyle: { fill: isDark ? '#161616' : '#FFFFFF', fillOpacity: isDark ? 0.9 : 0.85 },
      labelBgPadding: [3, 1.5] as [number, number],
    };
  });

  return { nodes: rfNodes, edges: rfEdges };
}

/** Auto-zoom to fit all visible nodes after collapse/expand. */
function FitViewOnChange({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow();
  const isInitial = useRef(true);

  useEffect(() => {
    if (isInitial.current) {
      isInitial.current = false;
      return;
    }
    const t = setTimeout(() => fitView({ padding: 0.35, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [nodeCount, fitView]);

  return null;
}

function GlobalGraphInner({ timeRange, className, showMinimap = true, endpoint, source }: GlobalGraphProps) {
  const isDark = useDarkMode();
  const [rawNodes, setRawNodes] = useState<Node[]>([]);
  const [rawEdges, setRawEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Graph['stats'] | null>(null);
  const [apiData, setApiData] = useState<{ nodes: ApiGraphNode[]; edges: ApiGraphEdge[] } | null>(null);

  // Collapsible graph — start collapsed for cleaner view
  const { nodes: visibleNodes, edges: visibleEdges, toggleCollapse } =
    useCollapsibleGraph(rawNodes, rawEdges, { defaultCollapsed: true });

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const allEdgesRef = useRef<Edge[]>([]);

  // Sync collapsible output to ReactFlow
  useEffect(() => {
    if (visibleNodes.length > 0 || rawNodes.length === 0) {
      setNodes(visibleNodes);
      setEdges(visibleEdges);
      allEdgesRef.current = visibleEdges;
    }
  }, [visibleNodes, visibleEdges, setNodes, setEdges, rawNodes.length]);

  useEffect(() => {
    async function fetchGraphData() {
      setLoading(true);
      setError(null);

      try {
        const startDate = getTimeRangeDate(timeRange);
        const data = await apiClient.fetchGlobalGraph(startDate, undefined, endpoint, source);
        setApiData(data);
        const { nodes: transformedNodes, edges: styledEdges } = transformApiData(data, isDark);

        setRawNodes(transformedNodes);
        setRawEdges(styledEdges);
        setStats(data.stats);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load graph');
      } finally {
        setLoading(false);
      }
    }

    fetchGraphData();
  }, [timeRange, isDark, endpoint, source]);

  // Re-transform edges when dark mode toggles
  useEffect(() => {
    if (apiData) {
      const { edges: styledEdges } = transformApiData(apiData, isDark);
      setRawEdges(styledEdges);
    }
  }, [isDark, apiData]);

  // Highlight edge on hover, fade others
  const onEdgeMouseEnter: EdgeMouseHandler = useCallback((_evt, edge) => {
    setEdges((eds) =>
      eds.map((e) =>
        e.id === edge.id
          ? { ...e, label: `${(e.data?.relation ?? '').replace(/_/g, ' ')} (x${e.data?.count ?? 1})`, style: { ...e.style, opacity: 1, strokeWidth: Math.min(2.5 + (e.data?.count ?? 1) * 0.5, 5) } }
          : { ...e, style: { ...e.style, opacity: 0.12 } }
      )
    );
  }, [setEdges]);

  const onEdgeMouseLeave: EdgeMouseHandler = useCallback(() => {
    setEdges(allEdgesRef.current);
  }, [setEdges]);

  // Node click: toggle collapse or show details
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.data._hasChildren) {
      toggleCollapse(node.id);
    }
  }, [toggleCollapse]);

  const minimapNodeColor = useCallback((node: Node) => {
    const defaultColor = isDark ? '#555555' : '#1A1A1A';
    switch (node.type) {
      case 'session': return '#D90429';
      case 'tool': {
        const risk = (node.data as ToolNodeData)?.risk;
        if (risk === 'critical') return '#D90429';
        if (risk === 'high') return '#C4516C';
        return defaultColor;
      }
      case 'user': return '#1A1A1A';
      case 'command_group': return '#A0A0A0';
      case 'file': return defaultColor;
      case 'process': return '#8B8B8B';
      case 'domain': return '#C4516C';
      default: return defaultColor;
    }
  }, [isDark]);

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center bg-[#F0F0F0] dark:bg-[#111111] h-full min-h-[500px]', className)}>
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-carbon animate-spin mx-auto mb-2" />
          <p className="opacity-50 text-sm">Loading global graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center bg-[#F0F0F0] dark:bg-[#111111] h-full min-h-[500px]', className)}>
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-carbon mx-auto mb-2" />
          <p className="text-carbon/70 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className={cn('flex items-center justify-center bg-[#F0F0F0] dark:bg-[#111111] h-full min-h-[500px]', className)}>
        <div className="text-center">
          <Info className="w-8 h-8 opacity-40 mx-auto mb-2" />
          <p className="opacity-50 text-sm">No graph data in the selected time range</p>
          <p className="opacity-40 text-xs mt-1">Events will build the graph as agents run</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative bg-[#F0F0F0] dark:bg-[#111111] overflow-hidden h-full min-h-[500px]', className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.35 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} color={isDark ? '#2a2a2a' : '#cccccc'} />
        <FitViewOnChange nodeCount={nodes.length} />
        <Controls showInteractive={false} />
        {showMinimap && (
          <MiniMap nodeColor={minimapNodeColor} maskColor={isDark ? 'rgba(10, 10, 10, 0.85)' : 'rgba(240, 240, 240, 0.8)'} style={{ borderRadius: 12, overflow: 'hidden' }} />
        )}

        {/* Stats Panel */}
        {stats && stats.total_nodes > 0 && (
          <Panel position="top-left" className="!m-3">
            <div className="bg-white/80 backdrop-blur-md rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.03),0_4px_16px_rgba(0,0,0,0.05)] px-3 py-2">
              <div className="text-[10px] font-mono opacity-40">
                {stats.total_nodes} nodes &middot; {stats.total_edges} edges
              </div>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

export default function GlobalGraph(props: GlobalGraphProps) {
  return (
    <ReactFlowProvider>
      <GlobalGraphInner {...props} />
    </ReactFlowProvider>
  );
}
