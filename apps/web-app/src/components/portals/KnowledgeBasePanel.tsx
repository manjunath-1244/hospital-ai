'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, RefreshCw, Trash2, UploadCloud } from 'lucide-react';
import { apiFetch, errorMessage } from '../../lib/api';
import type { KnowledgeDoc, KnowledgeReindexResult } from '../../lib/types';
import { ErrorBox, Loading, fmtTime, inputCls } from '../ui/common';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, SectionTitle, TableFrame, Textarea } from '../ui/kit';

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
    <Card>
      <SectionTitle
        icon={<BookOpen className="h-5 w-5" />}
        actions={
          <Button variant="secondary" onClick={reindex} loading={reindexing} icon={<RefreshCw className="h-4 w-4" />}>
            {reindexing ? 'Re-indexing...' : 'Re-index everything'}
          </Button>
        }
      >
        Hospital Knowledge Base (agent training documents)
      </SectionTitle>

      <div className="space-y-4">
        {msg && <Alert tone="success" live="polite">{msg}</Alert>}
        <ErrorBox message={error} />

        {!docs && !listError && <Loading text="Loading documents..." />}
        <ErrorBox message={listError} />
        {docs && docs.length === 0 && <EmptyState title="No documents indexed." hint="Upload a file or paste text below so the agent can use it." />}
        {docs && docs.length > 0 && (
          <TableFrame>
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Filename</th>
                  <th scope="col">Origin</th>
                  <th scope="col">Size</th>
                  <th scope="col">Chunks</th>
                  <th scope="col">Uploaded</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium text-ink">{d.title}</td>
                    <td className="break-all font-mono text-xs">{d.filename}</td>
                    <td>
                      <Badge tone={d.origin === 'builtin' ? 'neutral' : 'brand'}>{d.origin === 'builtin' ? 'built-in' : 'uploaded'}</Badge>
                    </td>
                    <td className="whitespace-nowrap">{fmtSize(d.sizeBytes)}</td>
                    <td>{d.chunkCount}</td>
                    <td className="whitespace-nowrap">{d.uploadedBy ? `${d.uploadedBy} • ${fmtTime(d.createdAt)}` : '—'}</td>
                    <td className="text-right">
                      {d.origin === 'uploaded' && (
                        <Button variant="danger" size="sm" onClick={() => remove(d)} loading={deletingId === d.id} icon={<Trash2 className="h-4 w-4" />}>
                          {deletingId === d.id ? 'Deleting...' : 'Delete'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <form onSubmit={uploadFile} className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
            <SectionTitle as="h3" icon={<UploadCloud className="h-5 w-5" />} className="mb-0" hint="Maximum 5 MB.">
              Upload a file (.md, .txt, .pdf — max 5 MB)
            </SectionTitle>
            <Field label="File">
              {(id) => <input id={id} ref={fileRef} type="file" accept=".md,.txt,.pdf" onChange={onFile} disabled={busy} className={inputCls} />}
            </Field>
            <Field label="Title (optional)">
              {(id) => <Input id={id} value={fileTitle} onChange={(e) => setFileTitle(e.target.value)} disabled={busy} />}
            </Field>
            <Button type="submit" loading={busy} disabled={!file} data-testid="kb-upload-submit">
              {busy ? 'Uploading & indexing...' : 'Upload & index'}
            </Button>
          </form>

          <form onSubmit={uploadText} className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
            <SectionTitle as="h3" className="mb-0">Paste text</SectionTitle>
            <Field label="Title *">
              {(id) => <Input id={id} required value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} disabled={busy} />}
            </Field>
            <Field label="Content *">
              {(id) => <Textarea id={id} required rows={4} value={pasteText} onChange={(e) => setPasteText(e.target.value)} disabled={busy} />}
            </Field>
            <Button type="submit" loading={busy} disabled={!pasteTitle.trim() || !pasteText.trim()} data-testid="kb-paste-submit">
              {busy ? 'Indexing...' : 'Save & index'}
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
};
