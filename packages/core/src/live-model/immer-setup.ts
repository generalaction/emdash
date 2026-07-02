import { applyPatches, enablePatches, produceWithPatches, setAutoFreeze, type Patch } from 'immer';

// Enable Immer's RFC-6902 patch recording — required by both produceWithPatches
// (server side) and applyPatches (client side). Global Immer singleton setting;
// must run before either function is called in any bundle.
enablePatches();

// Auto-freeze is a dev-only correctness tripwire: it turns out-of-band mutations
// of structurally-shared state into an immediate TypeError rather than a silent
// drift. Disabled in prod because Object.freeze is O(N) and the invariant
// (current is only ever replaced, never mutated in place) is enforced by design.
setAutoFreeze(process.env['NODE_ENV'] !== 'production');

export { applyPatches, produceWithPatches, type Patch };
