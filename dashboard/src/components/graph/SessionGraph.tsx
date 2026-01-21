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
  ConnectionMode,
  EdgeMouseHandler,
} from 'reactflow';
import { Loader2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDarkMode } from '@/lib/useDarkMode';
import { apiClient } from '@/api/client';
import type { GraphNode as ApiGraphNode, GraphEdge as ApiGraphEdge } from '@/api/types';
import SessionNode, { SessionNodeData } from './custom-nodes/SessionNode';
import FileNode, { FileNodeData, FileRisk } from './custom-nodes/FileNode';
import ProcessNode, { ProcessNodeData } from './custom-nodes/ProcessNode';
import DomainNode, { DomainNodeData } from './custom-nodes/DomainNode';
import ToolNode, { ToolNodeData, TOOL_RISK } from './custom-nodes/ToolNode';
import CommandGroupNode, { CommandGroupNodeData } from './custom-nodes/CommandGroupNode';
import DirectoryNode, { DirectoryNodeData } from './custom-nodes/DirectoryNode';
import UserNode, { UserNodeData } from './custom-nodes/UserNode';
import TimeWindowSlider from './TimeWindowSlider';
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

interface NodeDetails {
  type: string;
  data: Record<string, unknown>;
}

interface SessionGraphProps {
  sessionId: string;
  className?: string;
  compact?: boolean;
  showMinimap?: boolean;
}

// Detect sensitive file patterns
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

// Edge opacity scaled by count (more frequent = more opaque)
function edgeOpacity(count: number): number {
  return Math.min(0.4 + count * 0.15, 1);
}

