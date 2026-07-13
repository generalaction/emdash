import type { ContractImpl } from '@emdash/wire';
import { filesContract, type FilesContract } from '@runtimes/files/api';
import type { FilesRuntime } from '@runtimes/files/node/files-runtime';

export type FilesProcedures = ContractImpl<FilesContract>;

export function createFilesProcedures(
  runtime: FilesRuntime,
  contract: FilesContract = filesContract
): FilesProcedures {
  return {
    fs: {
      stat: (input) => runtime.fs.stat(input),
      measureUsage: (input) => runtime.fs.measureUsage(input),
      exists: (input) => runtime.fs.exists(input),
      realPath: (input) => runtime.fs.realPath(input),
      readText: (input) => runtime.fs.readText(input),
      readBytes: (input) => runtime.fs.readBytes(input),
      upload: (input, file) => runtime.fs.upload(input, file),
      glob: {
        run: (input, context) => runtime.fs.glob(input, context),
      },
      enumerate: {
        run: (input, context) => runtime.fs.enumerate(input, context),
      },
    },
    tree: {
      model: runtime.tree.modelHost(contract.tree.model),
    },
    content: runtime.content.modelHost(contract.content),
    mutations: {
      createFile: (input) => runtime.fs.createFile(input),
      createDirectory: (input) => runtime.fs.createDirectory(input),
      rename: (input) => runtime.fs.rename(input),
      move: (input) => runtime.fs.move(input),
      copy: (input) => runtime.fs.copy(input),
      delete: (input) => runtime.fs.delete(input),
      writeFile: (input) => runtime.fs.writeFile(input),
    },
  };
}
