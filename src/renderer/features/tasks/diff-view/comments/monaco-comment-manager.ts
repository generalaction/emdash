import type * as monaco from 'monaco-editor';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DraftComment } from '../stores/draft-comments-store';
import { CommentInput } from './comment-input';
import { CommentWidget } from './comment-widget';

const GUTTER_GLYPH_MARGIN = 2;
const COMMENT_ZONE_HEIGHT_PX = 140 + 24;

interface MonacoCommentManagerOptions {
  onAddComment: (lineNumber: number, content: string, lineContent?: string) => void | Promise<void>;
  onEditComment: (id: string, content: string) => void | Promise<void>;
  onDeleteComment: (id: string) => void | Promise<void>;
}

export class MonacoCommentManager {
  private readonly editor: monaco.editor.IStandaloneDiffEditor;
  private readonly options: MonacoCommentManagerOptions;

  private viewZoneRoots: Map<
    string,
    { zoneId: string; root: Root; domNode: HTMLElement; lineNumber: number }
  > = new Map();

  private decorationIds: string[] = [];
  private hoverDecorationIds: string[] = [];
  private pinnedDecorationIds: string[] = [];
  private hoveredLine: number | null = null;

  private inputZoneId: string | null = null;
  private inputRoot: Root | null = null;
  private inputDomNode: HTMLElement | null = null;
  private activeInputLine: number | null = null;

  private disposed = false;
  private gutterClickDisposable: monaco.IDisposable | null = null;
  private hoverMoveDisposable: monaco.IDisposable | null = null;
  private hoverLeaveDisposable: monaco.IDisposable | null = null;

  constructor(editor: monaco.editor.IStandaloneDiffEditor, options: MonacoCommentManagerOptions) {
    this.editor = editor;
    this.options = options;
    this.setupGutterClickHandler();
    this.setupHoverHandler();
  }

  private setupGutterClickHandler() {
    const modifiedEditor = this.editor.getModifiedEditor();

    this.gutterClickDisposable = modifiedEditor.onMouseDown((e) => {
      if (e.target.type !== GUTTER_GLYPH_MARGIN) return;
      const targetElement = e.target.element;
      if (!targetElement?.classList.contains('comment-hover-icon')) return;

      const lineNumber = e.target.position?.lineNumber;
      if (!lineNumber) return;

      e.event?.preventDefault();
      e.event?.stopPropagation();

      const model = modifiedEditor.getModel();
      const lineContent = model?.getLineContent(lineNumber) ?? '';
      this.showInputAt(lineNumber, lineContent);
    });
  }

