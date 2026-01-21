import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import {
  Terminal,
  FileText,
  FileEdit,
  Search,
  Globe,
  Compass,
  GitBranch,
  Wrench,
  Pencil,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToolRisk = 'critical' | 'high' | 'medium' | 'low';

export interface ToolNodeData {
  toolName: string;
  risk: ToolRisk;
  accessCount: number;
  alertCount: number;
  _collapsed?: boolean;
  _childCount?: number;
  _hasChildren?: boolean;
  _hiddenCount?: number;
}

const TOOL_RISK: Record<string, ToolRisk> = {
  Bash: 'critical',
  Task: 'critical',
  WebFetch: 'high',
  WebSearch: 'high',
  Write: 'medium',
  Edit: 'medium',
  NotebookEdit: 'medium',
  Read: 'low',
  Glob: 'low',
  Grep: 'low',
};

const TOOL_ICON: Record<string, React.ElementType> = {
  Bash: Terminal,
  Task: GitBranch,
  WebFetch: Globe,
  WebSearch: Compass,
  Write: FileEdit,
  Edit: Pencil,
  NotebookEdit: FileEdit,
  Read: FileText,
  Glob: Search,
  Grep: Search,
};

const RISK_STYLES: Record<ToolRisk, {
  bg: string;
  border: string;
  shadow: string;
  text: string;
  label: string;
}> = {
  critical: {
    bg: 'bg-[#D90429]',
    border: 'border-[#D90429]',
    shadow: 'shadow-[3px_3px_0px_#1A1A1A]',
    text: 'text-white',
    label: 'EXEC',
  },
  high: {
    bg: 'bg-[#C4516C]',
    border: 'border-[#C4516C]',
    shadow: 'shadow-[3px_3px_0px_#1A1A1A]',
    text: 'text-white',
    label: 'NET',
  },
  medium: {
    bg: 'bg-[#1A1A1A]',
    border: 'border-[#1A1A1A]',
    shadow: 'shadow-[3px_3px_0px_#8B8B8B]',
    text: 'text-white',
    label: 'WRITE',
  },
  low: {
    bg: 'bg-[#F4F4F4]',
    border: 'border-[#8B8B8B]',
    shadow: 'shadow-[3px_3px_0px_#8B8B8B]',
    text: 'text-carbon',
    label: 'READ',
  },
};

function ToolNode({ data, selected }: NodeProps<ToolNodeData>) {
  const risk = data.risk || TOOL_RISK[data.toolName] || 'low';
  const style = RISK_STYLES[risk];
  const Icon = TOOL_ICON[data.toolName] || Wrench;

  return (
    <div
      className={cn(
        'relative px-3 py-2 min-w-[100px] max-w-[160px] rounded-md',
        'border-2 transition-all duration-200',
        style.bg, style.border, style.shadow,
        selected && 'ring-2 ring-[#D90429]',
        'cursor-pointer',
        risk === 'low'
          ? 'hover:border-[#1A1A1A] hover:shadow-[3px_3px_0px_#1A1A1A]'
          : 'hover:shadow-[4px_4px_0px_#1A1A1A]',
      )}
      title={`Tool: ${data.toolName} (${risk} risk)`}
    >
      {/* Alert indicator */}
      {data.alertCount > 0 && (
        <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#D90429] border-2 border-white rounded-full flex items-center justify-center">
          <span className="text-[7px] font-bold text-white">{data.alertCount}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        {data._hasChildren && (
          data._collapsed
            ? <ChevronRight className={cn('w-3 h-3 flex-shrink-0', style.text, 'opacity-60')} />
            : <ChevronDown className={cn('w-3 h-3 flex-shrink-0', style.text, 'opacity-60')} />
        )}
        <Icon className={cn('w-3.5 h-3.5 flex-shrink-0', style.text)} />
        <div className="flex-1 min-w-0">
          <div className={cn('text-[11px] font-mono font-bold truncate', style.text)}>
            {data.toolName}
          </div>
          <div className={cn(
            'text-[8px] font-mono mt-0.5',
            risk === 'low' ? 'opacity-40' : 'opacity-70',
            style.text,
          )}>
            {style.label}
            {data._collapsed && data._hiddenCount ? ` · ${data._hiddenCount} hidden` : ''}
          </div>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          '!w-2.5 !h-2.5 !border-2',
          risk === 'critical' ? '!bg-[#D90429] !border-white' :
          risk === 'high' ? '!bg-[#C4516C] !border-white' :
          '!bg-carbon !border-white'
        )}
      />
      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          '!w-2.5 !h-2.5 !border-2',
          risk === 'critical' ? '!bg-[#D90429] !border-white' :
          risk === 'high' ? '!bg-[#C4516C] !border-white' :
          '!bg-carbon !border-white'
        )}
      />
    </div>
  );
}

export { TOOL_RISK };
export default memo(ToolNode);
