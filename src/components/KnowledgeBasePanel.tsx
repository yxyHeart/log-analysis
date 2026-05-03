"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { uploadFiles, addUrl, listDocuments, deleteDocument, checkHealth } from "@/lib/rag";
import type { KBDocument } from "@/lib/types";

interface KnowledgeBasePanelProps {
  open: boolean;
  onClose: () => void;
  ragServiceUrl: string;
}

type UploadState = "idle" | "uploading" | "success" | "error";

export default function KnowledgeBasePanel({ open, onClose, ragServiceUrl }: KnowledgeBasePanelProps) {
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [serviceOnline, setServiceOnline] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshDocs = useCallback(async () => {
    try {
      const docs = await listDocuments(ragServiceUrl);
      setDocuments(docs);
    } catch {
      setDocuments([]);
    }
  }, [ragServiceUrl]);

  useEffect(() => {
    if (!open) return;
    checkHealth(ragServiceUrl).then(setServiceOnline);
    refreshDocs();
  }, [open, ragServiceUrl, refreshDocs]);

  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadState("uploading");
    setErrorMsg("");
    try {
      await uploadFiles(Array.from(files), ragServiceUrl);
      setUploadState("success");
      await refreshDocs();
    } catch (e) {
      setUploadState("error");
      setErrorMsg(e instanceof Error ? e.message : "Upload failed");
    }
    setTimeout(() => setUploadState("idle"), 2000);
  }, [ragServiceUrl, refreshDocs]);

  const handleUrlAdd = useCallback(async () => {
    if (!urlInput.trim()) return;
    setUploadState("uploading");
    setErrorMsg("");
    try {
      await addUrl(urlInput.trim(), ragServiceUrl);
      setUploadState("success");
      setUrlInput("");
      await refreshDocs();
    } catch (e) {
      setUploadState("error");
      setErrorMsg(e instanceof Error ? e.message : "Failed to add URL");
    }
    setTimeout(() => setUploadState("idle"), 2000);
  }, [urlInput, ragServiceUrl, refreshDocs]);

  const handleDelete = useCallback(async (docId: string) => {
    setDeleting(docId);
    try {
      await deleteDocument(docId, ragServiceUrl);
      await refreshDocs();
    } catch {
      // silently fail
    }
    setDeleting(null);
  }, [ragServiceUrl, refreshDocs]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFileUpload(e.dataTransfer.files);
  }, [handleFileUpload]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel rounded-xl w-full max-w-lg shadow-[0_0_60px_rgba(0,0,0,0.5)] animate-float-up max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-dim)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-[var(--bg-surface)] border border-[var(--border-dim)]">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-muted)]">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <h2 className="text-sm font-mono font-semibold tracking-wider text-[var(--text-primary)] uppercase">
              Knowledge Base
            </h2>
            <div className="flex items-center gap-1.5 ml-2">
              <span className={`w-1.5 h-1.5 rounded-full ${serviceOnline ? "bg-[var(--accent-green)]" : "bg-[var(--accent-red)]"}`} />
              <span className="text-[9px] font-mono text-[var(--text-muted)]">
                {serviceOnline ? "ONLINE" : "OFFLINE"}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-auto flex-1">
          {/* File upload zone */}
          <div>
            <label className="block text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase mb-2">
              Upload Documents
            </label>
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[var(--border-mid)] rounded-lg p-6 text-center cursor-pointer hover:border-[var(--accent-green)]/30 transition-colors duration-300"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.markdown"
                multiple
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 text-[var(--text-muted)]">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p className="text-[11px] font-mono text-[var(--text-muted)]">
                Drop .md or .txt files here, or click to browse
              </p>
            </div>
          </div>

          {/* URL input */}
          <div>
            <label className="block text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase mb-2">
              Add from URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUrlAdd()}
                placeholder="https://docs.example.com/troubleshooting"
                className="flex-1 px-3 py-2.5 rounded-lg bg-[var(--bg-surface)]/80 text-[var(--text-primary)] text-[13px] font-mono border border-[var(--border-dim)] outline-none focus:border-[var(--accent-green)]/30 transition-colors duration-300 placeholder:text-[var(--text-muted)]/40"
              />
              <button
                onClick={handleUrlAdd}
                disabled={!urlInput.trim() || uploadState === "uploading"}
                className="px-4 py-2.5 rounded-lg font-mono text-[11px] tracking-wider uppercase border border-[var(--border-dim)] text-[var(--text-secondary)] hover:border-[var(--accent-green)]/30 hover:text-[var(--accent-green)] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
              >
                Add
              </button>
            </div>
          </div>

          {/* Upload status */}
          {uploadState !== "idle" && (
            <div className={`text-[10px] font-mono flex items-center gap-1.5 ${
              uploadState === "uploading" ? "text-[var(--accent-cyan)]" :
              uploadState === "success" ? "text-[var(--accent-green)]" :
              "text-[var(--accent-red)]"
            }`}>
              {uploadState === "uploading" && (
                <><div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> Processing...</>
              )}
              {uploadState === "success" && (
                <><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg> Done</>
              )}
              {uploadState === "error" && (
                <><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> {errorMsg}</>
              )}
            </div>
          )}

          {/* Document list */}
          <div>
            <label className="block text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase mb-2">
              Documents ({documents.length})
            </label>
            {documents.length === 0 ? (
              <p className="text-[11px] font-mono text-[var(--text-muted)] py-4 text-center">
                No documents in knowledge base
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-auto">
                {documents.map((doc) => (
                  <div
                    key={doc.docId}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border-dim)]"
                  >
                    <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">
                      {doc.sourceType === "file" ? "DOC" : "URL"}
                    </span>
                    <span className="text-[11px] font-mono text-[var(--text-primary)] truncate flex-1" title={doc.source}>
                      {doc.source}
                    </span>
                    <span className="text-[9px] font-mono text-[var(--text-muted)] shrink-0">
                      {doc.chunkCount} chunks
                    </span>
                    <button
                      onClick={() => handleDelete(doc.docId)}
                      disabled={deleting === doc.docId}
                      className="p-1 rounded hover:bg-[var(--accent-red-dim)] text-[var(--text-muted)] hover:text-[var(--accent-red)] disabled:opacity-30 transition-colors shrink-0"
                    >
                      {deleting === doc.docId ? (
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-dim)] flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded font-mono text-[11px] font-semibold tracking-wider uppercase bg-[var(--accent-green)] text-[var(--bg-void)] hover:shadow-[0_0_16px_rgba(0,255,136,0.25)] transition-all duration-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