  private setupHoverHandler() {
    const modifiedEditor = this.editor.getModifiedEditor();

    this.hoverMoveDisposable = modifiedEditor.onMouseMove((e) => {
      if (this.disposed) return;
      const targetElement = e.target.element as HTMLElement | null;
      if (targetElement?.closest?.('.comment-view-zone')) {
        this.clearHoverDecoration();
        this.hoveredLine = null;
        return;
      }

      const lineNumber = e.target.position?.lineNumber;

      if (lineNumber && lineNumber !== this.hoveredLine) {
        if (lineNumber === this.activeInputLine) {
          this.clearHoverDecoration();
          this.hoveredLine = lineNumber;
          return;
        }
        this.setHoverDecoration(lineNumber);
        this.hoveredLine = lineNumber;
      } else if (!lineNumber && this.hoveredLine !== null) {
        this.clearHoverDecoration();
        this.hoveredLine = null;
      }
    });

    this.hoverLeaveDisposable = modifiedEditor.onMouseLeave(() => {
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

    this.hoverDecorationIds = modifiedEditor.deltaDecorations(this.hoverDecorationIds, [
      decoration,
    ]);
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

    this.pinnedDecorationIds = modifiedEditor.deltaDecorations(this.pinnedDecorationIds, [
      decoration,
    ]);
  }

  private clearHoverDecoration() {
    const modifiedEditor = this.editor.getModifiedEditor();
    this.hoverDecorationIds = modifiedEditor.deltaDecorations(this.hoverDecorationIds, []);
  }

  private clearPinnedDecoration() {
    const modifiedEditor = this.editor.getModifiedEditor();
    this.pinnedDecorationIds = modifiedEditor.deltaDecorations(this.pinnedDecorationIds, []);
  }

  setComments(comments: DraftComment[]) {
    if (this.disposed) return;

    const modifiedEditor = this.editor.getModifiedEditor();
    const nextById = new Map<string, DraftComment>(
      comments.map((comment) => [comment.id, comment])
    );

    this.decorationIds = modifiedEditor.deltaDecorations(this.decorationIds, []);

    modifiedEditor.changeViewZones((accessor) => {
      for (const [commentId, zoneInfo] of Array.from(this.viewZoneRoots.entries())) {
        if (!nextById.has(commentId)) {
          accessor.removeZone(zoneInfo.zoneId);
          zoneInfo.root.unmount();
          this.viewZoneRoots.delete(commentId);
        }
      }

      for (const comment of comments) {
        const existing = this.viewZoneRoots.get(comment.id);
        if (existing) {
          existing.domNode.dataset.lineNumber = String(comment.lineNumber);
          existing.domNode.style.padding = '12px';
          existing.domNode.style.boxSizing = 'border-box';
          existing.domNode.className = 'comment-view-zone bg-muted/40 border border-border';

          existing.root.render(
            React.createElement(CommentWidget, {
              comment,
              onEdit: (content) => this.options.onEditComment(comment.id, content),
              onDelete: () => this.options.onDeleteComment(comment.id),
            })
          );

          if (existing.lineNumber !== comment.lineNumber) {
            accessor.removeZone(existing.zoneId);
            const zoneId = accessor.addZone({
              afterLineNumber: comment.lineNumber,
              heightInPx: COMMENT_ZONE_HEIGHT_PX,
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
        domNode.style.padding = '12px';
        domNode.style.boxSizing = 'border-box';
        domNode.className = 'comment-view-zone bg-muted/40 border border-border';
        domNode.style.pointerEvents = 'auto';
        domNode.style.position = 'relative';
        domNode.style.zIndex = '10';
        domNode.style.width = '100%';
        domNode.dataset.lineNumber = String(comment.lineNumber);

        const root = createRoot(domNode);
        root.render(
          React.createElement(CommentWidget, {
            comment,
            onEdit: (content) => this.options.onEditComment(comment.id, content),
            onDelete: () => this.options.onDeleteComment(comment.id),
          })
        );

        const zoneId = accessor.addZone({
          afterLineNumber: comment.lineNumber,
          heightInPx: COMMENT_ZONE_HEIGHT_PX,
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

  showInputAt(lineNumber: number, lineContent: string) {
    if (this.activeInputLine === lineNumber && this.inputDomNode) {
      const textarea = this.inputDomNode.querySelector('textarea');
      if (textarea instanceof HTMLTextAreaElement) textarea.focus();
      return;
    }

    this.hideInput();

    const modifiedEditor = this.editor.getModifiedEditor();
    this.activeInputLine = lineNumber;
    this.setPinnedDecoration(lineNumber);

    this.inputDomNode = document.createElement('div');
    this.inputRoot = createRoot(this.inputDomNode);

    this.inputRoot.render(
      React.createElement(CommentInput, {
        lineNumber,
        onSubmit: async (content) => {
          await this.options.onAddComment(lineNumber, content, lineContent);
          this.hideInput();
        },
        onCancel: () => this.hideInput(),
      })
    );

    this.inputDomNode.style.padding = '12px';
    this.inputDomNode.style.boxSizing = 'border-box';
    this.inputDomNode.className = 'comment-view-zone bg-muted/40 border border-border';
    this.inputDomNode.style.pointerEvents = 'auto';
    this.inputDomNode.style.position = 'relative';
    this.inputDomNode.style.zIndex = '10';
    this.inputDomNode.style.width = '100%';
    this.inputDomNode.dataset.lineNumber = String(lineNumber);

    modifiedEditor.changeViewZones((accessor) => {
      this.inputZoneId = accessor.addZone({
        afterLineNumber: lineNumber,
        heightInPx: COMMENT_ZONE_HEIGHT_PX,
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
    const modifiedEditor = this.editor.getModifiedEditor();
    if (this.inputZoneId) {
      modifiedEditor.changeViewZones((accessor) => {
        accessor.removeZone(this.inputZoneId!);
      });
      this.inputZoneId = null;
    }

    this.inputRoot?.unmount();
    this.inputRoot = null;
    this.inputDomNode = null;
    this.activeInputLine = null;
    this.clearPinnedDecoration();
  }

  dispose() {
    this.disposed = true;

    this.gutterClickDisposable?.dispose();
    this.hoverMoveDisposable?.dispose();
    this.hoverLeaveDisposable?.dispose();

    this.hideInput();

    const modifiedEditor = this.editor.getModifiedEditor();
    this.decorationIds = modifiedEditor.deltaDecorations(this.decorationIds, []);
    this.hoverDecorationIds = modifiedEditor.deltaDecorations(this.hoverDecorationIds, []);
    this.pinnedDecorationIds = modifiedEditor.deltaDecorations(this.pinnedDecorationIds, []);

    modifiedEditor.changeViewZones((accessor) => {
      for (const zone of this.viewZoneRoots.values()) {
        accessor.removeZone(zone.zoneId);
        zone.root.unmount();
      }
    });
    this.viewZoneRoots.clear();
  }
}
