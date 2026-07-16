import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  FileQuestion,
  Globe2,
  Image as ImageIcon,
  LockKeyhole,
} from 'lucide-react';
import { useState } from 'react';
import { writeMobileClipboard } from '../browser-compat';
import type {
  BrowserResourceHandle,
  DiffResourceHandle,
  FileResourceHandle,
} from '../client/types';
import { formatFileSize } from '../model';

function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="markdown-preview">
      {lines.map((line, index) => {
        const key = `${index}:${line.slice(0, 16)}`;
        if (line.startsWith('### ')) return <h3 key={key}>{line.slice(4)}</h3>;
        if (line.startsWith('## ')) return <h2 key={key}>{line.slice(3)}</h2>;
        if (line.startsWith('# ')) return <h1 key={key}>{line.slice(2)}</h1>;
        if (line.startsWith('- ')) return <li key={key}>{line.slice(2)}</li>;
        if (line.startsWith('```')) return <div className="fence" key={key} />;
        if (!line) return <br key={key} />;
        return <p key={key}>{line}</p>;
      })}
    </div>
  );
}

export function FileView({ handle }: { handle: FileResourceHandle }) {
  const lines = handle.content?.split('\n') ?? [];
  const markdown = handle.language === 'markdown' && handle.content;
  return (
    <div className="read-only-view file-view">
      <div className="readonly-banner">
        <LockKeyhole size={14} /> Read-only · {formatFileSize(handle.size)}
        {handle.truncated && <span> · truncated</span>}
      </div>
      {handle.imageUrl ? (
        <div className="image-preview">
          <img src={handle.imageUrl} alt={handle.path} />
          <span>{handle.path}</span>
        </div>
      ) : handle.binary ? (
        <div className="empty-state binary-state">
          <div className="empty-icon">
            <ImageIcon />
          </div>
          <h2>Binary file</h2>
          <p>This file can’t be previewed safely on mobile.</p>
        </div>
      ) : markdown ? (
        <MarkdownPreview content={handle.content ?? ''} />
      ) : handle.content !== undefined ? (
        <pre className="code-view" aria-label={handle.path}>
          {lines.map((line, index) => (
            <span className="code-line" key={`${index}:${line}`}>
              <span className="line-number">{index + 1}</span>
              <code>{line || ' '}</code>
            </span>
          ))}
        </pre>
      ) : (
        <div className="empty-state binary-state">
          <div className="empty-icon">
            <FileQuestion />
          </div>
          <h2>Preview unavailable</h2>
          <p>The desktop could not read this file.</p>
        </div>
      )}
    </div>
  );
}

export function DiffView({ handle }: { handle: DiffResourceHandle }) {
  return (
    <div className="read-only-view diff-view">
      <div className="diff-summary">
        <span>{handle.staged ? 'Staged' : 'Working tree'}</span>
        <strong className="additions">+{handle.additions}</strong>
        <strong className="deletions">−{handle.deletions}</strong>
        <span className="readonly-pill">Read-only</span>
      </div>
      <pre className="diff-code" aria-label={`Diff for ${handle.path}`}>
        {handle.lines.map((line, index) => (
          <span className="diff-line" data-kind={line.kind} key={`${index}:${line.text}`}>
            <span className="diff-number">{line.oldNumber ?? ''}</span>
            <span className="diff-number">{line.newNumber ?? ''}</span>
            <code>
              {line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' '}
              {line.text}
            </code>
          </span>
        ))}
      </pre>
      {handle.truncated && <div className="truncated-note">Diff truncated on the desktop.</div>}
    </div>
  );
}

export function BrowserView({ handle }: { handle: BrowserResourceHandle }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!(await writeMobileClipboard(handle.url))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <div className="browser-view">
      <div className="browser-orbit">
        <div className="browser-glow" />
        <Globe2 size={42} strokeWidth={1.25} />
      </div>
      <p className="eyebrow">Desktop browser tab</p>
      <h2>{handle.summary.title}</h2>
      <div className="url-card">
        <span>{handle.url}</span>
        <button type="button" onClick={copy} aria-label="Copy URL">
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
      {handle.warning && (
        <div className="browser-warning">
          <AlertTriangle size={17} />
          <p>{handle.warning}</p>
        </div>
      )}
      {handle.openable ? (
        <a className="primary-link" href={handle.url} target="_blank" rel="noreferrer noopener">
          Open in this browser <ArrowUpRight size={17} />
        </a>
      ) : (
        <button className="primary-link" type="button" disabled>
          Not reachable from this phone
        </button>
      )}
      <p className="browser-footnote">
        Emdash opens the address only. Desktop cookies and browser state are never shared.
      </p>
    </div>
  );
}
