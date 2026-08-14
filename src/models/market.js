// models/channel.js
import { Schema, model } from 'mongoose';

const baseOpts = { _id: false };      // subdocs don’t need their own _id
const docOpts = { timestamps: true, discriminatorKey: 'type' };

/* ───────────────────────────── Base Channel ───────────────────────────── */
const TemplateBaseSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        createdBy: { type: Schema.Types.ObjectId, ref: "Users" },
        type: { type: String, enum: ['agent', 'action'], required: true },
        status: { type: String, default: 'disabled' },   // enabled | disabled | error
        description: String, //can be removed as tool already has it             
        imageUrl: String,
        tags: [String],
        version: String,
        applicableSectors: [String], //business sectors the tool is applicable for, useful for filtering in marketplace
        isPublic: { type: Boolean, default: false },
        UIElements: Schema.Types.Mixed,
        isFeatured: { type: Boolean, default: false },
    },
    docOpts
);
export const Template = model('StandardProduct', TemplateBaseSchema, 'StandardProduct');

/* ───────────────────────────── Agent Template ──────────────────────────── */
const AgentData = new Schema(
    {
        personalInfo: {
            name: String,
            systemPrompt: {
                role: String,
                objective: String,
                instructionsAndWorkflow: String,
                constraintsAndRules: String
            },
            model: { type: String, default: 'gpt-4.1-mini' },
            temperature: { type: Number, default: 0.5 },
        },
        collections: [{ type: Schema.Types.ObjectId, ref: 'Collection' }],
        actions: [{ type: Schema.Types.ObjectId, ref: 'StandardProduct' }],
        facets: [String],
    },
    baseOpts
);
Template.discriminator('agent', new Schema({ data: AgentData, config: Schema.Types.Mixed }, docOpts));
/* ─────────────────────────── Action Template ─────────────────────────── */
const ActionData = new Schema(
    {
        name: String,
        description: String,
        async: { type: Boolean, default: true },
        needsApproval: Boolean, // Knowledge fetching doesn't need approval
        parameters: Schema.Types.Mixed,
        functionString: String,
        errorFunction: String,
        UI: Schema.Types.Mixed,
    },
    baseOpts
);
const ActionConfig = new Schema({
    orgDefinedParams: Schema.Types.Mixed,
}, baseOpts);
Template.discriminator('action', new Schema({ data: ActionData, config: ActionConfig }, docOpts));
