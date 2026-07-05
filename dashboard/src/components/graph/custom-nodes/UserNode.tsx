import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { User, AlertTriangle, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface UserNodeData {
  label: string;
  sessionCount: number;
  alertCount: number;
  _collapsed?: boolean;
  _childCount?: number;
  _hasChildren?: boolean;
  _hiddenCount?: number;
}

function UserNode({ data, selected }: NodeProps<UserNodeData>) {
  return (
    <div
      className={cn(
        'relative w-[100px] h-[100px] rounded-full',
        'bg-carbon',
        'flex flex-col items-center justify-center text-center',
        'border-[3px] border-carbon shadow-brutal-lg',
        selected ? 'ring-2 ring-carbon/30' : '',
        'cursor-pointer transition-all duration-200',
        'hover:shadow-brutal-lg hover:border-carbon'
      )}
    >
      {/* Icon */}
      <User className="w-5 h-5 text-white mb-1" />

      {/* Label */}
      <div className="text-white font-mono font-bold text-[10px] leading-tight truncate max-w-[80px] px-1">
        {data.label}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 mt-1 text-[10px]">
        <div className="flex items-center gap-0.5 text-white/80">
          <Terminal className="w-2.5 h-2.5" />
          {data.sessionCount}
        </div>
        {data.alertCount > 0 && (
          <div className="flex items-center gap-0.5 text-white font-bold">
            <AlertTriangle className="w-2.5 h-2.5" />
            {data.alertCount}
          </div>
        )}
      </div>

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
        className="!bg-carbon !w-3 !h-3 !border-2 !border-white"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-carbon !w-3 !h-3 !border-2 !border-white"
      />
    </div>
  );
}

export default memo(UserNode);
