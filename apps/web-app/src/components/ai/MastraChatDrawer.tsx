'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Send, Bot, CheckCircle2, XCircle, BookOpen, Plus, History, Trash2, Wrench } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, errorMessage, newId } from '../../lib/api';
import { ApprovalCard } from './ApprovalCard';
import { Alert, Badge, Button, cx } from '../ui/kit';
import type { AgentAction } from '../../lib/actions';
import type { ChatResponse, ChatThreadDetail, ChatThreadSummary, ChatToolCall } from '../../lib/types';

interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
  isError?: boolean;
  toolCalls?: ChatToolCall[];
  citations?: { file: string; heading?: string }[];
  guardrailStatus?: 'VERIFIED_SAFE' | 'WARNING';
  guardrailNotes?: string[];
  traceId?: string;
  summarized?: boolean;
  proposals?: AgentAction[];
}

export const MastraChatDrawer: React.FC = () => {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ChatThreadSummary[] | null>(null);
  const [showThreads, setShowThreads] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState('');
  const [copied, setCopied] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!loading) return;
    const start = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [loading]);

  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRequest = () => abortRef.current?.abort();

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const query = input.trim();
    if (!query || loading) return;

    setMessages((prev) => [...prev, { id: newId(), sender: 'user', text: query, timestamp: new Date().toLocaleTimeString() }]);
    setInput('');
    setLoading(true);

    const fail = (text: string) =>
      setMessages((prev) => [...prev, { id: newId(), sender: 'agent', text, isError: true, timestamp: new Date().toLocaleTimeString() }]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = await apiFetch<ChatResponse>('/ai/chat', { signal: controller.signal, method: 'POST', body: { message: query, ...(threadId ? { threadId } : {}) } });
      if (data.threadId) setThreadId(data.threadId);
      if (!data.success) {
        fail(data.error || 'The assistant returned an error.');
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            sender: 'agent',
            text: data.response ?? '',
            timestamp: new Date().toLocaleTimeString(),
            toolCalls: data.toolCalls,
            citations: data.citations,
            guardrailStatus: data.guardrailStatus,
            guardrailNotes: data.guardrailNotes,
            traceId: data.traceId,
            summarized: data.memory?.summarized,
            proposals: Array.isArray(data.proposals) ? data.proposals : undefined,
          },
        ]);
      }
    } catch (err) {
      if (controller.signal.aborted) {
        /* cancelled by the user: just drop the pending bubble */
      } else fail(errorMessage(err));
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const newChat = () => {
    setThreadId(null);
    setMessages([]);
    setShowThreads(false);
  };

  const loadThreads = async () => {
    setThreadsLoading(true);
    setThreadsError('');
    try {
      setThreads(await apiFetch<ChatThreadSummary[]>('/ai/threads'));
    } catch (err) {
      setThreadsError(errorMessage(err));
    } finally {
      setThreadsLoading(false);
    }
  };

  const toggleThreads = () => {
    const next = !showThreads;
    setShowThreads(next);
    if (next) void loadThreads();
  };

  const openThread = async (id: string) => {
    setThreadsError('');
    try {
      const t = await apiFetch<ChatThreadDetail>(`/ai/threads/${encodeURIComponent(id)}`);
      setThreadId(t.id);
      setMessages(
        t.messages.map((m) => ({
          id: m.id,
          sender: m.role === 'assistant' ? 'agent' : 'user',
          text: m.content,
          timestamp: new Date(m.createdAt).toLocaleTimeString(),
        })),
      );
      setShowThreads(false);
    } catch (err) {
      setThreadsError(errorMessage(err));
    }
  };

  const deleteThread = async (id: string) => {
    setThreadsError('');
    try {
      await apiFetch<{ success: boolean }>(`/ai/threads/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setThreads((prev) => prev?.filter((t) => t.id !== id) ?? null);
      if (id === threadId) {
        setThreadId(null);
        setMessages([]);
      }
    } catch (err) {
      setThreadsError(errorMessage(err));
    }
  };

  const copyTrace = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  /** Minimal, safe formatting of the assistant's text: paragraphs, bullet lines and **bold**. No HTML is ever injected. */
  const renderText = (text: string) => {
    const bold = (line: string) =>
      line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>));
    const lines = text.split('\n');
    const out: React.ReactNode[] = [];
    let list: string[] = [];
    const flush = () => {
      if (list.length) {
        out.push(
          <ul key={`ul${out.length}`} className="my-1 list-disc space-y-0.5 pl-5">
            {list.map((l, i) => (
              <li key={i}>{bold(l)}</li>
            ))}
          </ul>,
        );
        list = [];
      }
    };
    for (const raw of lines) {
      const m = raw.match(/^\s*(?:[•\-*]|\d+[.)])\s+(.*)$/);
      if (m) list.push(m[1]);
      else {
        flush();
        if (raw.trim()) out.push(<p key={`p${out.length}`} className="break-words">{bold(raw)}</p>);
      }
    }
    flush();
    return <div className="space-y-1.5">{out}</div>;
  };

  const SUGGESTIONS = ['How many patients are waiting?', 'Who are the specialists?', 'What is the discharge policy?'];

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle AI assistant"
        aria-expanded={isOpen}
        data-testid="chat-toggle"
        title="AI Assistant"
        className="fixed bottom-6 right-6 z-50 flex h-14 items-center gap-2.5 rounded-full border border-brand-800 bg-brand-700 pl-4 pr-5 text-white shadow-pop hover:bg-brand-800"
      >
        <Sparkles className="h-5 w-5" aria-hidden="true" />
        <span className="text-sm font-semibold">Ask AI</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="AI assistant"
          data-testid="chat-drawer"
          onKeyDown={(e) => e.key === 'Escape' && setIsOpen(false)}
          className="fixed bottom-24 right-6 z-50 flex h-[80vh] max-h-[760px] w-[520px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-pop"
        >
          <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <Bot className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <h2 className="text-base font-semibold leading-tight text-ink">AI Assistant</h2>
                <p className="text-xs text-ink-3">Signed in as {user?.displayName}. Changes need your approval.</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="secondary" size="sm" onClick={newChat} title="New chat" icon={<Plus className="h-4 w-4" aria-hidden />}>
                New chat
              </Button>
              <button onClick={toggleThreads} title="Previous chats" aria-label="Previous chats" aria-expanded={showThreads} className={cx('flex h-9 w-9 items-center justify-center rounded-lg hover:bg-surface-muted', showThreads ? 'text-brand-700' : 'text-ink-3')}>
                <History className="h-5 w-5" aria-hidden />
              </button>
              <button onClick={() => setIsOpen(false)} aria-label="Close AI assistant" className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-muted hover:text-ink">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>

          {showThreads && (
            <div className="max-h-64 space-y-1 overflow-y-auto border-b border-line bg-surface-muted p-2">
              {threadsLoading && <p className="p-2 text-sm text-ink-3">Loading chats...</p>}
              {threadsError && <p className="p-2 text-sm font-medium text-danger-700">{threadsError}</p>}
              {threads && threads.length === 0 && !threadsLoading && <p className="p-2 text-sm text-ink-3">No previous chats.</p>}
              {threads?.map((t) => (
                <div key={t.id} className={cx('flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface', t.id === threadId && 'bg-surface')}>
                  <button onClick={() => openThread(t.id)} className="btn-inline min-w-0 flex-1 text-left">
                    <p className="truncate font-medium text-ink">{t.title || 'Untitled chat'}</p>
                    <p className="text-xs text-ink-3">{new Date(t.updatedAt).toLocaleString()}</p>
                  </button>
                  <button onClick={() => deleteThread(t.id)} title="Delete chat" aria-label="Delete chat" className="flex h-9 w-9 items-center justify-center rounded text-ink-3 hover:text-danger-700">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 space-y-4 overflow-y-auto bg-canvas p-4" role="log" aria-live="polite" aria-label="Conversation">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-ink-2">Ask about a patient, a policy or a workflow, or ask me to prepare something (a referral, an appointment, a task). I never change records myself: every change appears as a card for you to approve.</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((q) => (
                    <button key={q} onClick={() => setInput(q)} className="btn-inline rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-muted">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={cx('flex flex-col', msg.sender === 'user' ? 'items-end' : 'items-start')}>
                <div
                  data-testid={msg.sender === 'user' ? 'chat-message-user' : 'chat-message-agent'}
                  className={cx(
                    'max-w-[92%] rounded-xl px-4 py-3 text-sm leading-relaxed',
                    msg.sender === 'user'
                      ? 'rounded-br-sm bg-brand-700 text-white'
                      : msg.isError
                        ? 'rounded-bl-sm border border-danger-200 bg-danger-50 text-danger-700'
                        : 'rounded-bl-sm border border-line bg-surface text-ink shadow-card',
                  )}
                >
                  {msg.sender === 'user' ? <p className="whitespace-pre-wrap break-words">{msg.text}</p> : renderText(msg.text)}

                  {msg.guardrailStatus === 'WARNING' && (
                    <div className="mt-3">
                      <Alert tone="warning" title="Check this answer">
                        {msg.guardrailNotes?.map((n, i) => (
                          <p key={i}>{n}</p>
                        ))}
                      </Alert>
                    </div>
                  )}

                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <details className="mt-3 border-t border-line pt-2">
                      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-3">
                        <Wrench className="h-3.5 w-3.5" aria-hidden /> Tools used ({msg.toolCalls.length}){msg.toolCalls.some((t) => !t.success) ? ' · some failed' : ''}
                      </summary>
                      <ul className="mt-2 space-y-1.5">
                        {msg.toolCalls.map((t, idx) => (
                          <li key={idx} className="rounded-md border border-line bg-surface-muted px-2.5 py-1.5 text-xs">
                            <span className="flex flex-wrap items-center gap-1.5 font-mono text-ink">
                              {t.success ? <CheckCircle2 className="h-3.5 w-3.5 text-success-700" aria-label="succeeded" /> : <XCircle className="h-3.5 w-3.5 text-danger-700" aria-label="failed" />}
                              {t.name}
                              {typeof t.durationMs === 'number' && <span className="text-ink-3">{t.durationMs} ms</span>}
                            </span>
                            {t.error && <span className="mt-0.5 block text-danger-700">{t.error}</span>}
                            {t.args != null && <span className="mt-0.5 block break-all font-mono text-ink-3">{JSON.stringify(t.args)}</span>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="flex items-center gap-1 text-xs font-semibold text-ink-3">
                        <BookOpen className="h-3.5 w-3.5" aria-hidden /> Sources
                      </span>
                      {msg.citations.map((c, idx) => (
                        <Badge key={idx} tone="brand">
                          {c.file}
                          {c.heading ? ` — ${c.heading}` : ''}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                {msg.proposals && msg.proposals.length > 0 && (
                  <div className="mt-2 w-full max-w-[96%] space-y-2">
                    {msg.proposals.map((a) => (
                      <ApprovalCard key={a.id} action={a} />
                    ))}
                  </div>
                )}
                {msg.summarized && <span className="mt-1 text-xs text-ink-3">older turns summarized</span>}
                <span className="mt-1 px-1 text-xs text-ink-3">{msg.timestamp}</span>
                {msg.traceId && (
                  <button onClick={() => copyTrace(msg.traceId!)} title="Click to copy trace ID" className="btn-inline px-1 font-mono text-xs text-ink-3 underline-offset-2 hover:text-ink hover:underline">
                    {copied === msg.traceId ? 'copied' : `trace ${msg.traceId}`}
                  </button>
                )}
              </div>
            ))}

            {loading && (
              <div role="status" className="flex max-w-[95%] items-center gap-3 rounded-lg border border-info-200 bg-info-50 p-3 text-sm text-info-700">
                <Sparkles className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p>Thinking… {elapsed}s</p>
                  {elapsed >= 30 && <p className="text-xs">Still working. A slow model can take a minute; you can cancel.</p>}
                </div>
                <Button variant="secondary" size="sm" onClick={cancelRequest}>
                  Cancel
                </Button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            className="flex items-center gap-2 border-t border-line bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Message to the AI assistant"
              placeholder="Ask the assistant..."
              className="min-h-11 flex-1 rounded-lg border border-line-strong bg-surface px-3.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand-500"
            />
            <Button type="submit" disabled={loading || !input.trim()} aria-label="Send message" icon={<Send className="h-4 w-4" aria-hidden />} className="w-11 px-0" />
          </form>
        </div>
      )}
    </>
  );
};
