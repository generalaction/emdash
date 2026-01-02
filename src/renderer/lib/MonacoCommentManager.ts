import type * as monaco from 'monaco-editor';
import { createRoot, Root } from 'react-dom/client';
import React from 'react';
import { CommentWidget } from '../components/diff/CommentWidget';
import { CommentInput } from '../components/diff/CommentInput';
import { CommentContextBridge } from '../components/diff/CommentContextBridge';

interface LineComment {
  id: string;
  taskId: string;
  filePath: string;
  lineNumber: number;
  lineContent?: string | null;
  side: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface MonacoCommentManagerOptions {
  onAddComment: (
    lineNumber: number,
    side: 'original' | 'modified',
    content: string,
    lineContent?: string
  ) => Promise<string | null | undefined>;
  onEditComment: (id: string, content: string) => Promise<boolean>;
  onDeleteComment: (id: string) => Promise<boolean>;
  theme: 'light' | 'dark';
}

export class MonacoCommentManager {
  private editor: monaco.editor.IStandaloneDiffEditor;
  private options: MonacoCommentManagerOptions;
  private viewZoneRoots: Map<
    string,
    { zoneId: string; root: Root; domNode: HTMLElement; lineNumber: number }
  > = new Map();
  private decorationIds: string[] = [];
  private hoverDecorationIds: string[] = [];
  private pinnedDecorationIds: string[] = [];
  private hoveredLine: number | null = null;
  private commentedLines: Set<number> = new Set();
  private inputZoneId: string | null = null;
  private inputRoot: Root | null = null;
  private inputDomNode: HTMLElement | null = null;
  private activeInputLine: number | null = null;
  private disposed = false;

  constructor(editor: monaco.editor.IStandaloneDiffEditor, options: MonacoCommentManagerOptions) {
    this.editor = editor;
    this.options = options;
    this.setupGutterClickHandler();
    this.setupHoverHandler();
  }

  private setupGutterClickHandler() {
    const modifiedEditor = this.editor.getModifiedEditor();

    modifiedEditor.onMouseDown((e) => {
      if (e.target.type !== 2) return;
      const targetElement = e.target.element;
      if (!targetElement?.classList.contains('comment-hover-icon')) return;

      const lineNumber = e.target.position?.lineNumber;
      if (!lineNumber) return;

      e.event?.preventDefault();
      e.event?.stopPropagation();

      const model = modifiedEditor.getModel();
      const lineContent = model?.getLineContent(lineNumber) ?? '';
      this.showInputAt(lineNumber, 'modified', lineContent);
    });
  }

  private setupHoverHandler() {
    const modifiedEditor = this.editor.getModifiedEditor();

    modifiedEditor.onMouseMove((e) => {
      if (this.disposed) return;
      const targetElement = e.target.element as HTMLElement | null;
      if (targetElement?.closest?.('.comment-view-zone')) {
        this.clearHoverDecoration();
        this.hoveredLine = null;
        return;
      }

      // Get line number from any target that has a position
      // Types: 2=GUTTER_GLYPH_MARGIN, 3=GUTTER_LINE_NUMBERS, 4=GUTTER_LINE_DECORATIONS,
      // 6=CONTENT_TEXT, 7=CONTENT_EMPTY
      const lineNumber = e.target.position?.lineNumber;

      if (lineNumber && lineNumber !== this.hoveredLine) {
        if (lineNumber === this.activeInputLine) {
          this.clearHoverDecoration();
          this.hoveredLine = lineNumber;
          return;
        }
        // Always show hover icon - users can add multiple comments to the same line
        this.setHoverDecoration(lineNumber);
        this.hoveredLine = lineNumber;
      } else if (!lineNumber && this.hoveredLine !== null) {
        // Mouse moved to area without a line (e.g., scrollbar, minimap)
        this.clearHoverDecoration();
        this.hoveredLine = null;
      }
    });

    modifiedEditor.onMouseLeave(() => {
      if (this.disposed) return;
      this.clearHoverDecoration();
      this.hoveredLine = null;
    });
  }

  private setHoverDecoration(lineNumber: number) {
    const modifiedEditor = this.editor.getModifiedEditor();

    const decoration: monaco.editor.IModelDeltaDecoration = {
      range: {
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: 1,
      },
      options: {
        glyphMarginClassName: 'comment-hover-icon',
      },
    };

    this.hoverDecorationIds = modifiedEditor.deltaDecorations(
      this.hoverDecorationIds,
      [decoration]
    );
  }

