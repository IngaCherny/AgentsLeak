import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DirectoryNodeData {
  dirPath: string;
  fileCount: number;
  accessCount: number;
  alertCount: number;
  _collapsed?: boolean;
  _childCount?: number;
  _hasChildren?: boolean;
  _hiddenCount?: number;
}

function DirectoryNode({ data, selected }: NodeProps<DirectoryNodeData>) {
  return (
    <div
      className={cn(
        'relative px-3 py-2 min-w-[120px] max-w-[200px] rounded-md',
        'border-2 border-dashed transition-all duration-200',
        'bg-tint-paper',
        'shadow-brutal-softer',
        selected ? 'ring-2 ring-risk-critical border-risk-critical' : 'border-risk-medium',
        'cursor-pointer hover:border-risk-critical hover:shadow-brutal-accent'
      )}
      title={data.dirPath}
    >
      {data.alertCount > 0 && (
        <div className="absolute -top-2 -right-2 rounded bg-risk-critical text-white text-[10px] font-mono font-bold px-1 py-px min-w-[16px] text-center">
          {data.alertCount}
        </div>
      )}

      <div className="flex items-center gap-2">
        <FolderOpen className="w-3.5 h-3.5 text-risk-medium flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-mono font-medium text-carbon/70 truncate block">
            {data.dirPath.split('/').pop() || data.dirPath}/
          </span>
          <span className="text-[10px] font-mono text-carbon/40">
            {data.fileCount} files
          </span>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-risk-medium !w-2.5 !h-2.5 !border-2 !border-white"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-risk-medium !w-2.5 !h-2.5 !border-2 !border-white"
      />
    </div>
  );
}

export default memo(DirectoryNode);