/** Transform API data to raw ReactFlow nodes + edges (no layout). */
function transformApiData(
  data: { nodes: ApiGraphNode[]; edges: ApiGraphEdge[] },
  sessionId: string,
  isDark = false,
) {
  const apiSessionNode = data.nodes.find((n) => n.node_type === 'session');

  const sessionNode: Node<SessionNodeData> = {
    id: apiSessionNode?.id ?? `session-${sessionId}`,
    type: 'session',
    position: { x: 0, y: 0 },
    data: {
      sessionId: apiSessionNode?.value ?? sessionId,
      projectName: apiSessionNode?.label ?? sessionId,
      status: 'active',
      eventCount: apiSessionNode?.access_count ?? 0,
      alertCount: apiSessionNode?.alert_count ?? 0,
      sessionSource: apiSessionNode?.color || undefined,
    },
  };

  const otherApiNodes = data.nodes.filter(
    (n) => n.id !== sessionNode.id
  );

  const otherNodes: Node[] = otherApiNodes.map((n) => {
    switch (n.node_type) {
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
        // Check if this is a cluster node (id starts with "dir:")
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
  data.edges.forEach((e) => {
    const targetNode = data.nodes.find((n) => n.id === e.target_id);
    if (targetNode && (targetNode.node_type === 'file' || targetNode.node_type === 'directory')) {
      if (!fileOpsMap[e.target_id]) fileOpsMap[e.target_id] = new Set();
      fileOpsMap[e.target_id].add(relationToOp(e.relation));
    }
  });
  otherNodes.forEach((n) => {
    if (n.type === 'file' && fileOpsMap[n.id]) {
      (n.data as FileNodeData).operations = Array.from(fileOpsMap[n.id]);
    }
  });

  // Create styled edges
  const styledEdges: Edge[] = data.edges.map((e) => {
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

  return { nodes: [sessionNode, ...otherNodes], edges: styledEdges };
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

function SessionGraphInner({
  sessionId,
  className,
  compact = false,
  showMinimap = true,
}: SessionGraphProps) {
  const isDark = useDarkMode();
  // Raw (unlayouted) nodes and edges from API
  const [rawNodes, setRawNodes] = useState<Node[]>([]);
  const [rawEdges, setRawEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeDetails | null>(null);
  const [timeRange, setTimeRange] = useState<{ min: string; max: string } | null>(null);
  const [fromDate, setFromDate] = useState<string | undefined>();
  const [toDate, setToDate] = useState<string | undefined>();
  const [apiData, setApiData] = useState<{ nodes: ApiGraphNode[]; edges: ApiGraphEdge[] } | null>(null);
  const initialLoadDone = useRef(false);

  // Collapsible graph — handles layout + expand/collapse
  // Start collapsed so graph is clean; user clicks to drill down
  const { nodes: visibleNodes, edges: visibleEdges, toggleCollapse } =
    useCollapsibleGraph(rawNodes, rawEdges, { defaultCollapsed: true });

  // ReactFlow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const allEdgesRef = useRef<Edge[]>([]);

  // Sync collapsible graph output to ReactFlow state
  useEffect(() => {
    if (visibleNodes.length > 0 || rawNodes.length === 0) {
      setNodes(visibleNodes);
      setEdges(visibleEdges);
      allEdgesRef.current = visibleEdges;
    }
  }, [visibleNodes, visibleEdges, setNodes, setEdges, rawNodes.length]);

  // Time window change handler
  const handleTimeChange = useCallback((from: string | undefined, to: string | undefined) => {
    setFromDate(from);
    setToDate(to);
  }, []);

  // Fetch data
  useEffect(() => {
    let keepLoading = false;

    async function fetchGraphData() {
      if (!initialLoadDone.current) {
        setLoading(true);
      } else {
        setFiltering(true);
      }
      setError(null);

      try {
        const data = await apiClient.fetchSessionGraph(sessionId, {
          cluster_dirs: true,
          from_date: fromDate,
          to_date: toDate,
        });
        setApiData(data);

        // First fetch: get time_range and apply default 5m filter before rendering
        if (!initialLoadDone.current && data.time_range) {
          setTimeRange(data.time_range);
          const maxMs = new Date(data.time_range.max).getTime();
          const minMs = new Date(data.time_range.min).getTime();
          // If session spans more than 5m, apply filter — don't render full graph
          if (maxMs - minMs > 5 * 60 * 1000) {
            initialLoadDone.current = true;
            keepLoading = true;
            setFromDate(new Date(maxMs - 5 * 60 * 1000).toISOString());
            return; // re-fetch will fire with the filter applied
          }
        }

        const { nodes: transformedNodes, edges: styledEdges } =
          transformApiData(data, sessionId, isDark);

        setRawNodes(transformedNodes);
        setRawEdges(styledEdges);
        initialLoadDone.current = true;
      } catch (err) {
        console.error('Graph fetch error:', err);
        if (!initialLoadDone.current) {
          setError(err instanceof Error ? err.message : 'Failed to load graph');
        }
        // On filter errors, just keep showing the previous graph
      } finally {
        if (!keepLoading) {
          setLoading(false);
        }
        setFiltering(false);
      }
    }

    if (sessionId) {
      fetchGraphData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- apiData and sessionId are set inside this effect
  }, [sessionId, fromDate, toDate]);

  // Re-transform edges when dark mode toggles (preserves node collapse state)
  useEffect(() => {
    if (apiData) {
      const { edges: styledEdges } = transformApiData(apiData, sessionId, isDark);
      setRawEdges(styledEdges);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on dark mode toggle
  }, [isDark]);

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

  // Node click: toggle collapse if has children, else show details
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.data._hasChildren) {
      toggleCollapse(node.id);
    } else {
      setSelectedNode({
        type: node.type || 'unknown',
        data: node.data,
      });
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
      case 'directory_cluster': return '#8B8B8B';
      case 'process': return '#8B8B8B';
      case 'domain': return '#C4516C';
      default: return defaultColor;
    }
  }, [isDark]);

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center bg-[#F0F0F0] dark:bg-[#111111]', compact ? 'h-64' : 'h-full min-h-[500px]', className)}>
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-carbon animate-spin mx-auto mb-2" />
          <p className="opacity-50 text-sm">Loading graph...</p>
        </div>
      </div>
    );
  }

  if (error && !initialLoadDone.current) {
    return (
      <div className={cn('flex items-center justify-center bg-[#F0F0F0] dark:bg-[#111111]', compact ? 'h-64' : 'h-full min-h-[500px]', className)}>
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-carbon mx-auto mb-2" />
          <p className="text-carbon/70 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className={cn('flex items-center justify-center bg-[#F0F0F0] dark:bg-[#111111]', compact ? 'h-64' : 'h-full min-h-[500px]', className)}>
        <div className="text-center">
          <Info className="w-8 h-8 opacity-40 mx-auto mb-2" />
          <p className="opacity-50 text-sm">No activity data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative bg-[#F0F0F0] dark:bg-[#111111] overflow-hidden flex flex-col', compact ? 'h-64' : 'h-full min-h-[500px]', className)}>
      {/* Time Window Slider */}
      {!compact && timeRange && (
        <TimeWindowSlider
          min={timeRange.min}
          max={timeRange.max}
          onChange={handleTimeChange}
          defaultPreset="5m"
        />
      )}
      <div className="flex-1 relative">
      {/* Filtering overlay */}
      {filtering && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#F0F0F0] dark:bg-[#111111]/60 pointer-events-none">
          <div className="flex items-center gap-2 bg-white rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.03),0_4px_16px_rgba(0,0,0,0.05)] px-4 py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs font-mono">Filtering...</span>
          </div>
        </div>
      )}
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
        {!compact && (
          <>
            <Controls showInteractive={false} />
            {showMinimap && (
              <MiniMap nodeColor={minimapNodeColor} maskColor={isDark ? 'rgba(10, 10, 10, 0.85)' : 'rgba(240, 240, 240, 0.8)'} style={{ borderRadius: 12, overflow: 'hidden' }} />
            )}
          </>
        )}

      </ReactFlow>
      </div>

      {/* Node Details Panel */}
      {selectedNode && !compact && (
        <div className="absolute top-4 right-4 w-72 bg-white rounded-2xl shadow-[0_2px_6px_rgba(0,0,0,0.06),0_16px_48px_rgba(0,0,0,0.12)] overflow-hidden">
          <div className="p-3 border-b border-carbon/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-[6px] bg-carbon/[0.08] flex items-center justify-center">
                <span className="text-[10px] font-mono font-bold opacity-50 uppercase">
                  {selectedNode.type.slice(0, 2)}
                </span>
              </div>
              <h4 className="font-display font-medium text-carbon text-sm capitalize">
                {selectedNode.type}
              </h4>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="opacity-40 hover:text-alert-red"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-3 max-h-80 overflow-y-auto">
            <pre className="text-[11px] font-mono opacity-60 whitespace-pre-wrap break-all">
              {JSON.stringify(
                Object.fromEntries(
                  Object.entries(selectedNode.data).filter(([k]) => !k.startsWith('_'))
                ),
                null,
                2
              )}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SessionGraph(props: SessionGraphProps) {
  return (
    <ReactFlowProvider>
      <SessionGraphInner {...props} />
    </ReactFlowProvider>
  );
}
