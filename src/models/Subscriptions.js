import { Schema, model } from 'mongoose';

const AmountSchema = new Schema({
    value: { type: Number, required: true },
    currency: { type: String, default: "INR" }
}, { _id: false });

export const SUBSCRIPTION_STATUS = ['created', 'pending_payment', 'authenticated', 'active', 'pending_downgrade', 'cancel_at_period_end', 'paused', 'halted', 'cancelled', 'expired', 'completed'];

export const CURRENT_SUBSCRIPTION_STATUSES = ['created', 'pending_payment', 'authenticated', 'active', 'pending_downgrade', 'cancel_at_period_end', 'paused', 'halted'];

const SubscriptionSchema = new Schema({
    business: { type: Schema.Types.ObjectId, ref: 'Businesses', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Users' },
    plan: { type: Schema.Types.ObjectId, ref: 'Plans', required: true },
    planCode: { type: String, required: true, index: true },
    gateway: { type: String, enum: ['razorpay', 'none'], default: 'razorpay' },
    gatewaySubscriptionId: { type: String, index: true, sparse: true },
    status: { type: String, enum: SUBSCRIPTION_STATUS, default: 'created', index: true },
    amount: AmountSchema,
    creditsPerCycle: { type: Number, default: 0 },
    spendRatio: {type: Number, enum: [1080, 1666, 1583], default: 1583},
    billing: {
        periodStart: Date,
        periodEnd: Date,
        nextChargeAt: Date,
        paidCount: { type: Number, default: 0 },
        totalCount: Number
    },
    pendingChange: {
        type: { type: String, enum: ['upgrade', 'downgrade', 'cancel'] },
        targetPlan: { type: Schema.Types.ObjectId, ref: 'Plans' },
        targetPlanCode: String,
        applyAt: Date,
        chargeAmount: Number,
        creditDelta: Number,
        orderId: String
    },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: Date,
    cancelReason: String,
    startedAt: Date,
    endedAt: Date,
    shortUrl: String,
    creditGrant: {
        lastCycle: { type: Number, default: 0 },
        lastGrantedAt: Date,
        lastPaymentId: String
    },
    gatewayPayload: Schema.Types.Mixed
}, {
    timestamps: true,
    versionKey: false
});

SubscriptionSchema.index({ business: 1, createdAt: -1 });
SubscriptionSchema.index({ business: 1, status: 1, createdAt: -1 });
SubscriptionSchema.index({ gatewaySubscriptionId: 1 }, { unique: true, sparse: true });
SubscriptionSchema.index(
    { business: 1 },
    {
        unique: true,
        name: 'one_current_subscription_per_business',
        partialFilterExpression: { status: { $in: CURRENT_SUBSCRIPTION_STATUSES } }
    }
);

export const Subscription = model('Subscriptions', SubscriptionSchema, "Subscriptions");