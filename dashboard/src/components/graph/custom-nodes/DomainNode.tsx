import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Globe, ExternalLink, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DomainNodeData {
  domain: string;
  isExternal: boolean;
  isSuspicious: boolean;
  requestCount: number;
  protocols: ('http' | 'https' | 'wss' | 'ws')[];
}

// Diamond-shaped domain node (alternative style)
export function DomainNodeDiamond({ data, selected }: NodeProps<DomainNodeData>) {
  return (
    <div
      className={cn(
        'relative px-4 py-3 min-w-[120px] max-w-[180px]',
        'border-2 transition-all duration-200',
        data.isSuspicious
          ? 'border-[#D90429] bg-[#FDF2F4]'
          : data.isExternal
          ? 'border-[#8B8B8B] bg-[#F4F4F4]'
          : 'border-[#C8C8C8] bg-white',
        selected && 'ring-2 ring-[#D90429] !border-[#D90429]',
        'cursor-pointer hover:border-[#D90429] hover:shadow-[4px_4px_0px_#D90429]',
        // Diamond shape
        '[clip-path:polygon(50%_0%,100%_50%,50%_100%,0%_50%)]',
        'flex flex-col items-center justify-center text-center',
        'aspect-square'
      )}
      title={`${data.protocols.join(', ')}://${data.domain}`}
    >
      <div className="flex flex-col items-center py-4">
        {data.isSuspicious ? (
          <ShieldAlert className="w-5 h-5 text-[#D90429] mb-1" />
        ) : data.isExternal ? (
          <ExternalLink className="w-5 h-5 text-[#8B8B8B] mb-1" />
        ) : (
          <Globe className="w-5 h-5 text-[#8B8B8B] mb-1" />
        )}

        <div
          className={cn(
            'text-xs font-mono font-medium truncate max-w-[100px]',
            data.isSuspicious ? 'text-[#D90429]' : 'text-carbon'
          )}
        >
          {data.domain}
        </div>

        {data.requestCount > 1 && (
          <div className="text-[10px] text-[#8B8B8B] mt-1 font-mono">
            {data.requestCount}x
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#8B8B8B] !w-2.5 !h-2.5 !border-2 !border-white"
        style={{ left: -4 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[#8B8B8B] !w-2.5 !h-2.5 !border-2 !border-white"
        style={{ right: -4 }}
      />
    </div>
  );
}

// Rect version (default)
export function DomainNodeRect({ data, selected }: NodeProps<DomainNodeData>) {
  return (
    <div
      className={cn(
        'relative px-3 py-2 min-w-[100px] max-w-[160px] rounded-xl',
        'border-2 transition-all duration-200',
        data.isSuspicious
          ? 'border-[#D90429] bg-[#FDF2F4] shadow-[3px_3px_0px_#D90429]'
          : data.isExternal
          ? 'border-[#C4516C] bg-white shadow-[3px_3px_0px_#C4516C]'
          : 'bg-white border-[#C8C8C8] shadow-[3px_3px_0px_#C4516C]',
        selected && 'ring-2 ring-[#D90429] !border-[#D90429]',
        'cursor-pointer hover:border-[#D90429] hover:shadow-[3px_3px_0px_#D90429]'
      )}
      title={`${data.protocols.join(', ')}://${data.domain}`}
    >
      <div className="flex items-center gap-2">
        {data.isSuspicious ? (
          <ShieldAlert className="w-3.5 h-3.5 text-[#D90429] flex-shrink-0" />
        ) : (
          <Globe className="w-3.5 h-3.5 text-[#8B8B8B] flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'text-[11px] font-mono font-medium truncate',
              data.isSuspicious ? 'text-[#D90429]' : 'text-carbon'
            )}
          >
            {data.domain}
          </div>
          {data.isSuspicious && (
            <div className="text-[8px] text-[#D90429] font-mono font-bold">SUSPICIOUS</div>
          )}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[#C4516C] !w-2.5 !h-2.5 !border-2 !border-white"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[#C4516C] !w-2.5 !h-2.5 !border-2 !border-white"
      />
    </div>
  );
}

export default memo(DomainNodeRect);
