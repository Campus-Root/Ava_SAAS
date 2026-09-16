import { model, Schema } from 'mongoose';
const BusinessSchema = new Schema({
    name: String,
    logoURL: String,
    facts: [String],
    quickQuestions: [{ label: String, value: String }],
    sector: String,
    tagline: String,
    address: String,
    description: String,
    MAX_DAYS: { type: Number, default: 45 },
    contact: {
        mail: String,
        phone: String,
        website: String
    },
    freeTrailClaimed: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "Users" },
    // members: [{ type: Schema.Types.ObjectId, ref: "Users" }],
    documents: [{ type: Schema.Types.ObjectId, ref: "document" }],
    credits: {
        currentSubscription: { type: Schema.Types.ObjectId, ref: "Subscriptions" },
        active: { type: Boolean, default: true },
        balance: { type: Number, default: 0, min: 0 },
        lastUpdated: { type: Date, default: new Date() }
    }
}, {
    timestamps: true
});
export const Business = model('Businesses', BusinessSchema, "Businesses");