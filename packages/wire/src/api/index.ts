// Core RPC barrel: everything generic on the wire. Live endpoint kinds are
// composed on top by `../rpc`, which is the public `@emdash/wire/api` entry.
// The internal engine seam (`buildController`, `buildClient`,
// `./endpoint-kinds`) is deliberately kept out of this barrel.
export * from './blob-channel';
export * from './channel';
export {
  isEventStreamClientHandle,
  isLiveJobClientHandle,
  isLiveLogClientHandle,
  isLiveModelClientHandle,
  type ClientOptions,
  type ContractClient,
  type EventStreamClientHandle,
  type EventStreamSubscribeOptions,
  type FileUploadCallOptions,
  type LiveClientHandle,
  type LiveJobClientHandle,
  type LiveJobStateFor,
  type LiveLogClientHandle,
  type LiveModelClientHandle,
  type MutationCallOptions,
  type ProcedureCallOptions,
} from './client';
export * from './connect';
export { isController, type CallMeta, type Controller, type ProcedureHandler } from './controller';
export * from './define';
export * from './protocol';
export * from './serve';
export * from './sessions';
export * from './topics';
export * from './transports';
export * from './validation';
