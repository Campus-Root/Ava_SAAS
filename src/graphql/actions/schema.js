export const actionTypeDefs = `#graphql
  """Represents an action that can be performed by an agent"""
  type Action {
    """Unique identifier for the action"""
    _id: ID!
    """Name of the action"""
    name: String
    """Description of what the action does"""
    description: String 
    """Business that owns this action"""
    business: Business
    """Whether the action runs asynchronously"""
    async: Boolean
    """Whether the action requires approval before execution"""
    needsApproval: Boolean
    """JSON schema defining the action parameters"""
    config: JSON
    parameters: JSON
    """JavaScript function code that implements the action"""
    functionString: String
    """Error handling function code"""
    errorFunction: String
    """UI configuration for rendering the action"""
    UI: JSON
    """Whether the action is publicly available"""
    isPublic: Boolean
    """When the action was created"""
    createdAt: DateTime
    """When the action was last updated"""
    updatedAt: DateTime
  }

  """Input type for creating/updating actions"""
  input ActionInput {
    """Name of the action (required)"""
    name: String!
    """Description of what the action does"""
    description: String
    """Whether the action runs asynchronously"""
    async: Boolean
    """Whether the action requires approval before execution"""
    needsApproval: Boolean
    """JSON schema defining the action parameters"""
    parameters: JSON
    """JSON schema defining the action config"""
    config: JSON
    """JavaScript function code that implements the action"""
    functionString: String
    """Error handling function code"""
    errorFunction: String
    """UI configuration for rendering the action"""
    UI: JSON
    """Whether the action is publicly available"""
    isPublic: Boolean
  }

  type ActionPagination {
    data: [Action]
    metaData: PaginationMetaData
  }
  type Query {
    """Get all actions for the user's business
    @param limit - Maximum number of actions to return
    @param page - Page number to return
    @param id - Optional ID to fetch a specific action
    @param page - Page number to return
    @param isPublic - Filter by public/private status"""
    actions(id:ID limit: Int page: Int isPublic: Boolean): ActionPagination @requireScope(scope: "action:read") @requireBusinessAccess
  }

  type Mutation {
    """Create a new action
    @param action - Action data to create"""
    createAction(action: ActionInput!): Action @requireScope(scope: "action:create") @requireBusinessAccess

    """Update an existing action
    @param id - ID of action to update
    @param action - New action data"""
    updateAction(id: ID! action: ActionInput!): Action @requireScope(scope: "action:update")  @requireBusinessAccess

    """Delete an action
    @param id - ID of action to delete"""
    deleteAction(id: ID!): Boolean @requireScope(scope: "action:delete") @requireBusinessAccess

    """Test an action
    @param actionId - ID of action to test
    @param parameters - Parameters to pass to the action"""
    testAction(actionId: ID!, parameters: JSON!): JSON @requireScope(scope: "action:read") @requireBusinessAccess
  }
`; 