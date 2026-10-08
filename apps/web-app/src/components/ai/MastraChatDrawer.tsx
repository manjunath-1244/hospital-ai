'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Send, Bot, CheckCircle2, XCircle, BookOpen, AlertTriangle, Plus, History, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, errorMessage, newId } from '../../lib/api';
import { ApprovalCard } from './ApprovalCard';
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

  const cancelRequest = () => abortRef.current?.abort();

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

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle AI assistant"
        data-testid="chat-toggle"
        title="AI Assistant"
        className="group fixed bottom-6 right-6 z-50 flex h-16 items-center gap-3 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-500 pl-5 pr-6 text-white shadow-xl shadow-black/50 border border-indigo-300/30 hover:from-indigo-500 hover:to-indigo-400"
      >
        <Sparkles className="h-6 w-6" aria-hidden="true" />
        <span className="text-base font-bold">Ask AI</span>
      </button>

      {isOpen && (
        <div data-testid="chat-drawer" className="fixed bottom-28 right-6 z-50 flex h-[80vh] max-h-[760px] w-[520px] max-w-[calc(100vw-2rem)] flex-col rounded-3xl glass-panel border border-slate-600 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-5 py-4">
            <div className="flex items-center space-x-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600/30 border border-indigo-500/40">
                <Bot className="h-5 w-5 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white leading-tight">AI Assistant</h3>
                <p className="text-sm text-slate-300">Signed in as {user?.displayName}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={newChat} title="New chat" className="whitespace-nowrap shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 text-sm font-bold text-slate-200 hover:bg-slate-800 hover:text-white">
                <Plus className="h-4 w-4" /> New chat
              </button>
              <button onClick={toggleThreads} title="Previous chats" aria-label="Previous chats" className={`flex h-10 w-10 items-center justify-center rounded-lg hover:bg-slate-800 hover:text-white ${showThreads ? 'text-indigo-400' : 'text-slate-400'}`}>
                <History className="h-5 w-5" />
              </button>
              <button onClick={() => setIsOpen(false)} aria-label="Close AI assistant" className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {showThreads && (
            <div className="max-h-64 overflow-y-auto border-b border-slate-700 bg-slate-950/80 p-2 space-y-1">
              {threadsLoading && <p className="p-2 text-sm text-slate-300">Loading chats...</p>}
              {threadsError && <p className="p-2 text-sm font-semibold text-rose-300">{threadsError}</p>}
              {threads && threads.length === 0 && !threadsLoading && <p className="p-2 text-sm text-slate-400">No previous chats.</p>}
              {threads?.map((t) => (
                <div key={t.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-800/70 ${t.id === threadId ? 'bg-slate-800/60' : ''}`}>
                  <button onClick={() => openThread(t.id)} className="min-w-0 flex-1 text-left">
                    <p className="truncate font-semibold text-slate-200">{t.title || 'Untitled chat'}</p>
                    <p className="text-xs text-slate-400">{new Date(t.updatedAt).toLocaleString()}</p>
                  </button>
                  <button onClick={() => deleteThread(t.id)} title="Delete chat" aria-label="Delete chat" className="flex h-10 w-10 items-center justify-center rounded text-slate-400 hover:text-rose-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <p className="text-base text-slate-300 leading-relaxed">Ask a question about a patient, policy, or workflow. Answers are AI-generated and need clinician review.</p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`max-w-[92%] rounded-2xl px-4 py-3 text-base leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-md'
                      : msg.isError
                      ? 'bg-rose-950/60 text-rose-200 border border-rose-500/40 rounded-bl-none'
                      : 'bg-slate-800 text-slate-100 border border-slate-600 rounded-bl-md'
                  }`}
                >
                  <p className={`whitespace-pre-wrap break-words ${msg.sender === 'user' ? 'text-base leading-relaxed' : 'font-mono text-[0.9rem] leading-7'}`}>{msg.text}</p>

                  {msg.guardrailStatus === 'WARNING' && (
                    <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                      <p className="font-bold flex items-center gap-1">
                        <AlertTriangle className="h-4 w-4" /> Guardrail warning
                      </p>
                      {msg.guardrailNotes?.map((n, i) => (
                        <p key={i}>- {n}</p>
                      ))}
                    </div>
                  )}

                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t border-slate-600 pt-3">
                      <p className="text-sm font-bold text-slate-300">Tools called:</p>
                      {msg.toolCalls.map((t, idx) => (
                        <span
                          key={idx}
                          title={t.args ? JSON.stringify(t.args) : undefined}
                          className="inline-flex items-center gap-1 rounded-md bg-indigo-950/80 px-2.5 py-1 text-[0.8125rem] font-mono text-indigo-200 border border-indigo-700/60 mr-1.5 mb-1"
                        >
                          {t.success ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}
                          {t.name}
                          {typeof t.durationMs === 'number' && <span className="text-slate-400">{t.durationMs} ms</span>}
                        </span>
                      ))}
                    </div>
                  )}

                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-sm font-bold text-slate-300 flex items-center gap-1">
                        <BookOpen className="h-4 w-4 text-amber-400" /> Sources:
                      </p>
                      {msg.citations.map((c, idx) => (
                        <span key={idx} className="inline-block rounded-md bg-amber-950/80 px-2.5 py-1 text-[0.8125rem] font-medium text-amber-200 border border-amber-700/60 mr-1.5 mb-1">
                          {c.file}
                          {c.heading ? ` — ${c.heading}` : ''}
                        </span>
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
                {msg.summarized && (
                  <span className="mt-1 rounded-full border border-slate-700 bg-slate-900 px-3 py-0.5 text-xs text-slate-300">older turns summarized</span>
                )}
                <span className="mt-1 text-xs text-slate-400 font-mono px-1">{msg.timestamp}</span>
                {msg.traceId && (
                  <button onClick={() => copyTrace(msg.traceId!)} title="Click to copy trace ID" className="btn-inline px-1 text-xs font-mono text-slate-300 hover:text-white underline-offset-2 hover:underline">
                    {copied === msg.traceId ? 'copied' : `trace ${msg.traceId}`}
                  </button>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-3 rounded-xl bg-slate-900 p-4 text-base text-indigo-200 border border-indigo-500/30 max-w-[95%]">
                <Sparkles className="h-5 w-5 shrink-0 animate-spin" />
                <div className="min-w-0 flex-1">
                  <p>Thinking… {elapsed}s</p>
                  {elapsed >= 30 && <p className="text-sm text-amber-300">Still working — local/slow models can take a minute</p>}
                </div>
                <button onClick={cancelRequest} className="shrink-0 rounded-lg border border-slate-600 px-3 text-sm font-bold text-slate-300 hover:bg-slate-800 hover:text-white">
                  Cancel
                </button>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 border-t border-slate-700 bg-slate-900 flex items-center gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask the assistant..."
              className="flex-1 min-h-12 rounded-xl bg-slate-950 px-4 py-2.5 text-base text-white placeholder-slate-500 border border-slate-600 focus:outline-none focus:border-indigo-400"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
