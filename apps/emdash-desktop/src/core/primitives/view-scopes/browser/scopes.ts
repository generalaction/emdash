import { computed, observable, type IComputedValue, type IObservableValue } from 'mobx';
import type { CommandDef, CommandInput, CommandOutput } from '@core/primitives/commands/api';
import type { JsonObject } from '@core/primitives/json/api';
import {
  enabled,
  viewScopeDefFor,
  type BoundCommand,
  type CommandBinding,
  type CommandSource,
  type ViewScopeDefinition,
  type ViewScopeHandle,
  type ViewScopeImpl,
  type ViewScopeRef,
} from '@core/primitives/view-scopes/api';
import { assertImplHasAllCommands, getViewScopeImpl } from './impl-registry';

export type KeybindingHit =
  | { readonly kind: 'none' }
  | { readonly kind: 'consumed'; readonly commandId: string }
  | { readonly kind: 'winner'; readonly command: BoundCommand };

const noHit: KeybindingHit = Object.freeze({ kind: 'none' });

type BindingFactory = (params: JsonObject) => CommandBinding;

function getBindingFactory(implementation: unknown, commandId: string): BindingFactory | undefined {
  if (implementation === null || typeof implementation !== 'object') return undefined;
  const candidate = (implementation as Readonly<Record<string, unknown>>)[commandId];
  return typeof candidate === 'function' ? (candidate as BindingFactory) : undefined;
}

class ScopeHandle implements ViewScopeHandle {
  readonly ref: ViewScopeRef;
  readonly def: ViewScopeDefinition;
  private readonly implementation: unknown;
  private readonly boundCommands = new Map<string, BoundCommand>();

  constructor(ref: ViewScopeRef, implementation: unknown) {
    this.ref = ref;
    this.def = viewScopeDefFor(ref);
    this.implementation = implementation;
  }

  getCommand<TCommand extends CommandDef>(command: TCommand): BoundCommand<TCommand> | undefined {
    const declared = this.def.commands.find((candidate) => candidate === command);
    if (!declared) return undefined;

    const cached = this.boundCommands.get(command.id);
    if (cached) return cached as BoundCommand<TCommand>;

    const factory = getBindingFactory(this.implementation, command.id);
    if (!factory) return undefined;
    const binding = factory(this.ref.params) as CommandBinding<TCommand>;
    const bound = Object.freeze({
      def: command,
      get availability() {
        return binding.availability?.() ?? enabled;
      },
      get presentation() {
        return binding.presentation?.();
      },
      execute(input: CommandInput<TCommand>, source: CommandSource = 'programmatic') {
        const parsed = command.input.parse(input) as CommandOutput<TCommand>;
        return binding.execute(parsed, source);
      },
    }) satisfies BoundCommand<TCommand>;
    this.boundCommands.set(command.id, bound);
    return bound;
  }

  commands(): readonly BoundCommand[] {
    const commands: BoundCommand[] = [];
    for (const command of this.def.commands) {
      const bound = this.getCommand(command);
      if (bound) commands.push(bound);
    }
    return Object.freeze(commands);
  }
}

export interface InstantiateViewScopeOptions<TDef extends ViewScopeDefinition> {
  readonly parent?: ViewScopeInstance;
  readonly impl?: ViewScopeImpl<TDef>;
}

export class ViewScopeInstance extends ScopeHandle {
  readonly id: string;
  readonly parent: ViewScopeInstance | undefined;
  readonly children = new Set<ViewScopeInstance>();
  readonly attachRef: (element: HTMLElement | null) => void;
  readonly attachFocusDelegate: (element: HTMLElement | null) => void;
  private readonly owner: ViewScopes;
  private attachedElement: HTMLElement | undefined;
  private focusDelegate: HTMLElement | undefined;
  private focusDelegateAction: (() => void) | undefined;
  private disposed = false;

  constructor(
    owner: ViewScopes,
    id: string,
    ref: ViewScopeRef,
    implementation: unknown,
    parent?: ViewScopeInstance
  ) {
    super(ref, implementation);
    this.owner = owner;
    this.id = id;
    this.parent = parent;
    this.attachRef = (element) => {
      if (this.attachedElement === element) return;
      this.attachedElement?.removeAttribute('data-view-scope');
      this.attachedElement = element ?? undefined;
      this.attachedElement?.setAttribute('data-view-scope', this.id);
      if (!element) this.owner.handleElementDetached(this);
    };
    this.attachFocusDelegate = (element) => {
      this.focusDelegate = element ?? undefined;
    };
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  focus(): boolean {
    if (this.disposed) return false;
    if (this.focusDelegateAction) {
      this.focusDelegateAction();
      return true;
    }
    const target =
      this.focusDelegate?.isConnected === true ? this.focusDelegate : this.attachedElement;
    if (!target?.isConnected) return false;
    target.focus({ preventScroll: true });
    return true;
  }

  setFocusDelegate(delegate: (() => void) | undefined): void {
    this.focusDelegateAction = delegate;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const child of [...this.children]) {
      child.dispose();
    }
    this.setFocusDelegate(undefined);
    this.attachFocusDelegate(null);
    this.attachRef(null);
    this.owner.remove(this);
  }
}

