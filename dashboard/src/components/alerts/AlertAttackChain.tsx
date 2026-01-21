import { useState, useMemo, useCallback } from 'react';
import ReactFlow, {
  type Node,
  type Edge,
  MarkerType,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
} from 'reactflow';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useAlertGraph } from '@/api/queries';
import type { AlertGraphNode, AlertGraphEdge } from '@/api/types';
import { layoutGraph } from '@/components/graph/layout';

// Reuse the same custom node components as the session graph
import SessionNode, { type SessionNodeData } from '@/components/graph/custom-nodes/SessionNode';
import FileNode, { type FileNodeData } from '@/components/graph/custom-nodes/FileNode';
import ProcessNode, { type ProcessNodeData } from '@/components/graph/custom-nodes/ProcessNode';
import DomainNode, { type DomainNodeData } from '@/components/graph/custom-nodes/DomainNode';
import ToolNode, { type ToolNodeData, TOOL_RISK } from '@/components/graph/custom-nodes/ToolNode';
import CommandGroupNode, { type CommandGroupNodeData } from '@/components/graph/custom-nodes/CommandGroupNode';
import DirectoryNode, { type DirectoryNodeData } from '@/components/graph/custom-nodes/DirectoryNode';

const nodeTypes = {
  session: SessionNode,
  file: FileNode,
  process: ProcessNode,
  domain: DomainNode,
  tool: ToolNode,
  command_group: CommandGroupNode,
  directory_cluster: DirectoryNode,
};

// ── Risk detection (same as SessionGraph) ────────────────────────────────────

type FileRisk = 'critical' | 'high' | 'medium' | 'low' | 'none';

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

// ── Edge styling (same as SessionGraph) ──────────────────────────────────────

function edgeColor(relation: string): string {
  switch (relation) {
    case 'reads': return '#C8C8C8';
    case 'writes': case 'creates': case 'modifies': return '#1A1A1A';
    case 'deletes': return '#D90429';
    case 'executes': case 'spawns': return '#8B8B8B';
    case 'connects_to': case 'fetches': return '#C4516C';
    case 'uses': case 'invokes': return '#525252';
    default: return '#C8C8C8';
  }
}

// ── Transform alert graph data → ReactFlow nodes/edges ──────────────────────

function transformAlertGraph(
  apiNodes: AlertGraphNode[],
  apiEdges: AlertGraphEdge[],
): { nodes: Node[]; edges: Edge[] } {
  // Build file operations map from edges
  const fileOpsMap: Record<string, Set<'read' | 'write' | 'delete'>> = {};
  apiEdges.forEach((e) => {
    const targetNode = apiNodes.find((n) => n.id === e.target_id);
    if (targetNode && (targetNode.node_type === 'file' || targetNode.node_type === 'directory')) {
      if (!fileOpsMap[e.target_id]) fileOpsMap[e.target_id] = new Set();
      fileOpsMap[e.target_id].add(relationToOp(e.relation));
    }
  });

  const nodes: Node[] = apiNodes.map((n) => {
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
            eventCount: 0,
            alertCount: n.alert_count,
          } as SessionNodeData,
        };
      case 'tool':
        return {
          id: n.id,
          type: 'tool',
          position: { x: 0, y: 0 },
          data: {
            toolName: n.label,
            risk: TOOL_RISK[n.label] || 'low',
            accessCount: 0,
            alertCount: n.alert_count,
          } as ToolNodeData,
        };
      case 'command':
        return {
          id: n.id,
          type: 'command_group',
          position: { x: 0, y: 0 },
          data: {
            command: n.label,
            accessCount: 0,
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
            isBlocked: !!(n.is_trigger && n.blocked),
            isRunning: false,
          } as ProcessNodeData,
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
            operations: Array.from(fileOpsMap[n.id] || new Set(['read'])),
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
              fileCount: 1,
              accessCount: 0,
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
            operations: Array.from(fileOpsMap[n.id] || new Set(['read'])),
          } as FileNodeData,
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
            isSuspicious: n.is_trigger || n.alert_count > 0,
            requestCount: 0,
            protocols: ['https'],
          } as DomainNodeData,
        };
      default:
        return {
          id: n.id,
          type: 'process',
          position: { x: 0, y: 0 },
          data: {
            command: n.label,
            fullCommand: n.value,
            isBlocked: !!(n.is_trigger && n.blocked),
            isRunning: false,
          } as ProcessNodeData,
        };
    }
  });

  // Create styled edges (same style as session graph)
  const edges: Edge[] = apiEdges.map((e) => {
    const color = edgeColor(e.relation);
    const isDanger = e.relation === 'deletes' || e.relation === 'connects_to';
    return {
      id: e.id,
      source: e.source_id,
      target: e.target_id,
      label: e.relation.replace(/_/g, ' '),
      data: { relation: e.relation, count: 1 },
      style: {
        stroke: color,
        strokeWidth: 2,
        strokeDasharray: ['reads', 'connects_to', 'fetches'].includes(e.relation) ? '6,4' : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 16,
        height: 12,
      },
      animated: isDanger,
      labelStyle: { fill: color, fontSize: 8, fontFamily: 'JetBrains Mono, monospace', fontWeight: 500 },
      labelBgStyle: { fill: '#FFFFFF', fillOpacity: 0.85 },
      labelBgPadding: [3, 1.5] as [number, number],
    };
  });

  return { nodes, edges };
}

