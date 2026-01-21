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
          ? 'bg-[#FDF2F4] border-[#D90429] shadow-[3px_3px_0px_#D90429]'
          : isError
          ? 'bg-[#FDF2F4] border-[#C4516C] shadow-[3px_3px_0px_#C4516C]'
          : data.isRunning
          ? 'bg-white border-carbon shadow-[3px_3px_0px_#1A1A1A]'
          : 'bg-[#F4F4F4] border-[#8B8B8B] shadow-[3px_3px_0px_#8B8B8B]',
        selected && 'ring-2 ring-[#D90429] !border-[#D90429]',
        'cursor-pointer hover:border-[#D90429] hover:shadow-[3px_3px_0px_#D90429]'
      )}
      title={data.fullCommand}
    >
      {/* Blocked indicator */}
      {data.isBlocked && (
        <div className="absolute -top-1 -right-1">
          <XCircle className="w-4 h-4 text-[#D90429] fill-white" />
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
            data.isBlocked ? 'text-[#D90429]' : 'text-carbon'
          )}
        />
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'text-[11px] font-mono truncate',
              data.isBlocked
                ? 'text-[#D90429] line-through'
                : isError
                ? 'text-[#C4516C]'
                : 'text-carbon'
            )}
          >
            {data.command}
          </div>
          {data.isBlocked && (
            <div className="text-[8px] text-[#D90429] mt-0.5 font-mono font-bold">
              BLOCKED
            </div>
          )}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          '!w-2.5 !h-2.5 !border-2',
          data.isBlocked
            ? '!bg-[#D90429] !border-white'
            : '!bg-carbon !border-white'
        )}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          '!w-2.5 !h-2.5 !border-2',
          data.isBlocked
            ? '!bg-[#D90429] !border-white'
            : '!bg-carbon !border-white'
        )}
      />
    </div>
  );
}

export default memo(ProcessNode);