export class ViewScopes {
  private nextId = 1;
  private readonly instancesById = new Map<string, ViewScopeInstance>();
  private readonly instancesByKey = new Map<string, ViewScopeInstance[]>();
  private readonly logicalActive: IObservableValue<ViewScopeInstance | undefined>;
  private readonly focusActive: IObservableValue<ViewScopeInstance | undefined>;
  private readonly captureOriginPath: IObservableValue<readonly ViewScopeInstance[]>;
  private readonly activePathValue: IComputedValue<readonly ViewScopeHandle[]>;
  private readonly document: Document | undefined;

  constructor(document: Document | undefined = globalThis.document) {
    this.document = document;
    this.logicalActive = observable.box(undefined, { deep: false });
    this.focusActive = observable.box(undefined, { deep: false });
    this.captureOriginPath = observable.box([], { deep: false });
    this.activePathValue = computed(() => this.computeActivePath());
    this.document?.addEventListener('focusin', this.handleFocusIn);
  }

  get activePath(): readonly ViewScopeHandle[] {
    return this.activePathValue.get();
  }

  get activeInstance(): ViewScopeInstance | undefined {
    return this.activeScopeInstance();
  }

  isWithinActivePath(instance: ViewScopeInstance): boolean {
    return this.activePath.includes(instance);
  }

  instantiate<TDef extends ViewScopeDefinition = ViewScopeDefinition>(
    ref: ViewScopeRef,
    options: InstantiateViewScopeOptions<TDef> = {}
  ): ViewScopeInstance {
    const definition = viewScopeDefFor(ref);
    const implementation = options.impl ?? getViewScopeImpl(definition);
    if (!implementation) {
      throw new Error(`Missing view scope implementation: ${definition.id}`);
    }
    if (import.meta.env.DEV && options.impl) {
      assertImplHasAllCommands(definition, options.impl);
    }
    if (options.parent?.isDisposed) {
      throw new Error(`Cannot attach ${definition.id} to a disposed parent scope`);
    }

    const instance = new ViewScopeInstance(
      this,
      `view-scope-${this.nextId++}`,
      ref,
      implementation,
      options.parent
    );
    options.parent?.children.add(instance);
    this.instancesById.set(instance.id, instance);
    const instances = this.instancesByKey.get(ref.key) ?? [];
    instances.push(instance);
    this.instancesByKey.set(ref.key, instances);
    return instance;
  }

  activate(instance: ViewScopeInstance | undefined): void {
    if (instance?.isDisposed) {
      throw new Error('Cannot activate a disposed view scope');
    }
    const focused = this.focusActive.get();
    if (instance && focused && !this.isDescendantOf(focused, instance)) {
      this.focusActive.set(undefined);
    }
    this.logicalActive.set(instance);
  }

  get(ref: ViewScopeRef): ViewScopeHandle | undefined {
    const instances = this.instancesByKey.get(ref.key);
    if (instances) {
      for (let index = instances.length - 1; index >= 0; index -= 1) {
        const instance = instances[index];
        if (instance && !instance.isDisposed && instance.def === viewScopeDefFor(ref)) {
          return instance;
        }
      }
    }

    const definition = viewScopeDefFor(ref);
    if (definition.activation !== 'logical') return undefined;
    const implementation = getViewScopeImpl(definition);
    return implementation ? new ScopeHandle(ref, implementation) : undefined;
  }

  getActiveCommand<TCommand extends CommandDef>(
    command: TCommand,
    options: { readonly fromCaptureOrigin?: boolean } = {}
  ): BoundCommand<TCommand> | undefined {
    const path =
      options.fromCaptureOrigin && this.activePath[0]?.def.traits.has('capturing')
        ? this.captureOriginPath.get().filter((instance) => !instance.isDisposed)
        : this.activePath;
    for (const handle of path) {
      const bound = handle.getCommand(command);
      if (bound) return bound;
      if (handle.def.traits.has('capturing')) return undefined;
    }
    return undefined;
  }

