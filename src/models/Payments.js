import { Schema, model } from 'mongoose';
const AmountSchema = new Schema({
    value: { type: Number, required: true }, // eg: 22000
    currency: { type: String, default: "INR" }
}, { _id: false });
const PaymentSchema = new Schema({
    invoice: { type: Schema.Types.ObjectId, ref: 'Invoices' },
    business: { type: Schema.Types.ObjectId, ref: 'Businesses', required: true },
    subscription: { type: Schema.Types.ObjectId, ref: 'Subscriptions' },
    gateway: String,
    gatewayReference: Schema.Types.Mixed, //{ paymentId: String, orderId: String, invoiceId: String },
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
const InvoiceSchema = new Schema({
    business: { type: Schema.Types.ObjectId, ref: 'Businesses', required: true },
    subscription: { type: Schema.Types.ObjectId, ref: 'Subscriptions' },
    gatewayReference: Schema.Types.Mixed, // {  invoiceId: String,   // inv_xxx   orderId: String },
    amount: AmountSchema,
    events: {
        issuedAt: Date,
        paidAt: Date,
        cancelledAt: Date,
        expiredAt: Date
    },
    shortUrl: String,
}, {
    timestamps: true,
    versionKey: false
});

export const Invoice = model('Invoices', InvoiceSchema, "Invoices");
export const Payment = model('Payments', PaymentSchema, "Payments");
