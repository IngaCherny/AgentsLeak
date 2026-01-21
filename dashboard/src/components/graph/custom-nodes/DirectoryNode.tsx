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
        'bg-[#FAFAF8]',
        'shadow-[3px_3px_0px_#C8C8C8]',
        selected ? 'ring-2 ring-[#D90429] border-[#D90429]' : 'border-[#8B8B8B]',
        'cursor-pointer hover:border-[#D90429] hover:shadow-[3px_3px_0px_#D90429]'
      )}
      title={data.dirPath}
    >
      {data.alertCount > 0 && (
        <div className="absolute -top-2 -right-2 rounded bg-[#D90429] text-white text-[8px] font-mono font-bold px-1 py-px min-w-[16px] text-center">
          {data.alertCount}
        </div>
      )}

      <div className="flex items-center gap-2">
        <FolderOpen className="w-3.5 h-3.5 text-[#8B8B8B] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-mono font-medium text-carbon/70 truncate block">
            {data.dirPath.split('/').pop() || data.dirPath}/
          </span>
          <span className="text-[9px] font-mono text-carbon/40">
            {data.fileCount} files
          </span>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#8B8B8B] !w-2.5 !h-2.5 !border-2 !border-white"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[#8B8B8B] !w-2.5 !h-2.5 !border-2 !border-white"
      />
    </div>
  );
}

export default memo(DirectoryNode);