// ── Main component ──────────────────────────────────────────────────────────

interface AlertAttackChainProps {
  alertId: string;
  autoExpand?: boolean;
}

function AttackChainInner({ alertId }: { alertId: string }) {
  const { data, isLoading, isError } = useAlertGraph(alertId, true);

  const hasGraph = data && data.nodes.length > 0;

  const { nodes, edges } = useMemo(() => {
    if (!data || data.nodes.length === 0) return { nodes: [], edges: [] };
    const { nodes: rawNodes, edges: rawEdges } = transformAlertGraph(data.nodes, data.edges);
    const positioned = layoutGraph(rawNodes, rawEdges);
    return { nodes: positioned, edges: rawEdges };
  }, [data]);

  const onInit = useCallback((instance: { fitView: (options: { padding: number }) => void }) => {
    setTimeout(() => instance.fitView({ padding: 0.35 }), 50);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-6 h-6 animate-spin opacity-40 mx-auto mb-2" />
          <span className="text-xs font-mono opacity-40">Loading attack chain...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs font-mono text-severity-critical opacity-60">
          Failed to load attack chain
        </p>
      </div>
    );
  }

  if (!hasGraph) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs font-mono opacity-40">No graph data for this alert</p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onInit={onInit}
      fitView
      fitViewOptions={{ padding: 0.35 }}
      minZoom={0.3}
      maxZoom={1.5}
      panOnDrag
      zoomOnScroll={false}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e5e5" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function AlertAttackChain({ alertId, autoExpand = false }: AlertAttackChainProps) {
  const [expanded] = useState(autoExpand);
  const { data } = useAlertGraph(alertId, expanded);

  if (!expanded) return null;

  return (
    <div className="rounded-xl bg-paper-dark overflow-hidden">
      {/* Context banner */}
      {data && (data.blocked || data.policy_name) && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-carbon/[0.06] bg-white">
          {data.blocked && (
            <span className="flex items-center gap-1.5 text-xs font-bold text-severity-critical">
              <ShieldAlert className="w-3.5 h-3.5" />
              BLOCKED
            </span>
          )}
          {data.policy_name && (
            <span className="text-xs font-mono opacity-60">
              Policy: {data.policy_name}
            </span>
          )}
          {data.alert_severity && (
            <span className="text-[10px] font-bold font-mono uppercase bg-carbon/[0.06] border px-1.5 py-0.5">
              {data.alert_severity}
            </span>
          )}
        </div>
      )}
      <div style={{ height: 280 }}>
        <ReactFlowProvider>
          <AttackChainInner alertId={alertId} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
