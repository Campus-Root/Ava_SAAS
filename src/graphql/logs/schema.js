export const logTypeDefs = `#graphql
enum LogLevel { warn error info debug }
enum LogCategory { AUTHENTICATION PAYMENT CREDIT SUBSCRIPTION API_ACCESS WEBHOOK ERROR OTHER }
enum LogStatus { SUCCESS FAILURE PENDING }
enum LogEnvironment { dev staging prod }
enum UsageDirection { credit debit reset }
enum UsageStatus { posted pending failed reversed }
enum WorkflowRunStatus { running completed failed }

type LogBusiness {
    _id: ID
    name: String
}

type PlatformLog {
    _id: ID!
    user: ID
    business: LogBusiness
    level: LogLevel
    event: String
    category: LogCategory
    status: LogStatus
    message: String
    service: String
    environment: LogEnvironment
    requestId: String
    meta: JSON
    data: JSON
    error: JSON
    response: JSON
    createdAt: DateTime
    updatedAt: DateTime
}

type UsageLogSource {
    type: String
    id: ID
}

type UsageLogEntry {
    _id: ID!
    business: LogBusiness
    direction: UsageDirection
    credits: Float
    status: UsageStatus
    payment: ID
    source: UsageLogSource
    idempotencyKey: String
    meta: JSON
    note: String
    createdBy: ID
    createdAt: DateTime
    updatedAt: DateTime
}

type WorkflowLogError {
    message: String
    stack: String
}

type WorkflowLogStep {
    nodeId: String
    label: String
    type: String
    status: String
    summary: String
    input: JSON
    output: JSON
    error: WorkflowLogError
    startedAt: DateTime
    finishedAt: DateTime
}

type WorkflowLogEntry {
    _id: ID!
    workflow: ID
    business: LogBusiness
    executionId: String
    eventId: String
    name: String
    trigger: String
    status: WorkflowRunStatus
    summary: String
    input: JSON
    outputs: JSON
    error: WorkflowLogError
    steps: [WorkflowLogStep]
    startedAt: DateTime
    finishedAt: DateTime
    createdAt: DateTime
    updatedAt: DateTime
}

type PlatformLogPage {
    data: [PlatformLog]
    metaData: PaginationMetaData
}

type UsageLogPage {
    data: [UsageLogEntry]
    metaData: PaginationMetaData
}

type WorkflowLogPage {
    data: [WorkflowLogEntry]
    metaData: PaginationMetaData
}

type LogViewSummary {
    logs: Int!
    usageLogs: Int!
    workflowLogs: Int!
    errors: Int!
    failedLogs: Int!
    failedWorkflows: Int!
    runningWorkflows: Int!
    creditsDebited: Float!
    creditsCredited: Float!
}

type LogView {
    fetchedAt: DateTime!
    summary: LogViewSummary!
    logs: PlatformLogPage!
    usageLogs: UsageLogPage!
    workflowLogs: WorkflowLogPage!
}

type Query {
    """Latest platform logs, credit-ledger usage, and workflow runs. Requires admin:logs."""
    fetchLogView(
        limit: Int
        page: Int
        search: String
        level: LogLevel
        category: LogCategory
        logStatus: LogStatus
        service: String
        environment: LogEnvironment
        usageDirection: UsageDirection
        usageStatus: UsageStatus
        workflowStatus: WorkflowRunStatus
        business: ID
        since: DateTime
    ): LogView! @requireScope(scope: "admin:logs")
}
`;
