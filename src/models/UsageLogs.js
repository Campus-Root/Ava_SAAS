import { model, Schema } from "mongoose";

// const UsageLogSchema = new Schema({
//     business: { type: Schema.Types.ObjectId, ref: "Businesses", index: true, required: true },
//     references: {
//         type: { type: String, enum: ["Message", "CallSession"] },
//         id: { type: Schema.Types.ObjectId, refPath: "references.type" },
//     },
//     model: {
//         name: String,
//         provider: String,
//         tokenDollarRate: Number,
//     },
//     event: {
//         type: { type: String, enum: ["update", "final"], default: "final" },
//         // Realtime-only transport; omit for turn-based chat
//         meduim: { type: String, enum: ["media-stream", "webrtc"] },
//         seq: { type: Number, default: 1 },
//     },
//     usage: { type: Schema.Types.Mixed, default: {} },
//     cost: {
//         total: { type: Number, default: 0 },
//         delta: { type: Number, default: 0 },
//         currency: { type: String, default: "USD" },
//         breakdown: Schema.Types.Mixed,
//         meta: Schema.Types.Mixed,
//         warnings: [String],
//         error: String,
//     },
// }, {
//     timestamps: true,
// });

export const LEDGER_DIRECTIONS = ["credit", "debit"];
export const LEDGER_STATUSES = ["posted", "pending", "failed", "reversed"];

const UsageLogSchema = new Schema({
    business: { type: Schema.Types.ObjectId, ref: "Businesses", required: true, index: true },
    direction: { type: String, enum: LEDGER_DIRECTIONS, required: true },
    credits: { type: Number, required: true, min: 0 },
    status: { type: String, enum: LEDGER_STATUSES, default: "posted" },
    payment: { type: Schema.Types.ObjectId, ref: "Payments" },
    source: {
        type: { type: String, enum: ["Message", "CallSession", "Subscription", "Collection"] },
        id: { type: Schema.Types.ObjectId, refPath: "source.type" },
    },
    idempotencyKey: { type: String },
    meta: Schema.Types.Mixed,
    note: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "Users" }
}, {
    timestamps: true,
    versionKey: false
});

UsageLogSchema.index({ business: 1, direction: 1, createdAt: -1 });
UsageLogSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
export const UsageLog = model("UsageLog", UsageLogSchema, "UsageLogs");
