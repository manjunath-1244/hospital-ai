'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { KnowledgeDoc, KnowledgeReindexResult } from '../../lib/types';
import { Empty, ErrorBox, Loading, SuccessBox, fmtTime, inputCls, labelCls } from '../ui/common';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['.md', '.txt', '.pdf'];

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

export const KnowledgeBasePanel: React.FC = () => {
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileTitle, setFileTitle] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [reindexing, setReindexing] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const load = useCallback(async () => {
    try {
      setDocs(await apiFetch<KnowledgeDoc[]>('/admin/knowledge'));
      setListError('');
    } catch (e) {
      setListError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    setMsg('');
    const f = e.target.files?.[0] ?? null;
    if (f) {
      const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
      if (!ALLOWED.includes(ext)) {
        setError(`Unsupported file type "${ext}". Allowed: ${ALLOWED.join(', ')}.`);
        e.target.value = '';
        setFile(null);
        return;
      }
      if (f.size > MAX_BYTES) {
        setError(`File is ${fmtSize(f.size)}; the maximum is 5 MB.`);
        e.target.value = '';
        setFile(null);
        return;
      }
      if (f.size === 0) {
        setError('File is empty.');
        e.target.value = '';
        setFile(null);
        return;
      }
    }
    setFile(f);
  };

  const done = (d: KnowledgeDoc) => {
    setMsg(`Indexed ${d.chunkCount} chunks — the agent can use it immediately`);
    load();
  };

  const uploadFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (fileTitle.trim()) fd.append('title', fileTitle.trim());
      done(await apiFetch<KnowledgeDoc>('/admin/knowledge', { method: 'POST', formData: fd }));
      setFile(null);
      setFileTitle('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteTitle.trim() || !pasteText.trim()) return;
    setBusy(true);
    setMsg('');
    setError('');
    try {
      done(await apiFetch<KnowledgeDoc>('/admin/knowledge', { method: 'POST', body: { title: pasteTitle.trim(), content: pasteText } }));
      setPasteTitle('');
      setPasteText('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: KnowledgeDoc) => {
    if (!window.confirm(`Delete "${d.title}"? The agent will no longer be able to use it.`)) return;
    setDeletingId(d.id);
    setMsg('');
    setError('');
    try {
      await apiFetch<{ success: boolean }>(`/admin/knowledge/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
      setMsg(`Deleted "${d.title}".`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeletingId('');
    }
  };

  const reindex = async () => {
    setReindexing(true);
    setMsg('');
    setError('');
    try {
      const r = await apiFetch<KnowledgeReindexResult>('/admin/knowledge/reindex', { method: 'POST', body: {} });
      setMsg(`Re-indexed ${r.documents} documents (${r.chunks} chunks) and ${r.patients} patients.`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setReindexing(false);
    }
  };

  return (
    <div className="glass-panel p-7 rounded-2xl border border-slate-700 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-700 pb-4">
        <h3 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-emerald-400" />
          Hospital Knowledge Base (agent training documents)
        </h3>
        <button onClick={reindex} disabled={reindexing} className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-slate-300 hover:text-white border border-slate-700 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${reindexing ? 'animate-spin' : ''}`} /> {reindexing ? 'Re-indexing...' : 'Re-index everything'}
        </button>
      </div>

      <SuccessBox message={msg} />
      <ErrorBox message={error} />

      {!docs && !listError && <Loading text="Loading documents..." />}
      <ErrorBox message={listError} />
      {docs && docs.length === 0 && <Empty text="No documents indexed." />}
      {docs && docs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="pb-2 px-2">Title</th><th className="pb-2 px-2">Filename</th><th className="pb-2 px-2">Origin</th><th className="pb-2 px-2">Size</th><th className="pb-2 px-2">Chunks</th><th className="pb-2 px-2">Uploaded</th><th className="pb-2 px-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="py-2 px-2 font-semibold text-white">{d.title}</td>
                  <td className="py-2 px-2 font-mono break-all">{d.filename}</td>
                  <td className="py-2 px-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-bold ${d.origin === 'builtin' ? 'bg-slate-700/50 text-slate-300' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {d.origin === 'builtin' ? 'built-in' : 'uploaded'}
                    </span>
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap">{fmtSize(d.sizeBytes)}</td>
                  <td className="py-2 px-2">{d.chunkCount}</td>
                  <td className="py-2 px-2 whitespace-nowrap">{d.uploadedBy ? `${d.uploadedBy} • ${fmtTime(d.createdAt)}` : '—'}</td>
                  <td className="py-2 px-2 text-right">
                    {d.origin === 'uploaded' && (
                      <button onClick={() => remove(d)} disabled={deletingId === d.id} className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2 py-1 text-sm font-bold text-rose-400 hover:bg-rose-500/10 disabled:opacity-50">
                        <Trash2 className="h-4 w-4" /> {deletingId === d.id ? 'Deleting...' : 'Delete'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form onSubmit={uploadFile} className="rounded-xl bg-slate-950 p-4 border border-slate-700 space-y-3">
          <p className="text-sm font-bold text-white flex items-center gap-2"><UploadCloud className="h-5 w-5 text-emerald-400" /> Upload a file (.md, .txt, .pdf — max 5 MB)</p>
          <input ref={fileRef} type="file" accept=".md,.txt,.pdf" onChange={onFile} disabled={busy} className={inputCls} />
          <div>
            <label className={labelCls}>Title (optional)</label>
            <input value={fileTitle} onChange={(e) => setFileTitle(e.target.value)} disabled={busy} className={inputCls} />
          </div>
          <button type="submit" disabled={busy || !file} className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-6 py-2.5 text-sm font-bold text-white  disabled:opacity-50">
            {busy ? 'Uploading & indexing...' : 'Upload & index'}
          </button>
        </form>

        <form onSubmit={uploadText} className="rounded-xl bg-slate-950 p-4 border border-slate-700 space-y-3">
          <p className="text-sm font-bold text-white">Paste text</p>
          <div>
            <label className={labelCls}>Title *</label>
            <input required value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} disabled={busy} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Content *</label>
            <textarea required rows={4} value={pasteText} onChange={(e) => setPasteText(e.target.value)} disabled={busy} className={inputCls} />
          </div>
          <button type="submit" disabled={busy || !pasteTitle.trim() || !pasteText.trim()} className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-6 py-2.5 text-sm font-bold text-white  disabled:opacity-50">
            {busy ? 'Indexing...' : 'Save & index'}
          </button>
        </form>
      </div>
    </div>
  );
};
