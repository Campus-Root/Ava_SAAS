export const progressTypeDefs = `#graphql
  """Root for long-running lead and campaign work. Billing stays on type Subscription."""
  schema {
    query: Query
    mutation: Mutation
    subscription: ProgressFeed
  }

  enum ProgressPhase {
    started
    progress
    completed
    failed
  }

  """Where a streamed job is right now. percent stays under 100 until phase is completed."""
  type ProgressSnapshot {
    phase: ProgressPhase!
    processed: Int!
    total: Int!
    percent: Int!
    index: Int
    message: String
    ok: Boolean
    error: String
    code: String
  }

  type BulkValidateProgress {
    progress: ProgressSnapshot!
    index: Int
    """WOULD_CREATE, EXISTING_LEAD, or WITHIN_BATCH"""
    outcome: String
    row: BulkValidateRow
    conflict: BulkValidateConflict
    """Set when phase is completed. Same shape as validateBulkCreateLeads."""
    result: BulkValidateResult
  }

  type BulkCreateProgress {
    progress: ProgressSnapshot!
    index: Int
    """CREATED, MERGED, DUPLICATE, or ERROR"""
    outcome: String
    lead: Lead
    duplicate: DuplicateConflict
    itemError: String
    """Set when phase is completed. Same shape as bulkCreateLeads."""
    result: BulkCreateResult
  }

  type CampaignLeadError {
    leadId: ID
    error: String
  }

  type CampaignValidateProgress {
    progress: ProgressSnapshot!
    leadId: ID
    """Set on each lead, and again on the completed event for the whole list."""
    valid: Boolean
    leadError: String
    """Set when phase is completed."""
    leadErrors: [CampaignLeadError!]
  }

  type CampaignCreateProgress {
    progress: ProgressSnapshot!
    leadId: ID
    leadError: String
    """Set when phase is completed."""
    campaign: Campaign
  }

  type ProgressFeed {
    """Dry-run bulk create, one event per row, then a final result. Writes nothing."""
    validateBulkCreateLeadsProgress(dataList: [LeadCreateInput!]!): BulkValidateProgress
      @requireScope(scope: "lead:import") @requireBusinessAccess

    """Creates or merges leads and reports percent after each row."""
    bulkCreateLeadsProgress(dataList: [LeadCreateInput!]!): BulkCreateProgress
      @requireScope(scope: "lead:import") @requireBusinessAccess

    """Checks each campaign lead and reports percent. Does not throw on bad leads."""
    validateCampaignProgress(channelId: ID!, leadIds: [ID!]!, config: JSON): CampaignValidateProgress
      @requireBusinessAccess

    """Creates a campaign and reports percent after each lead. Rolls back the campaign document if the stream fails."""
    createCampaignProgress(
      name: String!
      channelId: ID!
      leadIds: [ID!]!
      config: JSON
      scheduledAt: DateTime
    ): CampaignCreateProgress
      @requireBusinessAccess
  }
`;
