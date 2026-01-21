import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ExpandableTextProps {
  text: string;
  /** Max visible characters before truncation. Default 80. */
  maxChars?: number;
  className?: string;
  /** Optional prefix shown before the text (e.g., "$ " for commands). */
  prefix?: string;
}

/**
 * Text that truncates beyond `maxChars` and expands on click.
 * Only adds expand/collapse behavior when the text actually exceeds the limit.
 */
export function ExpandableText({
  text,
  maxChars = 80,
  className,
  prefix,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > maxChars;

  if (!needsTruncation) {
    return (
      <p className={className}>
        {prefix}{text}
      </p>
    );
  }

  return (
    <p
      className={cn(className, 'cursor-pointer group/expand')}
      onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
    >
      {prefix}
      {expanded ? text : text.slice(0, maxChars)}
      {!expanded && (
        <span className="opacity-40 group-hover/expand:opacity-70 transition-opacity">
          {'... '}
          <span className="text-[10px] font-mono opacity-60 border-b border-dotted border-current">
            more
          </span>
        </span>
      )}
      {expanded && (
        <span className="opacity-40 group-hover/expand:opacity-70 ml-1 transition-opacity">
          <span className="text-[10px] font-mono opacity-60 border-b border-dotted border-current">
            less
          </span>
        </span>
      )}
    </p>
  );
}
