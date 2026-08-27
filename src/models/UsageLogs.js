import { model, Schema } from "mongoose";

const UsageLogSchema = new Schema({
    business: { type: Schema.Types.ObjectId, ref: "Businesses", index: true, required: true },
    references: {
        type: { type: String, enum: ["Message", "CallSession"] },
        id: { type: Schema.Types.ObjectId, refPath: "references.type" },
    },
    model: {
        name: String,
        provider: String,
        tokenDollarRate: Number,
    },
    event: {
        type: { type: String, enum: ["update", "final"], default: "final" },
        // Realtime-only transport; omit for turn-based chat
        meduim: { type: String, enum: ["media-stream", "webrtc"] },
        seq: { type: Number, default: 1 },
    },
    usage: { type: Schema.Types.Mixed, default: {} },
    cost: {
        AvaCredit: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
        delta: { type: Number, default: 0 },
        currency: { type: String, default: "USD" },
        breakdown: Schema.Types.Mixed,
        meta: Schema.Types.Mixed,
        warnings: [String],
        error: String,
    },
}, {
    timestamps: true,
});

UsageLogSchema.index({ business: 1, createdAt: -1 });
UsageLogSchema.index({ "references.id": 1, "references.type": 1, createdAt: 1 });

export const UsageLog = model("UsageLog", UsageLogSchema, "UsageLogs");
