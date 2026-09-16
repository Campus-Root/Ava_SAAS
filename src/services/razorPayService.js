import Razorpay from "razorpay";
// import crypto from 'node:crypto';
import "dotenv/config";
import { createHmac } from 'node:crypto';
export class RazorPayService {
    static client = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    static async createOrder({ amount, currency = "INR", receiptId, notes = {} }) {
        return await this.client.orders.create({ amount: Math.round(amount * 100), currency, receipt: receiptId, notes, });
    }

    static getPublicKey() {
        return process.env.RAZORPAY_KEY_ID;
    }

    static async verifyPayment(order_id, payment_id, signature) {
        try {
            const body = order_id + "|" + payment_id;
            const expectedSignature = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(body.toString()).digest("hex");
            if (expectedSignature !== signature) throw new Error("Invalid signature");
            const order = await this.fetchOrderById(order_id);
            if (!order) throw new Error("Order not found");
            return order.status === "paid"
        } catch (error) {
            console.error(error);
            return false;
        }
    }
    static async fetchPayment(payment_id) {
        return await this.client.payments.fetch(payment_id);
    }

    static async fetchOrderById(order_id) {
        return await this.client.orders.fetch(order_id);
    }

    static async fetchOrders({ limit = 10, skip = 0 }) {
        return await this.client.orders.all({ count: limit, skip });
    }

    static async refundPayment(payment_id, amount = null) {
        return await this.client.payments.refund(payment_id, amount ? { amount: amount * 100 } : {});
    }
    static async createSubscription({ plan_id, total_count = 120, quantity = 1, notes = {}, addons = null, offer_id = null, startDate = new Date() }) {
        let startTime = new Date(startDate), subscription;
        const startTimestampMs = startTime.getTime();
        const nowMs = Date.now();
        const start_at = startTimestampMs > nowMs ? Math.floor(startTimestampMs / 1000) : null;
        try {
            subscription = await this.client.subscriptions.create({ total_count, plan_id, quantity, customer_notify: true, addons, offer_id, notes, start_at });
            return subscription;
        } catch (error) {
            console.error(error);
            throw new Error("Failed to create subscription");
        }
    }
    static async fetchSubscriptionById(subscription_id) {
        return await this.client.subscriptions.fetch(subscription_id);
    }
    static async fetchSubscriptions({ plan_id, from, to, limit = 10, skip = 0 }) {
        return await this.client.subscriptions.all({ plan_id, from: new Date(from).getTime() / 1000, to: new Date(to).getTime() / 1000, count: limit, skip });
    }
    static async updateSubscription(subscription_id, { plan_id, schedule_change_at = "now", quantity, notes, offer_id, total_count, customer_notify = 1 } = {}) {
        const payload = { schedule_change_at, customer_notify };
        if (plan_id) payload.plan_id = plan_id;
        if (quantity) payload.quantity = quantity;
        if (notes) payload.notes = notes;
        if (offer_id) payload.offer_id = offer_id;
        if (total_count) payload.total_count = total_count;
        return await this.client.subscriptions.update(subscription_id, payload);
    }
    static async cancelSubscription(subscription_id) {
        return await this.client.subscriptions.cancel(subscription_id, { cancel_at_cycle_end: true, });
    }
    static async pauseSubscription(subscription_id) {
        return await this.client.subscriptions.pause(subscription_id, { pause_at: "now" });
    }
    static async resumeSubscription(subscription_id) {
        return await this.client.subscriptions.resume(subscription_id, { resume_at: "now" });
    }
    static async fetchSubscriptionInvoices(subscription_id) {
        return await this.client.invoices.all({ subscription_id });
    }
}
