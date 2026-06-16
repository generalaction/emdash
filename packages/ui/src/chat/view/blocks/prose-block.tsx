import React from 'react';
import type {
  InlineCode,
  InlineMention,
  InlineRun,
  InlineText,
  ProseBlock,
} from '../../blocks/block-types';
import type { ChatSlots } from '../chat-transcript';

type ProseBlockProps = {
  block: ProseBlock;
  slots?: ChatSlots;
};

// ── Inline run renderer ───────────────────────────────────────────────────────

function renderRun(run: InlineRun, index: number, slots?: ChatSlots): React.ReactNode {
  if (run.kind === 'mention') {
    const mention = run as InlineMention;
    if (slots?.renderMention) {
      return (
        <React.Fragment key={index}>
          {slots.renderMention(mention.label, mention.tone)}
        </React.Fragment>
      );
    }
    return (
      <span key={index} className="chat-mention" data-tone={mention.tone}>
        {mention.label}
      </span>
    );
  }

  if (run.kind === 'code') {
    const code = run as InlineCode;
    return (
      <code key={index} className="chat-code-inline">
        {code.text}
      </code>
    );
  }

  const text = run as InlineText;
  let el: React.ReactNode = text.text;

  if (text.bold && text.italic) {
    el = (
      <strong>
        <em>{el}</em>
      </strong>
    );
  } else if (text.bold) {
    el = <strong>{el}</strong>;
  } else if (text.italic) {
    el = <em>{el}</em>;
  }

  if (text.strike) {
    el = <del>{el}</del>;
  }

  if (text.href) {
    el = (
      <a href={text.href} target="_blank" rel="noopener noreferrer">
        {el}
      </a>
    );
  }

  return <React.Fragment key={index}>{el}</React.Fragment>;
}

function renderInlines(runs: InlineRun[], slots?: ChatSlots): React.ReactNode {
  return runs.map((run, i) => renderRun(run, i, slots));
}

// ── ProseBlock component ───────────────────────────────────────────────────────

/**
 * Check whether runs consists of a single plain text run (no decoration or
 * special kind). This is the dominant case in a typical chat transcript —
 * plain paragraphs, headings, and list items — and we can skip the
 * map+Fragment machinery entirely by using the raw string as the child.
 */
function isSinglePlainText(runs: InlineRun[]): runs is [InlineText] {
  if (runs.length !== 1) return false;
  const r = runs[0];
  return r.kind === 'text' && !r.bold && !r.italic && !r.strike && !r.href;
}

export function ProseBlock({ block, slots }: ProseBlockProps): React.ReactElement {
  const depth = block.depth ?? 0;

  // Fast-path: single plain text run — skip createElement for Fragment/span wrappers.
  if (isSinglePlainText(block.runs)) {
    const text = block.runs[0].text;
    switch (block.variant) {
      case 'h1':
        return <h1 className="chat-h1">{text}</h1>;
      case 'h2':
        return <h2 className="chat-h2">{text}</h2>;
      case 'h3':
        return <h3 className="chat-h3">{text}</h3>;
      case 'h4':
        return <h4 className="chat-h4">{text}</h4>;
      case 'h5':
        return <h5 className="chat-h5">{text}</h5>;
      case 'h6':
        return <h6 className="chat-h6">{text}</h6>;
      case 'list-item':
        return (
          <ul className="chat-list" style={{ paddingLeft: `${18 * (depth + 1)}px` }}>
            <li className="chat-list-item">{text}</li>
          </ul>
        );
      case 'quote':
        return (
          <blockquote className="chat-quote" style={{ paddingLeft: `${18 * (depth + 1)}px` }}>
            {text}
          </blockquote>
        );
      default:
        return <p className="chat-p">{text}</p>;
    }
  }

  // Full path: rich inline runs (bold, italic, code, mentions, links…)
  const content = renderInlines(block.runs, slots);

  switch (block.variant) {
    case 'h1':
      return <h1 className="chat-h1">{content}</h1>;
    case 'h2':
      return <h2 className="chat-h2">{content}</h2>;
    case 'h3':
      return <h3 className="chat-h3">{content}</h3>;
    case 'h4':
      return <h4 className="chat-h4">{content}</h4>;
    case 'h5':
      return <h5 className="chat-h5">{content}</h5>;
    case 'h6':
      return <h6 className="chat-h6">{content}</h6>;
    case 'list-item':
      return (
        <ul className="chat-list" style={{ paddingLeft: `${18 * (depth + 1)}px` }}>
          <li className="chat-list-item">{content}</li>
        </ul>
      );
    case 'quote':
      return (
        <blockquote className="chat-quote" style={{ paddingLeft: `${18 * (depth + 1)}px` }}>
          {content}
        </blockquote>
      );
    default:
      return <p className="chat-p">{content}</p>;
  }
}
