import { Schema, model } from 'mongoose';
const AmountSchema = new Schema({
    value: { type: Number, required: true }, // eg: 22000
    currency: { type: String, default: "INR" }
}, { _id: false });
const PaymentSchema = new Schema({
    business: { type: Schema.Types.ObjectId, ref: 'Businesses', required: true },
    subscription: { type: Schema.Types.ObjectId, ref: 'Subscriptions' },
    gateway: String,
    gatewayReference: Schema.Types.Mixed, //{ paymentId: String, orderId: String, invoiceId: String },
    gatewayPaymentId: { type: String, index: true, sparse: true },
    gatewayInvoiceId: String, // Razorpay invoice id (inv_xxx) for a subscription cycle; fetch the hosted PDF from Razorpay with it
    amount: AmountSchema,
    notes: Schema.Types.Mixed, // { planId, planCode, action, credits }
    events: {
        authorized: Date,
        captured: Date,
        failed: Date,
        refunded: Date
    },
    status: { type: String, enum: ['authorized', 'captured', 'failed', 'refunded'], default: 'authorized' },
    failureReason: String,
    retryCount: { type: Number, default: 0 },
    paidAt: Date
}, {
    timestamps: true,
    versionKey: false
});

export const Payment = model('Payments', PaymentSchema, "Payments");