  /**
   * Dispatches through the active scope path. Disabled commands are consumed
   * and missing commands are ignored; the returned hit describes the outcome.
   */
  execute<TCommand extends CommandDef>(
    command: TCommand,
    input: CommandInput<TCommand>,
    source: CommandSource = 'programmatic'
  ): KeybindingHit {
    const hit = this.resolveCommand(command);
    if (hit.kind === 'winner') {
      void hit.command.execute(input, source);
    }
    return hit;
  }

  resolveKeybinding(candidates: ReadonlySet<string>): KeybindingHit {
    return this.walkActivePath((handle) => {
      const declared = handle.def.commands.filter((command) => candidates.has(command.id));
      if (import.meta.env.DEV && declared.length > 1) {
        console.warn(
          `Multiple keybindings matched in view scope ${handle.def.id}; using declaration order: ${declared
            .map((command) => command.id)
            .join(', ')}`
        );
      }
      return declared;
    });
  }

  dispose(): void {
    this.document?.removeEventListener('focusin', this.handleFocusIn);
    for (const instance of [...this.instancesById.values()]) {
      if (!instance.parent) instance.dispose();
    }
    this.logicalActive.set(undefined);
    this.focusActive.set(undefined);
  }

  /** @internal Called by ViewScopeInstance.dispose(). */
  remove(instance: ViewScopeInstance): void {
    instance.parent?.children.delete(instance);
    this.instancesById.delete(instance.id);
    const instances = this.instancesByKey.get(instance.ref.key);
    if (instances) {
      const remaining = instances.filter((candidate) => candidate !== instance);
      if (remaining.length > 0) this.instancesByKey.set(instance.ref.key, remaining);
      else this.instancesByKey.delete(instance.ref.key);
    }
    if (this.logicalActive.get() === instance) {
      this.logicalActive.set(this.nearestLiveAncestor(instance.parent));
    }
    if (this.focusActive.get() === instance) {
      this.focusActive.set(this.nearestLiveAncestor(instance.parent));
    }
  }

  /** @internal Called when an instance's attached DOM root is removed. */
  handleElementDetached(instance: ViewScopeInstance): void {
    if (this.focusActive.get() === instance) {
      this.focusActive.set(this.nearestLiveAncestor(instance.parent));
    }
  }

  private resolveCommand<TCommand extends CommandDef>(command: TCommand): KeybindingHit {
    return this.walkActivePath((handle) =>
      handle.def.commands.filter((candidate) => candidate === command)
    );
  }

  private walkActivePath(
    candidatesFor: (handle: ViewScopeHandle) => readonly CommandDef[]
  ): KeybindingHit {
    for (const handle of this.activePath) {
      for (const command of candidatesFor(handle)) {
        const bound = handle.getCommand(command);
        if (!bound || bound.availability.kind === 'hidden') continue;
        if (bound.availability.kind === 'disabled') {
          return Object.freeze({ kind: 'consumed', commandId: command.id });
        }
        return Object.freeze({ kind: 'winner', command: bound });
      }
      if (handle.def.traits.has('capturing')) return noHit;
    }
    return noHit;
  }

  private computeActivePath(): readonly ViewScopeHandle[] {
    return this.computeActiveInstancePath();
  }

  private computeActiveInstancePath(): readonly ViewScopeInstance[] {
    const path: ViewScopeInstance[] = [];
    let current = this.activeScopeInstance();
    while (current) {
      path.push(current);
      current = current.parent;
    }
    return Object.freeze(path);
  }

  private nearestLiveAncestor(
    instance: ViewScopeInstance | undefined
  ): ViewScopeInstance | undefined {
    let current = instance;
    while (current?.isDisposed) current = current.parent;
    return current;
  }

  private isDescendantOf(instance: ViewScopeInstance, ancestor: ViewScopeInstance): boolean {
    let current: ViewScopeInstance | undefined = instance;
    while (current) {
      if (current === ancestor) return true;
      current = current.parent;
    }
    return false;
  }

  private activeScopeInstance(): ViewScopeInstance | undefined {
    let current = this.focusActive.get() ?? this.logicalActive.get();
    while (current?.isDisposed) current = current.parent;
    return current;
  }

  private readonly handleFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    const ElementConstructor = this.document?.defaultView?.Element;
    const element =
      ElementConstructor && target instanceof ElementConstructor
        ? target.closest<HTMLElement>('[data-view-scope]')
        : null;
    const id = element?.getAttribute('data-view-scope');
    const instance = id ? this.instancesById.get(id) : undefined;
    if (!instance) return;
    if (instance.def.traits.has('capturing') && this.activePath[0] !== instance) {
      this.captureOriginPath.set(this.computeActiveInstancePath());
    }
    this.focusActive.set(instance);
  };
}

export const scopes = new ViewScopes();

export function focusScope(instance: ViewScopeInstance | undefined): boolean {
  return instance?.focus() ?? false;
}
