export const paymentTypeDefs = `#graphql
type Plan {
    _id: ID!
    code: String
    name: String
    description: String
    price:JSON
    type: PlanTypeEnum
    validity: Int
    credits:CreditsType
    spendRatio: Int
    status: PlanStatusEnum
    features: [String]
    allowedTopUps: [Plan]
    autoRenew: Boolean
    createdAt: DateTime
    updatedAt: DateTime
}
type AmountSchema {
    value: Int
    currency: String
}
type Subscription {
    _id: ID!
    business: Business
    createdBy: User
    plan: Plan
    gateway: String
    type: String
    events: JSON
    amount: AmountSchema
    gatewayFee: AmountSchema
    tax: AmountSchema
    netAmount: AmountSchema
    billing: JSON
    gatewayReference: JSON
    metadata: JSON
    createdAt: DateTime
    updatedAt: DateTime
}
type CreditsType {
    llm: Int
    knowledge: Int
    miscellaneous: Int
}
    input CreditsTypeInput {
    llm: Int
    knowledge: Int
    miscellaneous: Int
}
enum PlanTypeEnum {
    FREE
    BASE
    TOPUP
}
enum PlanStatusEnum {
    active
    inactive
}
input PlanInput {
    code: String
    name: String
    description: String
    price:JSON
    type: PlanTypeEnum
    validity: Int
    credits:CreditsTypeInput
    spendRatio: Int
    status: PlanStatusEnum
    features: [String]
    allowedTopUps: [ID]
    autoRenew: Boolean
} 
type UsageLog {
    _id: ID!
    business: Business
    references: JSON
    model: JSON
    event: JSON
    usage: JSON
    cost: JSON
}
type Query {
    fetchPublicPlans(code: String, name: String, type: PlanTypeEnum, status: PlanStatusEnum, id: ID): [Plan]
    fetchPlans(code: String, name: String, type: PlanTypeEnum, status: PlanStatusEnum, id: ID): [Plan] @requireScope(scope: "super:all")
    fetchSubscription(id: ID!): Subscription @requireScope(scope: "subscription:read")
    fetchUsageLogs(type: String, startDate: DateTime, endDate: DateTime): [UsageLog] @requireScope(scope: "subscription:read")
}

type Mutation {
    createAVAPlan(input: PlanInput!): Plan @requireScope(scope: "super:all")
    updateAVAPlan(id: ID!, input: PlanInput!): Plan @requireScope(scope: "super:all")
    deleteAVAPlan(id: ID!): Boolean @requireScope(scope: "super:all")
    startPayment(planId: ID!, gateway: String, paymentType: String, startDate:DateTime): Subscription @requireScope(scope: "subscription:upgrade")
    cancelSubscription(id: ID!): Boolean @requireScope(scope: "subscription:cancel")
}
`;