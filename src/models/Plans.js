import { Schema, model } from 'mongoose';
// const CreditSchema = new Schema(
//     {
//         llm: { type: , min: 0, default: 0 },
//         knowledge: { type: Number, min: 0, default: 0 },
//         miscellaneous: { type: Number, min: 0, default: 0 },
//     },
//     { _id: false }
// );
const AmountSchema = new Schema({
    value: { type: Number, required: true }, // eg: 22000
    currency: { type: String, default: "INR" }
}, { _id: false });
const PlanSchema = new Schema({
    business: { type: Schema.Types.ObjectId, ref: "Business" },
    code: { type: String, unique: true }, // ['FREE', 'BASE', 'GROWTH', 'BASE_TOPUP', 'GROWTH_TOPUP'],
    public: { type: Boolean, default: false },
    name: { type: String, required: true },
    description: String,
    amount: AmountSchema,
    type: { type: String, enum: ['FREE', 'BASE', 'TOPUP', 'ENTERPRISE'], required: true, index: true, },
    validity: { type: Number, default: 30 },// in days
    credits: Number,
    spendRatio: { type: Number, enum: [1080, 1666, 1583], default: 1583 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    features: [String],
    allowedTopUps: [{ type: Schema.Types.ObjectId, ref: 'Plans' }],
    autoRenew: { type: Boolean, default: false },
    paymentGateWay: {
        razorpay: {
            plan_id: String,
        }
    },
}, { timestamps: true });
export const Plan = model('Plans', PlanSchema, "Plans");

