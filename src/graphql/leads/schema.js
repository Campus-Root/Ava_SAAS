export const leadTypeDefs = `#graphql

  enum LeadStatusEnum {
    new
    contacted
    qualified
    converted
    lost
  }

  """A single platform contact entry (e.g. a WhatsApp number or email address)"""
  type LeadPlatformEntry {
    platform: String!
    handle: String
    """Label such as work, personal, brand"""
    label: String
    isPrimary: Boolean
    metadata: JSON
  }

  """All known contact handles for a lead, grouped by platform"""
  type LeadContactDetails {
    whatsapp: [LeadPlatformEntry]
    telegram: [LeadPlatformEntry]
    email: [LeadPlatformEntry]
    phone: [LeadPlatformEntry]
    twitter: [LeadPlatformEntry]
    instagram: [LeadPlatformEntry]
    facebook: [LeadPlatformEntry]
  }

  """A lead / contact in the system"""
  type Lead {
    _id: ID!
    """Optional template this lead was created from"""
    template: LeadTemplate
    business: Business
    createdBy: User
    name: String
    contactDetails: LeadContactDetails
    """Inbound source e.g. Whatsapp-Inbound, facebook_ads"""
    source: String
    tags: [String]
    leadScore: Int
    status: LeadStatusEnum
    notes: [String]
    lastInteractedAt: DateTime
    nextFollowUpAt: DateTime
    pendingTasks: JSON
    """Arbitrary template-driven data"""
    data: JSON
    createdAt: DateTime
    updatedAt: DateTime
  }

  """A template that defines the shape of leads created from it"""
  type LeadTemplate {
    _id: ID!
    business: ID
    createdBy: ID
    name: String!
    description: String
    """Field definitions (schema for the lead's data object)"""
    fields: JSON
    isActive: Boolean
    createdAt: DateTime
    updatedAt: DateTime
  }

  type LeadPagination {
    data: [Lead]
    metaData: PaginationMetaData
  }

  type LeadTemplatePagination {
    data: [LeadTemplate]
    metaData: PaginationMetaData
  }

type BulkCreateResult {
  created: [Lead]
  merged: [Lead]
  duplicatesRequiringMode: [DuplicateConflict]
}

type DuplicateConflict {
  input: JSON
  existingLeadId: ID
  matchedOn: JSON
}

enum BulkConflictReason {
  EXISTING_LEAD
  WITHIN_BATCH
}

"""A row that would be created if bulkCreateLeads ran"""
type BulkValidateRow {
  index: Int!
  input: JSON
}

"""A row that conflicts with the DB or another row in the same batch"""
type BulkValidateConflict {
  index: Int!
  input: JSON
  reason: BulkConflictReason!
  """Set when reason is EXISTING_LEAD"""
  existingLeadId: ID
  """Set when reason is WITHIN_BATCH — index of the earlier row in this batch"""
  conflictIndex: Int
  matchedOn: [String!]!
}

type BulkValidateResult {
  wouldCreate: [BulkValidateRow!]!
  conflicts: [BulkValidateConflict!]!
  summary: BulkValidateSummary!
}

type BulkValidateSummary {
  total: Int!
  wouldCreate: Int!
  existingDuplicates: Int!
  withinBatchDuplicates: Int!
}
enum BulkCreateMode {
  merge
  new
}

  # ─── Inputs ──────────────────────────────────────────────────────────────────



  """Input for creating or updating a lead template"""
  input LeadTemplateInput {
    name: String
    description: String
    fields: JSON
    isActive: Boolean
  }
  """Input for creating or updating a lead"""
input LeadCreateInput {
  mode: enum
  templateId: ID
  contactDetails: JSON
  createdBy: ID
  lastInteractedAt: DateTime
  nextFollowUpAt: DateTime
  name: String
  source: String
  tags: [String]
  leadScore: Int
  status: LeadStatusEnum
  notes: [String]
  data: JSON
}


input contactLeadMessageInput {
  type: String
  data: JSON
}
  type FacetOption {
  value: String
  count: Int
}

type LeadFacets {
  status: [FacetOption]
  origin: [FacetOption]
  tags: [FacetOption]
  template: [FacetOption]
}

  # ─── Queries ─────────────────────────────────────────────────────────────────

  type Query {
    """Fetch paginated lead templates for the business"""
    fetchleadsTemplates(
      limit: Int
      page: Int
      id: ID
      templateId: ID
      isActive: Boolean
    ): LeadTemplatePagination @requireScope(scope: "lead:read") @requireBusinessAccess


  fetchLeadFacets : LeadFacets @requireScope(scope:"lead:read")   @requireBusinessAccess

    """Fetch paginated leads with optional filters"""
    fetchLeads(
      limit: Int
      page: Int
      templateIds: [ID]
      identifier: String
      ids: [ID]
      status: [LeadStatusEnum]
      origin: [String]
      tags: [String]
    ): LeadPagination @requireScope(scope: "lead:read") @requireBusinessAccess

    """Dry-run bulk create: checks DB + within-batch collisions, writes nothing"""
    validateBulkCreateLeads(dataList: [LeadCreateInput!]!): BulkValidateResult @requireScope(scope: "lead:import") @requireBusinessAccess
  }

  # ─── Mutations ───────────────────────────────────────────────────────────────
  enum ContactLeadAction {
    sendMessage
    sendMedia
    initiateAiCall
  }
  type Mutation {
    createLeadTemplate(LeadTemplateInput: LeadTemplateInput!): LeadTemplate
      @requireScope(scope: "lead:create") @requireBusinessAccess

    updateLeadTemplate(id: ID!, LeadTemplateInput: LeadTemplateInput!): LeadTemplate
      @requireScope(scope: "lead:update") @requireBusinessAccess

    deleteLeadTemplate(id: ID!): Boolean
      @requireScope(scope: "lead:delete") @requireBusinessAccess

    createLead(LeadCreateInput: LeadCreateInput!): Lead
      @requireScope(scope: "lead:create") @requireBusinessAccess

    bulkCreateLeads(dataList: [LeadCreateInput!]!): BulkCreateResult
  @requireScope(scope: "lead:import") @requireBusinessAccess

    updateLead(id: ID!, LeadCreateInput: LeadCreateInput!): Lead
      @requireScope(scope: "lead:update") @requireBusinessAccess

    deleteLead(id: ID!): Boolean
      @requireScope(scope: "lead:delete") @requireBusinessAccess
    contactLead(id: ID!, action: ContactLeadAction, channelId: ID!, message: contactLeadMessageInput, file:Upload, caption:String,conversationId: ID): JSON
      @requireScope(scope: "message:send") @requireBusinessAccess
  }
`;