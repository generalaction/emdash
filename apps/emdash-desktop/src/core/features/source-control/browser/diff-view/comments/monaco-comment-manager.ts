import type * as monaco from 'monaco-editor';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resolveAnnotationLine } from '@core/features/source-control/api/browser/diff-view/ai-annotations';
import type { AiAnnotation } from '@core/features/source-control/api/browser/diff-view/stores/ai-annotations-store';
import type { DraftComment } from '@core/features/source-control/api/browser/diff-view/stores/draft-comments-store';
import { AddCommentButton } from './add-comment-button';
import { AiAnnotationWidget } from './ai-annotation-widget';
import { CommentInput } from './comment-input';
import { CommentWidget } from './comment-widget';

const COMMENT_ZONE_HEIGHT_PX = 140 + 24;

interface MonacoCommentManagerOptions {
  onAddComment: (lineNumber: number, content: string, lineContent?: string) => void | Promise<void>;
  onEditComment: (id: string, content: string) => void | Promise<void>;
  onDeleteComment: (id: string) => void | Promise<void>;
  onDismissAnnotation?: (id: string) => void;
}

interface ZoneRoot {
  zoneId: string;
  root: Root;
  domNode: HTMLElement;
  lineNumber: number;
}

interface ZoneItem {
  id: string;
  lineNumber: number;
  element: React.ReactElement;
}

interface GlyphWidgetHandle {
  widget: monaco.editor.IGlyphMarginWidget;
  root: Root;
}

export class MonacoCommentManager {
  private readonly editor: monaco.editor.IStandaloneDiffEditor;
  private readonly options: MonacoCommentManagerOptions;

  private viewZoneRoots = new Map<string, ZoneRoot>();
  private annotationZoneRoots = new Map<string, ZoneRoot>();
  private annotations: readonly AiAnnotation[] = [];

  private decorationIds: string[] = [];
  private hoveredLine: number | null = null;

  private hoverWidgetHandle: GlyphWidgetHandle | null = null;
  private pinnedWidgetHandle: GlyphWidgetHandle | null = null;

  private inputZoneId: string | null = null;
  private inputRoot: Root | null = null;
  private inputDomNode: HTMLElement | null = null;
  private activeInputLine: number | null = null;

  private disposed = false;
  private hoverMoveDisposable: monaco.IDisposable | null = null;
  private hoverLeaveDisposable: monaco.IDisposable | null = null;
  private modelDisposables: monaco.IDisposable[] = [];

  constructor(editor: monaco.editor.IStandaloneDiffEditor, options: MonacoCommentManagerOptions) {
    this.editor = editor;
    this.options = options;
    this.setupHoverHandler();

    // Re-anchor annotations when the modified side loads or changes on disk.
    const modifiedEditor = editor.getModifiedEditor();
    this.modelDisposables = [
      modifiedEditor.onDidChangeModel(() => this.renderAnnotations()),
      modifiedEditor.onDidChangeModelContent(() => this.renderAnnotations()),
    ];
  }

  private createGlyphWidget(
    id: string,
    lineNumber: number,
    pinned: boolean,
    onClick: () => void
  ): GlyphWidgetHandle {
    // oxlint-disable-next-line typescript/no-explicit-any
    const m = (globalThis as any).__monaco as typeof monaco;
    const domNode = document.createElement('div');
    const root = createRoot(domNode);
    root.render(React.createElement(AddCommentButton, { pinned, onClick }));

    const widget: monaco.editor.IGlyphMarginWidget = {
      getId: () => id,
      getDomNode: () => domNode,
      getPosition: () => ({
        lane: m.editor.GlyphMarginLane.Right,
        zIndex: 10,
        range: {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: 1,
        },
      }),
    };

    return { widget, root };
  }

  private removeGlyphWidgetHandle(handle: GlyphWidgetHandle): void {
    const modifiedEditor = this.editor.getModifiedEditor();
    modifiedEditor.removeGlyphMarginWidget(handle.widget);
    handle.root.unmount();
  }

  private setupHoverHandler() {
    const modifiedEditor = this.editor.getModifiedEditor();

    this.hoverMoveDisposable = modifiedEditor.onMouseMove((e) => {
      if (this.disposed) return;
      const targetElement = e.target.element as HTMLElement | null;
      if (targetElement?.closest?.('.comment-view-zone')) {
        this.clearHoverWidget();
        this.hoveredLine = null;
        return;
      }

      const lineNumber = e.target.position?.lineNumber;

      if (lineNumber && lineNumber !== this.hoveredLine) {
        if (lineNumber === this.activeInputLine) {
          this.clearHoverWidget();
          this.hoveredLine = lineNumber;
          return;
        }
        this.setHoverWidget(lineNumber);
        this.hoveredLine = lineNumber;
      } else if (!lineNumber && this.hoveredLine !== null) {
        this.clearHoverWidget();
        this.hoveredLine = null;
      }
    });

    this.hoverLeaveDisposable = modifiedEditor.onMouseLeave(() => {
      if (this.disposed) return;
      this.clearHoverWidget();
      this.hoveredLine = null;
    });
  }

  private setHoverWidget(lineNumber: number): void {
    const modifiedEditor = this.editor.getModifiedEditor();
    if (this.hoverWidgetHandle) {
      this.removeGlyphWidgetHandle(this.hoverWidgetHandle);
      this.hoverWidgetHandle = null;
    }
    const handle = this.createGlyphWidget('comment-add-hover', lineNumber, false, () => {
      const model = modifiedEditor.getModel();
      const lineContent = model?.getLineContent(lineNumber) ?? '';
      this.showInputAt(lineNumber, lineContent);
    });
    modifiedEditor.addGlyphMarginWidget(handle.widget);
    this.hoverWidgetHandle = handle;
  }

