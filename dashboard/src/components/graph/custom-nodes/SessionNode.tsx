import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Terminal, AlertTriangle, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sourceShortLabel } from '@/components/sessions/SessionCard';

export interface SessionNodeData {
  sessionId: string;
  projectName: string;
  status: string;
  eventCount: number;
  alertCount: number;
  sessionSource?: string;
  _collapsed?: boolean;
  _childCount?: number;
  _hasChildren?: boolean;
  _hiddenCount?: number;
}

function SessionNode({ data, selected }: NodeProps<SessionNodeData>) {
  return (
    <div
      className={cn(
        'relative w-[90px] h-[90px] rounded-full',
        'bg-risk-critical',
        'flex flex-col items-center justify-center text-center',
        'border-[3px] border-carbon shadow-brutal-lg',
        selected ? 'ring-2 ring-carbon/30' : '',
        'cursor-pointer transition-all duration-200',
        'hover:shadow-brutal-accent-lg hover:border-risk-critical'
      )}
    >
      {/* Status indicator */}
      {data.status === 'active' && (
        <div className="absolute top-0.5 right-0.5 w-3 h-3 bg-white rounded-full animate-pulse" />
      )}

      {/* Icon */}
      <Terminal className="w-5 h-5 text-white mb-1" />

      {/* Project name */}
      <div className="text-white font-mono font-bold text-[10px] leading-tight truncate max-w-[70px] px-1">
        {data.projectName || 'Session'}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 mt-0.5 text-[10px]">
        <div className="flex items-center gap-0.5 text-white/80">
          <Activity className="w-2.5 h-2.5" />
          {data.eventCount}
        </div>
        {data.alertCount > 0 && (
          <div className="flex items-center gap-0.5 text-white font-bold">
            <AlertTriangle className="w-2.5 h-2.5" />
            {data.alertCount}
          </div>
        )}
      </div>

      {/* Source label */}
      {data.sessionSource && (
        <div className="text-[7px] font-mono text-white/50 mt-0.5">
          {sourceShortLabel(data.sessionSource)}
        </div>
      )}

      {/* Collapse indicator */}
      {data._collapsed && data._hiddenCount ? (
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-white border-2 border-carbon rounded-full px-1.5 py-0 text-[10px] font-mono font-bold text-carbon shadow-sm whitespace-nowrap">
          +{data._hiddenCount}
        </div>
      ) : null}

      {/* Connection handles */}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-risk-critical !w-3 !h-3 !border-2 !border-white"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-risk-critical !w-3 !h-3 !border-2 !border-white"
      />
    </div>
  );
}

export default memo(SessionNode);
