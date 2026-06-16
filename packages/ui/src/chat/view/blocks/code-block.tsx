import React from 'react';
import type { CodeBlock as CodeBlockType } from '../../blocks/block-types';
import type { ChatSlots } from '../chat-transcript';

type CodeBlockProps = {
  block: CodeBlockType;
  slots?: ChatSlots;
};

/**
 * CodeBlock — renders a fenced code block.
 *
 * If `slots.renderCode` is provided it delegates to the slot (for e.g. Prism
 * syntax highlighting).  The default renders a plain `<pre>` with the raw code.
 */
export function CodeBlock({ block, slots }: CodeBlockProps): React.ReactElement {
  if (slots?.renderCode) {
    return <>{slots.renderCode(block)}</>;
  }

  return (
    <div className="chat-code-block">
      {block.lang && (
        <div className="chat-code-lang" aria-label={`Language: ${block.lang}`}>
          {block.lang}
        </div>
      )}
      <pre>
        <code>{block.code}</code>
      </pre>
    </div>
  );
}
