import { createController, type Controller } from '@emdash/wire/rpc';
import { editorContract } from '../api';
import type { EditorBufferService } from './editor-buffer-service';
import { createEditorLspImpl, type EditorLspControllerOptions } from './lsp-controller';

export type CreateEditorWireControllerOptions = Readonly<{
  editorBuffer: EditorBufferService;
}> &
  EditorLspControllerOptions;

export function createEditorWireController(options: CreateEditorWireControllerOptions): Controller {
  return createController(editorContract, {
    lsp: createEditorLspImpl(options, editorContract.lsp),
    saveBuffer: ({ uri, content }) => options.editorBuffer.saveBuffer(uri, content),
    clearBuffer: ({ uri }) => options.editorBuffer.clearBuffer(uri),
    listBuffers: ({ root }) => options.editorBuffer.listBuffers(root),
  });
}
