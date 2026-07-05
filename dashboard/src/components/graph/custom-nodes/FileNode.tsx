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
    none: { border: 'border-risk-low', bg: 'bg-white', text: 'text-carbon' },
    low: { border: 'border-risk-low', bg: 'bg-white', text: 'text-carbon' },
    medium: { border: 'border-risk-medium', bg: 'bg-tint-neutral', text: 'text-risk-medium-deep' },
    high: { border: 'border-risk-high', bg: 'bg-tint-critical', text: 'text-risk-high-deep' },
    critical: { border: 'border-risk-critical', bg: 'bg-tint-critical', text: 'text-risk-critical' },
  };

  const colors = riskColors[data.risk];

  return (
    <div
      className={cn(
        'relative px-3 py-2 min-w-[100px] max-w-[180px] rounded-md',
        'border-2 transition-all duration-200',
        'shadow-brutal',
        colors.bg,
        selected ? 'ring-2 ring-risk-critical border-risk-critical' : colors.border,
        'cursor-pointer hover:border-risk-critical hover:shadow-brutal-accent'
      )}
      title={data.fullPath}
    >
      {/* Risk indicator */}
      {(data.risk === 'critical' || data.risk === 'high') && (
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-risk-critical" />
      )}
      {data.risk === 'medium' && (
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-risk-medium" />
      )}

      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {data.operations.length > 0 && (
              <div className="flex gap-0.5">
                {data.operations.includes('read') && (
                  <span className="text-[10px] px-1 py-px rounded-sm bg-tint-neutral text-risk-medium font-mono font-bold">R</span>
                )}
                {data.operations.includes('write') && (
                  <span className="text-[10px] px-1 py-px rounded-sm bg-carbon text-white font-mono font-bold">W</span>
                )}
                {data.operations.includes('delete') && (
                  <span className="text-[10px] px-1 py-px rounded-sm bg-risk-critical text-white font-mono font-bold">D</span>
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
