import ReactMarkdown, { type Components } from 'react-markdown';
import { cn } from '@/lib/utils';

// Claude's replies and notes are markdown. Styled with the dashboard's own
// classes (no typography plugin), dark-mode aware via the text-carbon remaps.
const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-carbon/30 hover:text-alert-red">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2 pl-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 pl-5 list-decimal space-y-1">{children}</ol>,
  h1: ({ children }) => <h4 className="mt-3 mb-1 font-display font-semibold text-carbon">{children}</h4>,
  h2: ({ children }) => <h4 className="mt-3 mb-1 font-display font-semibold text-carbon">{children}</h4>,
  h3: ({ children }) => <h4 className="mt-3 mb-1 font-display font-semibold text-carbon">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 pl-3 border-l-2 border-carbon/15 opacity-80">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="code-block my-2 rounded-lg p-3 text-xs font-mono overflow-x-auto">{children}</pre>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={cn('font-mono', className)}>{children}</code>
    ) : (
      <code className="font-mono text-[0.9em] px-1 py-0.5 rounded bg-carbon/[0.06] dark:bg-white/[0.08]">
        {children}
      </code>
    ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-carbon/10 px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-carbon/10 px-2 py-1 align-top">{children}</td>,
};

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('break-words', className)}>
      <ReactMarkdown components={components}>{text}</ReactMarkdown>
    </div>
  );
}
