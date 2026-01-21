import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Loader2,
  Shield,
  Check,
  AlertTriangle,
  Sparkles,
  User,
  Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGeneratePolicy, useCreatePolicy } from '@/api/queries';

interface PolicyData {
  name: string;
  description: string;
  enabled: boolean;
  categories: string[];
  tools: string[];
  conditions: { field: string; operator: string; value: string; case_sensitive: boolean }[];
  condition_logic: string;
  action: string;
  severity: string;
  alert_title: string;
  alert_description: string;
  tags: string[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  policy?: PolicyData;
  explanation?: string;
  applied?: boolean;
  error?: string;
}

const EXAMPLE_PROMPTS = [
  'Block any command that downloads and pipes to bash',
  'Alert when .env or credentials files are accessed',
  'Block file writes outside the project directory',
  'Alert on network requests to unknown domains',
];

const sevStyle = (sev: string) => {
  switch (sev) {
    case 'critical': return 'text-severity-critical bg-severity-critical/10';
    case 'high': return 'text-severity-high bg-severity-high/10';
    case 'medium': return 'text-severity-medium bg-severity-medium/10';
    default: return 'opacity-60 bg-carbon/5';
  }
};

function PolicyPreviewCard({
  policy,
  explanation,
  applied,
  onApply,
  isApplying,
}: {
  policy: PolicyData;
  explanation: string;
  applied?: boolean;
  onApply: () => void;
  isApplying: boolean;
}) {
  return (
    <div className="rounded-xl border border-carbon/10 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-carbon/[0.02] border-b border-carbon/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 opacity-40" />
          <span className="font-medium text-sm">{policy.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('text-[10px] font-bold uppercase px-2 py-0.5 rounded-full', sevStyle(policy.severity))}>
            {policy.severity}
          </span>
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-carbon/5">
            {policy.action}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-sm text-carbon/70">{policy.description}</p>

        {policy.categories.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase opacity-40 mb-1">Categories</p>
            <div className="flex gap-1 flex-wrap">
              {policy.categories.map(c => (
                <code key={c} className="text-[10px] rounded-full bg-carbon/[0.06] px-2 py-0.5 font-mono">{c}</code>
              ))}
            </div>
          </div>
        )}

        {policy.conditions.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase opacity-40 mb-1">
              Conditions ({policy.condition_logic === 'any' ? 'ANY' : 'ALL'} must match)
            </p>
            <div className="space-y-1.5">
              {policy.conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2 bg-carbon/[0.03] rounded-lg px-3 py-2">
                  <span className="text-[11px] font-mono font-semibold whitespace-nowrap">{c.field}</span>
                  <span className="text-[9px] font-mono font-medium bg-carbon text-white rounded px-1.5 py-0.5 whitespace-nowrap">{c.operator}</span>
                  <span className="text-[11px] font-mono font-medium text-alert-red break-all">
                    {typeof c.value === 'string' ? c.value : JSON.stringify(c.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {policy.tags.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase opacity-40 mb-1">Tags</p>
            <div className="flex gap-1 flex-wrap">
              {policy.tags.map(t => (
                <span key={t} className="text-[10px] rounded-full bg-carbon/[0.04] px-2 py-0.5 font-mono">{t}</span>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-carbon/60 italic">{explanation}</p>
      </div>

      <div className="px-4 py-3 border-t border-carbon/10 flex justify-end">
        {applied ? (
          <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
            <Check className="w-4 h-4" />
            Applied
          </span>
        ) : (
          <button
            onClick={onApply}
            disabled={isApplying}
            className="btn btn-primary flex items-center gap-2 text-sm"
          >
            {isApplying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            Apply Policy
          </button>
        )}
      </div>
    </div>
  );
}

export default function PolicyAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const generateMutation = useGeneratePolicy();
  const createMutation = useCreatePolicy();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (text?: string) => {
    const prompt = text || input.trim();
    if (!prompt || generateMutation.isPending) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');

    try {
      const result = await generateMutation.mutateAsync(prompt);
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.explanation,
        policy: result.policy as unknown as PolicyData,
        explanation: result.explanation,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const errorMessage = err && typeof err === 'object' && 'message' in err
        ? (err as { message: string }).message
        : 'Failed to generate policy. Please try again.';
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        error: errorMessage,
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  const handleApply = async (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg?.policy) return;

    try {
      await createMutation.mutateAsync(msg.policy as unknown as Record<string, unknown>);
      setMessages(prev =>
        prev.map(m => (m.id === msgId ? { ...m, applied: true } : m))
      );
    } catch {
      // error visible via createMutation state
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-purple-500/60" />
            </div>
            <h3 className="text-lg font-medium opacity-70 mb-2">Policy Assistant</h3>
            <p className="text-sm opacity-40 max-w-md mb-6">
              Describe a security rule in plain English and I'll generate the policy configuration for you.
            </p>
            <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  className="text-left text-xs font-mono p-3 rounded-xl border border-carbon/10 hover:border-carbon/20 hover:bg-carbon/[0.02] transition-all"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-3.5 h-3.5 text-purple-600/70" />
                </div>
              )}
              <div className={cn('max-w-[85%]', msg.role === 'user' ? 'order-first' : '')}>
                {msg.role === 'user' ? (
                  <div className="bg-carbon text-white rounded-2xl rounded-tr-sm px-4 py-2.5">
                    <p className="text-sm">{msg.content}</p>
                  </div>
                ) : msg.error ? (
                  <div className="bg-severity-critical/5 border border-severity-critical/20 rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="w-4 h-4 text-severity-critical" />
                      <span className="text-sm font-medium text-severity-critical">Error</span>
                    </div>
                    <p className="text-sm opacity-70">{msg.error}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {msg.policy && (
                      <PolicyPreviewCard
                        policy={msg.policy}
                        explanation={msg.explanation || ''}
                        applied={msg.applied}
                        onApply={() => handleApply(msg.id)}
                        isApplying={createMutation.isPending}
                      />
                    )}
                  </div>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-carbon/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <User className="w-3.5 h-3.5 opacity-50" />
                </div>
              )}
            </div>
          ))
        )}

        {generateMutation.isPending && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Bot className="w-3.5 h-3.5 text-purple-600/70" />
            </div>
            <div className="bg-carbon/[0.03] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin opacity-40" />
              <span className="text-sm opacity-40">Generating policy...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-carbon/10 pt-4">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe a security policy in plain English..."
            className="input flex-1"
            disabled={generateMutation.isPending}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || generateMutation.isPending}
            className="btn btn-primary p-2.5"
          >
            {generateMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