  private setPinnedDecoration(lineNumber: number) {
    const modifiedEditor = this.editor.getModifiedEditor();

    const decoration: monaco.editor.IModelDeltaDecoration = {
      range: {
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: 1,
      },
      options: {
        glyphMarginClassName: 'comment-hover-icon comment-hover-icon-pinned',
      },
    };

    this.pinnedDecorationIds = modifiedEditor.deltaDecorations(
      this.pinnedDecorationIds,
      [decoration]
    );
  }

  private clearHoverDecoration() {
    const modifiedEditor = this.editor.getModifiedEditor();
    this.hoverDecorationIds = modifiedEditor.deltaDecorations(
      this.hoverDecorationIds,
      []
    );
  }

  private clearPinnedDecoration() {
    const modifiedEditor = this.editor.getModifiedEditor();
    this.pinnedDecorationIds = modifiedEditor.deltaDecorations(
      this.pinnedDecorationIds,
      []
    );
  }

  private focusInputTextarea() {
    const textarea = this.inputDomNode?.querySelector('textarea');
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.focus();
    }
  }

  setTheme(theme: 'light' | 'dark') {
    this.options.theme = theme;
    // Re-render all widgets with new theme
    // This will be handled by setComments being called again
  }

  setComments(comments: LineComment[]) {
    if (this.disposed) return;

    const modifiedEditor = this.editor.getModifiedEditor();

    // Group comments by line
    const commentsByLine = new Map<number, LineComment[]>();
    for (const comment of comments) {
      if (comment.side === 'modified') {
        const existing = commentsByLine.get(comment.lineNumber) ?? [];
        existing.push(comment);
        commentsByLine.set(comment.lineNumber, existing);
      }
    }

    // Update decorations (glyph margin icons)
    this.updateDecorations(commentsByLine);

    const nextComments = comments.filter((comment) => comment.side === 'modified');
    const nextById = new Map<string, LineComment>(
      nextComments.map((comment) => [comment.id, comment])
    );

    // Update view zones with minimal churn to avoid flicker.
    modifiedEditor.changeViewZones((accessor) => {
      // Remove stale zones
      for (const [commentId, zoneInfo] of Array.from(this.viewZoneRoots.entries())) {
        if (!nextById.has(commentId)) {
          accessor.removeZone(zoneInfo.zoneId);
          zoneInfo.root.unmount();
          this.viewZoneRoots.delete(commentId);
        }
      }

      // Add or update zones for current comments
      for (const comment of nextComments) {
        const existing = this.viewZoneRoots.get(comment.id);
        if (existing) {
          existing.domNode.dataset.lineNumber = String(comment.lineNumber);
          existing.domNode.style.padding = '12px';
          existing.domNode.style.boxSizing = 'border-box';
          existing.domNode.className = 'comment-view-zone bg-muted/40 border border-border';

          existing.root.render(
            React.createElement(
              CommentContextBridge,
              { value: { theme: this.options.theme } },
              React.createElement(CommentWidget, {
                comment,
                theme: this.options.theme,
                onEdit: (content) => this.options.onEditComment(comment.id, content),
                onDelete: () => this.options.onDeleteComment(comment.id),
              })
            )
          );

          if (existing.lineNumber !== comment.lineNumber) {
            accessor.removeZone(existing.zoneId);
            const zoneId = accessor.addZone({
              afterLineNumber: comment.lineNumber,
              heightInPx: 140 + 24,
              domNode: existing.domNode,
              suppressMouseDown: false,
              showInHiddenAreas: true,
            });
            this.viewZoneRoots.set(comment.id, {
              ...existing,
              zoneId,
              lineNumber: comment.lineNumber,
            });
          }
          continue;
        }

        const domNode = document.createElement('div');
        domNode.style.padding = '12px'; // Space around comments
        domNode.style.boxSizing = 'border-box';
        domNode.className = 'comment-view-zone bg-muted/40 border border-border';
        domNode.style.pointerEvents = 'auto'; // Ensure clicks work
        domNode.style.position = 'relative';
        domNode.style.zIndex = '10';
        domNode.style.width = '100%';
        domNode.dataset.lineNumber = String(comment.lineNumber);

        const root = createRoot(domNode);
        root.render(
          React.createElement(
            CommentContextBridge,
            { value: { theme: this.options.theme } },
            React.createElement(CommentWidget, {
              comment,
              theme: this.options.theme,
              onEdit: (content) => this.options.onEditComment(comment.id, content),
              onDelete: () => this.options.onDeleteComment(comment.id),
            })
          )
        );

        const zoneId = accessor.addZone({
          afterLineNumber: comment.lineNumber,
          heightInPx: 140 + 24,
          domNode,
          suppressMouseDown: false,
          showInHiddenAreas: true,
        });

        this.viewZoneRoots.set(comment.id, {
          zoneId,
          root,
          domNode,
          lineNumber: comment.lineNumber,
        });
      }
    });
  }

