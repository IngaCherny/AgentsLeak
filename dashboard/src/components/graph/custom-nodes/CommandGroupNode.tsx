import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ChevronRight, ChevronDown, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CommandGroupNodeData {
  command: string;
  accessCount: number;
  alertCount: number;
  _collapsed?: boolean;
  _childCount?: number;
  _hasChildren?: boolean;
  _hiddenCount?: number;
}

function CommandGroupNode({ data, selected }: NodeProps<CommandGroupNodeData>) {
  const isCollapsed = data._collapsed;
  const hiddenCount = data._hiddenCount || 0;
  const Chevron = isCollapsed ? ChevronRight : ChevronDown;

  return (
    <div
      className={cn(
        'relative px-3 py-2 min-w-[90px] max-w-[150px] rounded-md',
        'border-2 transition-all duration-200',
        'bg-white border-risk-medium shadow-brutal-sm',
        selected && 'ring-2 ring-risk-critical !border-risk-critical',
        'cursor-pointer hover:border-carbon hover:shadow-brutal',
      )}
      title={`${data.command} commands${isCollapsed ? ` (${hiddenCount} hidden)` : ''}`}
    >
      {/* Alert indicator */}
      {data.alertCount > 0 && (
        <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-risk-critical border-2 border-white rounded-full flex items-center justify-center">
          <span className="text-[7px] font-bold text-white">{data.alertCount}</span>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <Chevron className="w-3 h-3 flex-shrink-0 text-carbon/40" />
        <Terminal className="w-3 h-3 flex-shrink-0 text-carbon/60" />
        <span className="text-[11px] font-mono font-bold text-carbon truncate">
          {data.command}
        </span>
        {isCollapsed && hiddenCount > 0 && (
          <span className="text-[10px] font-mono bg-carbon/10 text-carbon/50 px-1 rounded-sm">
            {hiddenCount}
          </span>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !border-2 !bg-carbon !border-white"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !border-2 !bg-carbon !border-white"
      />
    </div>
  );
}

export default memo(CommandGroupNode);
