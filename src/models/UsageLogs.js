import { model, Schema } from "mongoose";

// `UsageLogs` is the credit ledger only. Token/voice cost rows live in `CallUsageLogs` (AvaPhone).
export const LEDGER_DIRECTIONS = ["credit", "debit", "reset"];
export const LEDGER_STATUSES = ["posted", "pending", "failed", "reversed"];

const UsageLogSchema = new Schema({
    business: { type: Schema.Types.ObjectId, ref: "Businesses", required: true, index: true },
    direction: { type: String, enum: LEDGER_DIRECTIONS, required: true },
    credits: { type: Number, required: true, min: 0 },
    status: { type: String, enum: LEDGER_STATUSES, default: "posted" },
    payment: { type: Schema.Types.ObjectId, ref: "Payments" },
    source: {
        type: { type: String, enum: ["Message", "CallSession", "Subscription", "Payment", "Collection"] },
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