  private updateDecorations(commentsByLine: Map<number, LineComment[]>) {
    const modifiedEditor = this.editor.getModifiedEditor();

    // Update the set of commented lines for hover logic
    // No glyph margin icon needed - the comment widget itself is the indicator
    this.commentedLines.clear();
    for (const [lineNumber] of commentsByLine) {
      this.commentedLines.add(lineNumber);
    }

    // Clear any existing decorations (we don't show icons for commented lines)
    this.decorationIds = modifiedEditor.deltaDecorations(this.decorationIds, []);
  }

  showInputAt(lineNumber: number, side: 'original' | 'modified', lineContent: string) {
    if (this.activeInputLine === lineNumber && this.inputDomNode) {
      this.focusInputTextarea();
      return;
    }

    this.hideInput();

    const modifiedEditor = this.editor.getModifiedEditor();
    this.activeInputLine = lineNumber;
    this.setPinnedDecoration(lineNumber);

    this.inputDomNode = document.createElement('div');
    this.inputRoot = createRoot(this.inputDomNode);

    this.inputRoot.render(
      React.createElement(
        CommentContextBridge,
        { value: { theme: this.options.theme } },
        React.createElement(CommentInput, {
          lineNumber,
          lineContent,
          side,
          theme: this.options.theme,
          onSubmit: async (content) => {
            await this.options.onAddComment(lineNumber, side, content, lineContent);
            this.hideInput();
          },
          onCancel: () => this.hideInput(),
        })
      )
    );

    this.inputDomNode.style.padding = '12px';
    this.inputDomNode.style.boxSizing = 'border-box';
    this.inputDomNode.className = 'comment-view-zone bg-muted/40 border border-border';
    this.inputDomNode.style.pointerEvents = 'auto';
    this.inputDomNode.style.position = 'relative';
    this.inputDomNode.style.zIndex = '10';
    this.inputDomNode.style.width = '100%';
    this.inputDomNode.dataset.lineNumber = String(lineNumber);

    const initialHeight = 140;
    modifiedEditor.changeViewZones((accessor) => {
      this.inputZoneId = accessor.addZone({
        afterLineNumber: lineNumber,
        heightInPx: initialHeight + 24,
        domNode: this.inputDomNode!,
        suppressMouseDown: false,
        showInHiddenAreas: true,
      });
    });

    const focusTextarea = () => {
      const textarea = this.inputDomNode?.querySelector('textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus();
        textarea.select();
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        focusTextarea();
      });
    });
    setTimeout(() => {
      focusTextarea();
    }, 80);
  }

  hideInput() {
    if (this.inputZoneId) {
      const modifiedEditor = this.editor.getModifiedEditor();
      modifiedEditor.changeViewZones((accessor) => {
        if (this.inputZoneId) accessor.removeZone(this.inputZoneId);
      });
      this.inputZoneId = null;
    }
    if (this.inputRoot) {
      this.inputRoot.unmount();
      this.inputRoot = null;
    }
    this.inputDomNode = null;
    const hoveredLine = this.hoveredLine;
    this.activeInputLine = null;
    this.clearPinnedDecoration();
    if (hoveredLine) {
      this.setHoverDecoration(hoveredLine);
    }
  }

  dispose() {
    this.disposed = true;
    this.hideInput();

    // Cleanup view zones
    const modifiedEditor = this.editor.getModifiedEditor();
    modifiedEditor.changeViewZones((accessor) => {
      for (const [, zoneInfo] of this.viewZoneRoots) {
        accessor.removeZone(zoneInfo.zoneId);
        zoneInfo.root.unmount();
      }
    });
    this.viewZoneRoots.clear();

    // Clear all decorations
    modifiedEditor.deltaDecorations(this.decorationIds, []);
    modifiedEditor.deltaDecorations(this.hoverDecorationIds, []);
    modifiedEditor.deltaDecorations(this.pinnedDecorationIds, []);
    this.decorationIds = [];
    this.hoverDecorationIds = [];
    this.pinnedDecorationIds = [];
    this.commentedLines.clear();
  }
}
