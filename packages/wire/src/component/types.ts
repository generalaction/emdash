import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import type { z } from 'zod';
import type { ContractClient } from '../api/client';
import type { Controller } from '../api/controller';
import type { Contract, ContractDefinitions } from '../api/define';
import type { ValidatePolicy } from '../api/with-validation';
import type { componentControllerSymbol, wireComponentSymbol } from './symbols';

export type WireComponentContractRequirement<Defs extends ContractDefinitions> = {
  readonly kind: 'contract';
  readonly contract: Contract<Defs>;
};

export type WireComponentValueRequirement<T> = {
  readonly kind: 'value';
  readonly schema: z.ZodType<T>;
};

export type WireComponentRequirement =
  | WireComponentContractRequirement<ContractDefinitions>
  | WireComponentValueRequirement<unknown>;

export type WireComponentRequirements = Record<string, WireComponentRequirement>;

export type ResolvedWireComponentRequirements<Requirements extends WireComponentRequirements> = {
  [Key in keyof Requirements]: Requirements[Key] extends WireComponentContractRequirement<
    infer Defs
  >
    ? ContractClient<Defs>
    : Requirements[Key] extends WireComponentValueRequirement<infer Value>
      ? Value
      : never;
};

export type ProvidedWireComponentRequirements<Requirements extends WireComponentRequirements> = {
  [Key in keyof Requirements]: Requirements[Key] extends WireComponentContractRequirement<
    infer Defs
  >
    ? ContractClient<Defs> | Controller
    : Requirements[Key] extends WireComponentValueRequirement<infer Value>
      ? Value
      : never;
};

export type WireComponentInstance<Defs extends ContractDefinitions> = {
  readonly client: ContractClient<Defs>;
  dispose(): Promise<void>;
};

export type InternalWireComponentInstance<Defs extends ContractDefinitions> =
  WireComponentInstance<Defs> & {
    readonly [componentControllerSymbol]: Controller;
  };

export type WireComponentCreateOptions<
  Requirements extends WireComponentRequirements,
  Config,
> = {
  scope: Scope;
  dependencies: ResolvedWireComponentRequirements<Requirements>;
  config: Config;
  logger?: Logger;
  validate?: ValidatePolicy;
};

export type WireComponentCreateContext<
  Defs extends ContractDefinitions,
  Requirements extends WireComponentRequirements,
  Config,
> = {
  scope: Scope;
  dependencies: ResolvedWireComponentRequirements<Requirements>;
  config: Config;
  logger: Logger;
  signal: AbortSignal;
  instance(options: {
    scope: Scope;
    controller: Controller;
  }): InternalWireComponentInstance<Defs>;
};

export type WireComponentDefinition<
  Id extends string,
  Defs extends ContractDefinitions,
  Requirements extends WireComponentRequirements,
  Config,
> = {
  readonly id: Id;
  readonly contract: Contract<Defs>;
  readonly requirements: Requirements;
  readonly configSchema: z.ZodType<Config>;
  readonly [wireComponentSymbol]: true;
  create(options: WireComponentCreateOptions<Requirements, Config>): WireComponentInstance<Defs>;
};

export type DefineWireComponentOptions<
  Id extends string,
  Defs extends ContractDefinitions,
  Requirements extends WireComponentRequirements,
  Config,
> = {
  id: Id;
  contract: Contract<Defs>;
  requirements: Requirements;
  configSchema: z.ZodType<Config>;
  create(
    context: WireComponentCreateContext<Defs, Requirements, Config>
  ): InternalWireComponentInstance<Defs>;
};
