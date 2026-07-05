import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Terminal, XCircle, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ProcessNodeData {
  command: string;
  fullCommand: string;
  pid?: number;
  exitCode?: number;
  isBlocked: boolean;
  isRunning: boolean;
  _collapsed?: boolean;
  _childCount?: number;
  _hasChildren?: boolean;
  _hiddenCount?: number;
}

function ProcessNode({ data, selected }: NodeProps<ProcessNodeData>) {
  const isError = data.exitCode !== undefined && data.exitCode !== 0;

  return (
    <div
      className={cn(
        'relative px-3 py-2 min-w-[100px] max-w-[180px] rounded-md',
        'border-2 transition-all duration-200',
        data.isBlocked
          ? 'bg-tint-critical border-risk-critical shadow-brutal-accent'
          : isError
          ? 'bg-tint-critical border-risk-high shadow-brutal-rose'
          : data.isRunning
          ? 'bg-white border-carbon shadow-brutal'
          : 'bg-tint-neutral border-risk-medium shadow-brutal-soft',
        selected && 'ring-2 ring-risk-critical !border-risk-critical',
        'cursor-pointer hover:border-risk-critical hover:shadow-brutal-accent'
      )}
      title={data.fullCommand}
    >
      {/* Blocked indicator */}
      {data.isBlocked && (
        <div className="absolute -top-1 -right-1">
          <XCircle className="w-4 h-4 text-risk-critical fill-white" />
        </div>
      )}

      {/* Running indicator */}
      {data.isRunning && !data.isBlocked && (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-carbon animate-pulse" />
      )}

      <div className="flex items-center gap-2">
        {data._hasChildren && (
          data._collapsed
            ? <ChevronRight className="w-3 h-3 flex-shrink-0 text-carbon/40" />
            : <ChevronDown className="w-3 h-3 flex-shrink-0 text-carbon/40" />
        )}
        <Terminal
          className={cn(
            'w-3.5 h-3.5 flex-shrink-0',
            data.isBlocked ? 'text-risk-critical' : 'text-carbon'
          )}
        />
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'text-[11px] font-mono truncate',
              data.isBlocked
                ? 'text-risk-critical line-through'
                : isError
                ? 'text-risk-high'
                : 'text-carbon'
            )}
          >
            {data.command}
          </div>
          {data.isBlocked && (
            <div className="text-[10px] text-risk-critical mt-0.5 font-mono font-bold">
              BLOCKED
            </div>
          )}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          '!w-2.5 !h-2.5 !border-2 !border-white',
          data.isBlocked ? '!bg-risk-critical' : '!bg-carbon'
        )}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          '!w-2.5 !h-2.5 !border-2 !border-white',
          data.isBlocked ? '!bg-risk-critical' : '!bg-carbon'
        )}
      />
    </div>
  );
}

export default memo(ProcessNode);
