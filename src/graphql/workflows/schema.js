export const workflowTypeDefs = `#graphql
    type Workflow {
        _id: ID!
        name: String
        status: String
        trigger: String
        task: JSON
        business: Business
        createdBy: User
        createdAt: DateTime
        updatedAt: DateTime
    }
    type WorkflowList {
        data: [Workflow]
        metaData: PaginationMetaData
    }
    type TriggerTemplate {
        name: String
    description: String,
        type: String
        payload: JSON
    }
    type TriggerTemplateList {
        data: [TriggerTemplate]
        metaData: PaginationMetaData
    }
type Query {
    fetchTriggerTemplates(limit: Int, page: Int, name: String): TriggerTemplateList @requireScope(scope: "workflow:read") @requireBusinessAccess
    fetchWorkflows(id: ID, trigger: String, status: String, limit: Int, page: Int): WorkflowList @requireScope(scope: "workflow:read") @requireBusinessAccess
}
type Mutation {
    createWorkflow(name: String, trigger: String, task: JSON): Workflow @requireScope(scope: "workflow:create") @requireBusinessAccess
    updateWorkflow(id: ID!, name: String, trigger: String, task: JSON, status: String): Workflow @requireScope(scope: "workflow:update") @requireBusinessAccess
    deleteWorkflow(id: ID!): Boolean @requireScope(scope: "workflow:delete") @requireBusinessAccess
    testTask(input: JSON): JSON @requireScope(scope: "workflow:test") @requireBusinessAccess
}
`;