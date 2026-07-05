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
          ? 'border-risk-critical bg-tint-critical'
          : data.isExternal
          ? 'border-risk-medium bg-tint-neutral'
          : 'border-risk-low bg-white',
        selected && 'ring-2 ring-risk-critical !border-risk-critical',
        'cursor-pointer hover:border-risk-critical hover:shadow-brutal-accent-lg',
        // Diamond shape
        '[clip-path:polygon(50%_0%,100%_50%,50%_100%,0%_50%)]',
        'flex flex-col items-center justify-center text-center',
        'aspect-square'
      )}
      title={`${data.protocols.join(', ')}://${data.domain}`}
    >
      <div className="flex flex-col items-center py-4">
        {data.isSuspicious ? (
          <ShieldAlert className="w-5 h-5 text-risk-critical mb-1" />
        ) : data.isExternal ? (
          <ExternalLink className="w-5 h-5 text-risk-medium mb-1" />
        ) : (
          <Globe className="w-5 h-5 text-risk-medium mb-1" />
        )}

        <div
          className={cn(
            'text-xs font-mono font-medium truncate max-w-[100px]',
            data.isSuspicious ? 'text-risk-critical' : 'text-carbon'
          )}
        >
          {data.domain}
        </div>

        {data.requestCount > 1 && (
          <div className="text-[10px] text-risk-medium mt-1 font-mono">
            {data.requestCount}x
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-risk-medium !w-2.5 !h-2.5 !border-2 !border-white"
        style={{ left: -4 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-risk-medium !w-2.5 !h-2.5 !border-2 !border-white"
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
          ? 'border-risk-critical bg-tint-critical shadow-brutal-accent'
          : data.isExternal
          ? 'border-risk-high bg-white shadow-brutal-rose'
          : 'bg-white border-risk-low shadow-brutal-rose',
        selected && 'ring-2 ring-risk-critical !border-risk-critical',
        'cursor-pointer hover:border-risk-critical hover:shadow-brutal-accent'
      )}
      title={`${data.protocols.join(', ')}://${data.domain}`}
    >
      <div className="flex items-center gap-2">
        {data.isSuspicious ? (
          <ShieldAlert className="w-3.5 h-3.5 text-risk-critical flex-shrink-0" />
        ) : (
          <Globe className="w-3.5 h-3.5 text-risk-medium flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'text-[11px] font-mono font-medium truncate',
              data.isSuspicious ? 'text-risk-critical' : 'text-carbon'
            )}
          >
            {data.domain}
          </div>
          {data.isSuspicious && (
            <div className="text-[10px] text-risk-critical font-mono font-bold">SUSPICIOUS</div>
          )}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!bg-risk-high !w-2.5 !h-2.5 !border-2 !border-white"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-risk-high !w-2.5 !h-2.5 !border-2 !border-white"
      />
    </div>
  );
}

export default memo(DomainNodeRect);
