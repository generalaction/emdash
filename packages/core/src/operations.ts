import { VersionedSchema } from "@primitives/versioned-schema/api";
import z from "zod";

type Ref<T extends string, TRef> = {
    kind: T;
    ref: TRef;
}


export function defineResource<T extends string, TRef>(spec: {
    name: T;
    key: (ref: TRef) => string;
    parent?: (ref: TRef) => any;
}) {
    return {

    }

}


export function defineOperation<T extends string, TInput, TResult, TError, TState>(spec: {
    name: T;
    input: VersionedSchema<TInput>
    result: z.ZodType<TResult>
    error: z.ZodType<TError>
    key: (input: TInput) => string;
    liveModel?: any // LiveModel
    claims?: (input: TInput) => any[]
    conflictPolicy: ConflictPolicy

}) {
    return {}
}

type ConflictPolicyBuilder = {}

type ConflictPolicy = {}

export function defineConflictPolicy(build: (on: ConflictPolicyBuilder) => void) {
    return {}
}