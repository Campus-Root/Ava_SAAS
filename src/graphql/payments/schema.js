export const paymentTypeDefs = `#graphql
type Plan {
    _id: ID!
    code: String
    name: String
    description: String
    amount: AmountSchema
    type: PlanTypeEnum
    validity: Int
    credits: Int
    spendRatio: Int
    status: PlanStatusEnum
    features: [String]
    allowedTopUps: [Plan]
    autoRenew: Boolean
    public: Boolean
    paymentGateWay: JSON
    createdAt: DateTime
    updatedAt: DateTime
}
type Payment {
    _id: ID!
    business: Business
    subscription: Subscription
    gateway: String
    gatewayReference: JSON
    status: String
    notes: JSON
}
type AmountSchema {
    value: Int
    currency: String
}
input AmountSchemaInput {
    value: Int
    currency: String
}
enum SubscriptionStatusEnum {
    created
    authenticated
    active
    pending_downgrade
    cancel_at_period_end
    paused
    halted
    cancelled
    expired
    completed
}
enum PendingChangeTypeEnum {
    upgrade
    downgrade
    cancel
}
type SubscriptionBilling {
    periodStart: DateTime
    periodEnd: DateTime
    nextChargeAt: DateTime
    paidCount: Int
    totalCount: Int
}
type PendingChange {
    type: PendingChangeTypeEnum
    targetPlan: Plan
    targetPlanCode: String
    applyAt: DateTime
    chargeAmount: Int
    creditDelta: Int
    orderId: String
}
type Subscription {
    _id: ID!
    business: Business
    createdBy: User
    plan: Plan
    planCode: String
    gateway: String
    gatewaySubscriptionId: String
    status: SubscriptionStatusEnum
    amount: AmountSchema
    creditsPerCycle: Int
    spendRatio: Int
    billing: SubscriptionBilling
    pendingChange: PendingChange
    cancelAtPeriodEnd: Boolean
    cancelledAt: DateTime
    cancelReason: String
    startedAt: DateTime
    endedAt: DateTime
    shortUrl: String
    createdAt: DateTime
    updatedAt: DateTime
}
type RazorpayCheckout {
    keyId: String
    mode: String
    subscriptionId: String
    orderId: String
    amount: Int
    amountPaise: Int
    currency: String
    shortUrl: String
}
type SubscriptionCheckoutPayload {
    subscription: Subscription
    checkout: RazorpayCheckout
}
type SubscriptionPagination {
    data: [Subscription]
    metaData: PaginationMetaData
}

enum PlanTypeEnum {
    FREE
    BASE
    TOPUP
    TEST
}
enum PlanStatusEnum {
    active
    inactive
}
input PlanInput {
    code: String
    name: String
    description: String
    amount: AmountSchemaInput
    public: Boolean
    paymentGateWay: JSON
    type: PlanTypeEnum
    validity: Int
    credits: Int
    spendRatio: Int
    status: PlanStatusEnum
    features: [String]
    allowedTopUps: [ID]
    autoRenew: Boolean
}
type PaymentCheckoutPayload {
    payment: Payment
    checkout: RazorpayCheckout
}
type Query {
    fetchPublicPlans(code: String, name: String, type: PlanTypeEnum, status: PlanStatusEnum, id: ID): [Plan]
    fetchPlans(code: String, name: String, type: PlanTypeEnum, status: PlanStatusEnum, id: ID): [Plan] @requireScope(scope: "super:all")
    subscriptionHistory(page: Int, limit: Int, id: ID, planId: ID, status: SubscriptionStatusEnum, startedAt: DateTime, endedAt: DateTime, cancelledAt: DateTime): SubscriptionPagination @requireScope(scope: "subscription:read") @requireBusinessAccess
}

type Mutation {
    createAVAPlan(input: PlanInput!): Plan @requireScope(scope: "super:all")
    updateAVAPlan(id: ID!, input: PlanInput!): Plan @requireScope(scope: "super:all")
    deleteAVAPlan(id: ID!): Boolean @requireScope(scope: "super:all")
    startFreeTrail: Boolean @requireScope(scope: "subscription:billing") @requireBusinessAccess
    startSubscription(planId: ID!): SubscriptionCheckoutPayload @requireScope(scope: "subscription:billing") @requireBusinessAccess
    # upgradeSubscription(targetPlanCode: String!): SubscriptionCheckoutPayload @requireScope(scope: "subscription:upgrade") @requireBusinessAccess
    # downgradeSubscription(targetPlanCode: String!): Subscription @requireScope(scope: "subscription:downgrade") @requireBusinessAccess
    # cancelSubscription: Subscription @requireScope(scope: "subscription:cancel") @requireBusinessAccess
    # pauseSubscription: Subscription @requireScope(scope: "subscription:billing") @requireBusinessAccess
    # resumeSubscription: Subscription @requireScope(scope: "subscription:billing") @requireBusinessAccess
    purchaseTopup(planId: ID!): PaymentCheckoutPayload @requireScope(scope: "subscription:billing") @requireBusinessAccess
}
`;