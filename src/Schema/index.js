// import * as yup from "yup";
import { string, object, ValidationError, array, mixed, boolean } from "yup"
import { Business } from "../models/Business.js"
import { User } from "../models/User.js";
export const collectionSchema = object({
    name: string().required("Name is required"),
    contents: array().of(
        object({
            source: string().oneOf(['website', 'youtube', 'file']).required("Should be one of the following 'website', 'youtube', 'file' "),
            metaData: mixed().notRequired()
        })
    ).optional(),
    description: string().optional()
});

export const updateSchema = object({
    action: string().oneOf(['rename', 'addContents', 'removeContents']).required(),
    name: string().optional(),
    addContents: array().of(
        object({
            source: string().oneOf(['website', 'youtube', 'file']).optional("Should be one of the following 'website', 'youtube', 'file' "),
            metaData: mixed().optional()
        })
    ).optional(),
    removeContentIds: array().optional(),
    description: string().optional()
});
import mongoose from 'mongoose';

const objectIdValidator = string().test('is-valid-objectId', 'Invalid ObjectId', (value) => mongoose.Types.ObjectId.isValid(value));
export const agentSchema = object({
    collections: array().of(objectIdValidator),
    personalInfo: object().optional(),
    tools: array().optional(),
    // actions: array().of(objectIdValidator).optional(),
    // business: objectIdValidator.required('Business is required').optional(),
    // createdBy: objectIdValidator.required('CreatedBy is required').optional(),
    isPublic: boolean(),
    isFeatured: boolean(),
});
import { z } from "zod"
/* ───────────────────────────────────────────
   Schema for UPDATE (respond | resolve)
─────────────────────────────────────────────*/
export const updateTicketSchema = z.object({
    status: z.enum(['responded', 'resolved']),
    response: z
        .object({
            channelId: z.string().min(1, "Channel ID required"),
            subject: z.string().min(1, 'Subject required'),
            body: z.string().min(1, 'Body required')
        })
        .partial()
        .optional()
}).superRefine((data, ctx) => {
    if (data.status === 'responded') {
        if (!data.response?.channelId || !data.response?.subject || !data.response?.body) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'channelId , subject and body are required when status is "responded"',
                path: ['response']
            });
        }
    }
});