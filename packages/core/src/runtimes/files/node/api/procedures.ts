import type { ContractImpl } from '@emdash/wire/rpc';
import { filesContract, type FilesContract } from '#runtimes/files/api';
import type { FilesRuntime } from '#runtimes/files/node/files-runtime';

export type FilesProcedures = ContractImpl<FilesContract>;

export function createFilesProcedures(
  runtime: FilesRuntime,
  contract: FilesContract = filesContract
): FilesProcedures {
  return {
    getHomeDir: () => runtime.getHomeDir(),
    fs: {
      stat: (input) => runtime.fs.stat(input),
      exists: (input) => runtime.fs.exists(input),
      realPath: (input) => runtime.fs.realPath(input),
      readText: (input) => runtime.fs.readText(input),
      readBytes: (input) => runtime.fs.readBytes(input),
      upload: (input, file) => runtime.fs.upload(input, file),
      enumerate: {
        run: (input, context) => runtime.fs.enumerate(input, context),
      },
    },
    tree: {
      model: runtime.tree.modelHost(contract.tree.model),
    },
    content: runtime.content.modelHost(contract.content),
    mutations: {
      createDirectory: (input) => runtime.fs.createDirectory(input),
      delete: (input) => runtime.fs.delete(input),
      writeFile: (input) => runtime.fs.writeFile(input),
    },
  };
}
