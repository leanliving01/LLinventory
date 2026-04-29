import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Bug, ChevronDown, Copy, Loader2, Check, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useLocation } from 'react-router-dom';

export default function BugReporter() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!subject.trim() || !description.trim()) {
      toast.error('Please fill in both subject and description');
      return;
    }
    setLoading(true);
    setGeneratedPrompt('');
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a senior developer debugging the Lean Living production/inventory app (React + Base44 platform, Tailwind CSS, shadcn/ui).

The user reported this bug:
**Subject:** ${subject}
**Description:** ${description}
**Current page route:** ${location.pathname}

Based on this, generate a detailed prompt I can paste into the AI code assistant to fix this bug. The prompt should include:
1. A clear restatement of the bug
2. The likely files/components involved (infer from the page route and description — this app uses pages/, components/, functions/, entities/ structure)
3. A suggested debugging and fix approach
4. Any edge cases to watch for

Keep it concise but thorough. Write it as a ready-to-paste prompt addressed to an AI assistant.`,
    });
    setGeneratedPrompt(result);
    setLoading(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    toast.success('Prompt copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setSubject('');
    setDescription('');
    setGeneratedPrompt('');
  };

  return (
    <div className="border-t border-sidebar-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2.5 w-full text-sm font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
      >
        <Bug className="w-4 h-4 shrink-0 text-red-400" strokeWidth={1.5} />
        <span className="flex-1 text-left text-xs">Report Bug</span>
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          <input
            type="text"
            placeholder="Bug subject..."
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-md bg-sidebar-accent/50 border border-sidebar-border px-2.5 py-1.5 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/30 focus:outline-none focus:ring-1 focus:ring-sidebar-ring"
          />
          <textarea
            placeholder="Describe what's wrong..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-md bg-sidebar-accent/50 border border-sidebar-border px-2.5 py-1.5 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/30 focus:outline-none focus:ring-1 focus:ring-sidebar-ring resize-none"
          />
          <button
            onClick={handleGenerate}
            disabled={loading || !subject.trim() || !description.trim()}
            className="flex items-center justify-center gap-1.5 w-full rounded-md bg-sidebar-primary text-sidebar-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-sidebar-primary/90 disabled:opacity-40 transition-colors"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {loading ? 'Generating...' : 'Generate Fix Prompt'}
          </button>

          {generatedPrompt && (
            <div className="space-y-1.5">
              <div className="max-h-40 overflow-y-auto rounded-md bg-sidebar-accent border border-sidebar-border p-2">
                <pre className="text-[10px] text-sidebar-foreground/80 whitespace-pre-wrap font-mono leading-relaxed">{generatedPrompt}</pre>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={handleCopy}
                  className="flex items-center justify-center gap-1 flex-1 rounded-md bg-sidebar-accent border border-sidebar-border px-2 py-1.5 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
                >
                  {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied!' : 'Copy Prompt'}
                </button>
                <button
                  onClick={handleReset}
                  className="rounded-md bg-sidebar-accent border border-sidebar-border px-2 py-1.5 text-xs text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}