  private clearHoverWidget(): void {
    if (!this.hoverWidgetHandle) return;
    this.removeGlyphWidgetHandle(this.hoverWidgetHandle);
    this.hoverWidgetHandle = null;
  }

  setComments(comments: DraftComment[]) {
    if (this.disposed) return;

    const modifiedEditor = this.editor.getModifiedEditor();
    this.decorationIds = modifiedEditor.deltaDecorations(this.decorationIds, []);

    const zones = comments.map((comment) => ({
      id: comment.id,
      lineNumber: comment.lineNumber,
      element: React.createElement(CommentWidget, {
        comment,
        onEdit: (content) => this.options.onEditComment(comment.id, content),
        onDelete: () => this.options.onDeleteComment(comment.id),
      }),
    }));
    modifiedEditor.changeViewZones((accessor) =>
      this.syncZones(accessor, this.viewZoneRoots, zones)
    );
  }

  setAnnotations(annotations: readonly AiAnnotation[]) {
    this.annotations = annotations;
    this.renderAnnotations();
  }

  private renderAnnotations() {
    if (this.disposed) return;
    if (this.annotations.length === 0 && this.annotationZoneRoots.size === 0) return;

    const modifiedEditor = this.editor.getModifiedEditor();
    const model = modifiedEditor.getModel();
    const zones: ZoneItem[] = [];
    for (const annotation of this.annotations) {
      const lineNumber = model
        ? resolveAnnotationLine(annotation, model.getLineCount(), (line) =>
            model.getLineContent(line)
          )
        : null;
      if (lineNumber === null) continue;
      zones.push({
        id: annotation.id,
        lineNumber,
        element: React.createElement(AiAnnotationWidget, {
          annotation,
          lineNumber,
          onDismiss: () => this.options.onDismissAnnotation?.(annotation.id),
        }),
      });
    }
    modifiedEditor.changeViewZones((accessor) =>
      this.syncZones(accessor, this.annotationZoneRoots, zones)
    );
  }

  /** Reconciles one family of view zones against the desired items, keyed by id. */
  private syncZones(
    accessor: monaco.editor.IViewZoneChangeAccessor,
    zoneRoots: Map<string, ZoneRoot>,
    items: readonly ZoneItem[]
  ) {
    const nextIds = new Set(items.map((item) => item.id));
    for (const [id, zoneInfo] of Array.from(zoneRoots.entries())) {
      if (!nextIds.has(id)) {
        accessor.removeZone(zoneInfo.zoneId);
        zoneInfo.root.unmount();
        zoneRoots.delete(id);
      }
    }

    for (const item of items) {
      const existing = zoneRoots.get(item.id);
      if (existing) {
        existing.domNode.dataset.lineNumber = String(item.lineNumber);
        existing.root.render(item.element);

        if (existing.lineNumber !== item.lineNumber) {
          accessor.removeZone(existing.zoneId);
          const zoneId = accessor.addZone({
            afterLineNumber: item.lineNumber,
            heightInPx: COMMENT_ZONE_HEIGHT_PX,
            domNode: existing.domNode,
            suppressMouseDown: false,
            showInHiddenAreas: true,
          });
          zoneRoots.set(item.id, { ...existing, zoneId, lineNumber: item.lineNumber });
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
      domNode.dataset.lineNumber = String(item.lineNumber);

      const root = createRoot(domNode);
      root.render(item.element);

      const zoneId = accessor.addZone({
        afterLineNumber: item.lineNumber,
        heightInPx: COMMENT_ZONE_HEIGHT_PX,
        domNode,
        suppressMouseDown: false,
        showInHiddenAreas: true,
      });

      zoneRoots.set(item.id, { zoneId, root, domNode, lineNumber: item.lineNumber });
    }
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

    // Show pinned widget at the active input line
    const pinnedHandle = this.createGlyphWidget('comment-add-pinned', lineNumber, true, () =>
      this.showInputAt(lineNumber, lineContent)
    );
    modifiedEditor.addGlyphMarginWidget(pinnedHandle.widget);
    this.pinnedWidgetHandle = pinnedHandle;

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

    if (this.pinnedWidgetHandle) {
      this.removeGlyphWidgetHandle(this.pinnedWidgetHandle);
      this.pinnedWidgetHandle = null;
    }
  }

  dispose() {
    this.disposed = true;

    this.hoverMoveDisposable?.dispose();
    this.hoverLeaveDisposable?.dispose();
    for (const disposable of this.modelDisposables) disposable.dispose();

    if (this.hoverWidgetHandle) {
      this.removeGlyphWidgetHandle(this.hoverWidgetHandle);
      this.hoverWidgetHandle = null;
    }

    this.hideInput();

    const modifiedEditor = this.editor.getModifiedEditor();
    this.decorationIds = modifiedEditor.deltaDecorations(this.decorationIds, []);

    modifiedEditor.changeViewZones((accessor) => {
      for (const zone of [...this.viewZoneRoots.values(), ...this.annotationZoneRoots.values()]) {
        accessor.removeZone(zone.zoneId);
        zone.root.unmount();
      }
    });
    this.viewZoneRoots.clear();
    this.annotationZoneRoots.clear();
  }
}
