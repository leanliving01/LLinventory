import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { X, Send, Sparkles, Bot, Newspaper, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/lib/AuthContext';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { getUserPermissions } from '@/lib/permissions';

const GREETING = `Hi, I'm **Livi** — your Lean Living assistant. I answer from your system manual and your live data (only what your role allows), and I'll tell you if something isn't documented yet.\n\nAsk me how something works, or about your stock, orders, suppliers, production or packing.`;

const SUGGESTIONS = [
  "How does split supplements/meals packing work?",
  "What's below par level right now?",
  "Which suppliers have outstanding purchase orders?",
  "How is each packer performing this week?",
];

// Friendly name for the current screen (for "explain this screen").
function pageNameFromPath(pathname) {
  const map = {
    '/': 'Dashboard', '/sales': 'Sales Orders', '/reports/dispatch': 'Dispatch Performance',
    '/reports/employees': 'Employee Performance', '/reports/team': 'Team Performance',
    '/purchasing/orders': 'Purchase Orders', '/purchasing/dashboard': 'Purchasing Dashboard',
    '/purchasing/scorecard': 'Supplier Scorecard', '/reports/food-cost': 'Food Cost',
    '/stock/overview': 'Inventory Overview', '/production/runs': 'Production Runs',
  };
  if (map[pathname]) return map[pathname];
  const seg = (pathname || '').split('/').filter(Boolean).pop() || 'this page';
  return seg.replace(/-/g, ' ');
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mr-2 mt-0.5">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm',
        )}
        style={{ wordBreak: 'break-word' }}
      >
        {isUser ? (
          <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&_table]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_th]:px-2 [&_td]:px-2">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AiAssistant({ open, onClose }) {
  const [messages, setMessages] = useState([{ role: 'assistant', content: GREETING }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const location = useLocation();
  const perms = useMemo(() => getUserPermissions(user || {}, customRoles), [user, customRoles]);
  const pageContext = useMemo(() => pageNameFromPath(location?.pathname), [location?.pathname]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const send = useCallback(async (text, mode = 'chat') => {
    const trimmed = (text || '').trim();
    if ((!trimmed && mode === 'chat') || isLoading) return;

    const shown = trimmed || (mode === 'digest' ? "Today's digest" : mode === 'explain_screen' ? `Explain this screen (${pageContext})` : '');
    const userMessage = { role: 'user', content: shown };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsLoading(true);

    try {
      // Talk to the real Livy (Hermes) agent via the server-side proxy (/__fn/livy),
      // which injects the API key. Livy is read-only over the ERP and uses its erp_*
      // tools for live numbers.
      const systemMsg = {
        role: 'system',
        content: `You are Livy, the Lean Living ERP agent, replying inside the web app. Current screen: ${pageContext}. The user's role is ${user?.role || 'unknown'}. Use your erp_* tools for any live numbers and never invent them. Be concise and use markdown.${mode === 'digest' ? ' The user asked for a short operations digest of what matters right now.' : ''}${mode === 'explain_screen' ? ` Explain what the "${pageContext}" screen is for and how to use it.` : ''}`,
      };
      const convo = nextMessages.map((m) => ({ role: m.role, content: m.content }));

      // Abort a touch before the serverless 60s cap so we own the timeout and can
      // show a friendly message instead of Vercel's plain-text error page (which
      // used to crash the JSON parse with "Unexpected token 'A'").
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 58000);
      let resp;
      try {
        resp = await fetch('/__fn/livy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-5.4', stream: false, messages: [systemMsg, ...convo] }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      // The response may NOT be JSON (gateway timeout / error page), so read text
      // first and parse defensively — never let resp.json() throw over the real error.
      const rawText = await resp.text();
      let data = null;
      try { data = rawText ? JSON.parse(rawText) : null; } catch { /* non-JSON error body */ }

      if (!resp.ok || !data) {
        const detail = data?.error?.message || data?.error
          || (rawText ? rawText.slice(0, 140).replace(/\s+/g, ' ').trim() : `HTTP ${resp.status}`);
        throw new Error(detail || `HTTP ${resp.status}`);
      }
      const reply = data?.choices?.[0]?.message?.content ?? 'Sorry, I could not get a response. Please try again.';
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      const friendly = err.name === 'AbortError'
        ? "That took too long — it's usually a heavy data question that timed out. Try again, or ask something more specific (e.g. one product or one week)."
        : `Sorry, something went wrong: ${err.message}`;
      setMessages((prev) => [...prev, { role: 'assistant', content: friendly }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, pageContext, user]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const showSuggestions = messages.length === 1 && !isLoading;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-[420px] bg-background border-l border-border flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-sm">Livi</p>
            <p className="text-xs text-muted-foreground">Lean Living assistant</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick actions */}
        <div className="flex gap-2 px-3 py-2 border-b border-border shrink-0">
          <button
            onClick={() => send('', 'digest')}
            disabled={isLoading}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <Newspaper className="w-3.5 h-3.5" /> Today's digest
          </button>
          <button
            onClick={() => send('', 'explain_screen')}
            disabled={isLoading}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5" /> Explain this screen
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}

          {/* Suggested questions — only shown after greeting */}
          {showSuggestions && (
            <div className="space-y-2 pt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="w-full text-left text-sm px-3 py-2 rounded-xl border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="bg-muted rounded-2xl rounded-bl-sm">
                <ThinkingDots />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border px-3 py-3 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your data..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-32 overflow-y-auto"
              style={{ minHeight: '42px' }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px';
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || isLoading}
              className="h-[42px] w-[42px] shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 text-center">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </>
  );
}
