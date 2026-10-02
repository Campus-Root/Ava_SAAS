export const conversationTypeDefs = `#graphql

  """Status of the conversation lifecycle"""
  enum ConversationStatusEnum {
    open
    pending
    snoozed
    closed
    archived
    spam
    completed
  }

  """Priority level of the conversation"""
  enum ConversationPriorityEnum {
    low
    normal
    high
    urgent
  }

  """Status of the workflow attached to the conversation"""
  enum WorkflowStatusEnum {
    started
    completed
    failed
  }

  """WebSocket connection information"""
  type Sockets {
    """ID of the socket connection"""
    socketId: String
    """Reason for socket disconnection, if applicable"""
    disconnectReason: String
  }

  """Credit usage breakdown for a conversation"""
  type CreditsUsage {
    conversationCredits: Float
    analysisCredits: Float
    miscellaneousCredits: Float
    totalCredits: Float
  }

  """Metadata attached to the conversation"""
  type ConversationMetadata {
    """Extracted data from the conversation"""
    extractedData: JSON
    """Socket connection details"""
    sockets: Sockets
    """Geographic location of the user"""
    userLocation: JSON
    """Credits consumed by this conversation"""
    CreditsUsage: CreditsUsage
  }

  """Assignment/routing config for a conversation"""
  type ConversationAssignment {
    """Whether the AI agent should reply"""
    agentReply: Boolean
    """Reason for handoff"""
    handoffReason: String
    """Urgency level of the handoff"""
    handoffUrgency: String
    """When the conversation was assigned"""
    assignedAt: DateTime
    """Who the conversation is assigned to, for support/agent routing in case of support ping to business notifications else give it to agent"""
    assignedTo: String
  }

  """Config settings applied to the conversation"""
  type ConversationConfig {
    assignment: ConversationAssignment
    tags: [String]
  }

  """Represents a conversation between a lead and an agent"""
  type Conversation {
    """Unique identifier"""
    _id: ID!
    """AI agent handling the conversation"""
    agent: Agent
    """Business this conversation belongs to"""
    business: Business
    """Channel  the conversation is happening on"""
    channel: Channel
    """Lead (contact) involved in the conversation"""
    lead: Lead
    """External provider thread ID"""
    externalConversationId: String
    """Routing and assignment configuration"""
    config: ConversationConfig
    """Current status of the conversation"""
    status: ConversationStatusEnum
    """Priority level"""
    priority: ConversationPriorityEnum
    """Attached workflow"""
    workflow: Workflow
    """Execution status of the attached workflow"""
    workflowStatus: WorkflowStatusEnum
    """Raw workflow execution data"""
    workflowExecution: JSON
    """Conversation metadata"""
    metadata: ConversationMetadata
    """When the conversation was created"""
    createdAt: DateTime
    """When the conversation was last updated"""
    updatedAt: DateTime
  }

  type ConversationPagination {
    data: [Conversation]
    metaData: PaginationMetaData
  }

  type Query {
    """
    Get conversations matching the specified filters.
    @param limit        - Max results per page (default: 10)
    @param page         - Page number (default: 1)
    @param status       - Filter by conversation status
    @param priority     - Filter by priority level
    @param id           - Fetch a specific conversation by ID
    @param agentId      - Filter by AI agent ID
    @param channel      - Filter by channel ObjectId
    @param channelIds   - Filter by multiple channel ObjectIds
    @param from         - Created-at start date
    @param to           - Created-at end date
    @param disconnectReason - Filter by socket disconnect reason
    """
    conversations(
      limit: Int
      page: Int
      status: ConversationStatusEnum
      id: ID
      priority: ConversationPriorityEnum
      agentIds: [ID]
      channelIds: [ID]
      leadIds: [ID]
      from: DateTime
      to: DateTime
      sort: JSON
      disconnectReason: String
    ): ConversationPagination @requireScope(scope: "conversation:read") @requireBusinessAccess
  }

  type Mutation {
    updateConversationConfig(id: ID!, config: JSON): Conversation @requireScope(scope: "conversation:write") @requireBusinessAccess
    updateConversationStatus(id: ID!, status: ConversationStatusEnum!): Conversation @requireScope(scope: "conversation:write") @requireBusinessAccess
  }
`;