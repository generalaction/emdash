import z from "zod"
import { promptInputSchema } from "../models"
import { result } from "../result"

export const startSessionRequestSchema = z.object({})
export const startSessionResponseSchema = result(z.object({}), z.object({}))

export const resumeSessionRequestSchema = z.object({})
export const resumeSessionResponseSchema = result(z.object({}), z.object({}))

// its a seq log at the sametime so maybe it should use a cursor
export const getHistoryRequestSchema = z.object({})
export const getHistoryResponseSchema = result(z.object({}), z.object({}))

export const stopSessionRequestSchema = z.object({})
export const stopSessionResponseSchema = result(z.object({}), z.object({}))

export const sendPromptRequestSchema = promptInputSchema
export const sendPromptResponseSchema = result(z.object({ queued: z.boolean()}), z.object({}))

export const queuePromptRequestSchema = promptInputSchema
export const queuePromptResponseSchema = result(z.object({}), z.object({}))

export const cancelTurnRequestSchema = z.object({})
export const cancelTurnResponseSchema = result(z.object({}), z.object({}))

export const setModelOptionRequestSchema = z.object({})
export const setModelOptionResponseSchema = result(z.object({}), z.object({}))

export const setModeOptionRequestSchema = z.object({})
export const setModeOptionResponseSchema = result(z.object({}), z.object({}))

export const resolvePermissionRequestSchema = z.object({})
export const resolvePermissionResponseSchema = result(z.object({}), z.object({}))

export const editQueuedPromptRequestSchema = z.object({})
export const editQueuedPromptResponseSchema = result(z.object({}), z.object({}))

export const deleteQueuedPromptRequestSchema = z.object({})
export const deleteQueuedPromptResponseSchema = result(z.object({}), z.object({}))

export const changeQueuePromptOrderRequestSchema = z.object({})
export const changeQueuePromptOrderResponseSchema = result(z.object({}), z.object({}))

export const uploadAttachmentRequestSchema = z.object({})
export const uploadAttachmentResponseSchema = result(z.object({}), z.object({}))

export const downloadAttachmentRequestSchema = z.object({})
export const downloadAttachmentResponseSchema = result(z.object({}), z.object({}))

export const deleteAttachmentRequestSchema = z.object({})
export const deleteAttachmentResponseSchema = result(z.object({}), z.object({}))

export const editCurrentPromptSchema = promptInputSchema
export const editCurrentPromptResponseSchema = result(z.object({}), z.object({}))