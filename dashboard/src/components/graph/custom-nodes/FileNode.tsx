import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';

import { cn } from '@/lib/utils';

export type FileRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface FileNodeData {
  fileName: string;
  fullPath: string;
  risk: FileRisk;
  isSensitive: boolean;
  operations: ('read' | 'write' | 'delete')[];
}

function FileNode({ data, selected }: NodeProps<FileNodeData>) {
  const riskColors: Record<FileRisk, { border: string; bg: string; text: string }> = {
    none: { border: 'border-[#C8C8C8]', bg: 'bg-white', text: 'text-carbon' },
    low: { border: 'border-[#C8C8C8]', bg: 'bg-white', text: 'text-carbon' },
    medium: { border: 'border-[#8B8B8B]', bg: 'bg-[#F4F4F4]', text: 'text-[#525252]' },
    high: { border: 'border-[#C4516C]', bg: 'bg-[#FDF2F4]', text: 'text-[#9F1239]' },
    critical: { border: 'border-[#D90429]', bg: 'bg-[#FDF2F4]', text: 'text-[#D90429]' },
  };

  const colors = riskColors[data.risk];

  return (
    <div
      className={cn(
        'relative px-3 py-2 min-w-[100px] max-w-[180px] rounded-md',
        'border-2 transition-all duration-200',
        'shadow-[3px_3px_0px_#1A1A1A]',
        colors.bg,
        selected ? 'ring-2 ring-[#D90429] border-[#D90429]' : colors.border,
        'cursor-pointer hover:border-[#D90429] hover:shadow-[3px_3px_0px_#D90429]'
      )}
      title={data.fullPath}
    >
      {/* Risk indicator */}
      {(data.risk === 'critical' || data.risk === 'high') && (
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#D90429]" />
      )}
      {data.risk === 'medium' && (
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#8B8B8B]" />
      )}

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {data.operations.length > 0 && (
              <div className="flex gap-0.5">
                {data.operations.includes('read') && (
                  <span className="text-[8px] px-1 py-px rounded-sm bg-[#F4F4F4] text-[#8B8B8B] font-mono font-bold">R</span>
                )}
                {data.operations.includes('write') && (
                  <span className="text-[8px] px-1 py-px rounded-sm bg-carbon text-white font-mono font-bold">W</span>
                )}
                {data.operations.includes('delete') && (
                  <span className="text-[8px] px-1 py-px rounded-sm bg-[#D90429] text-white font-mono font-bold">D</span>
                )}
              </div>
            )}
            <span className={cn('text-[11px] font-mono font-medium truncate', colors.text)}>
              {data.fileName}
            </span>
          </div>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-carbon !w-2.5 !h-2.5 !border-2 !border-white"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-carbon !w-2.5 !h-2.5 !border-2 !border-white"
      />
    </div>
  );
}

export default memo(FileNode);
