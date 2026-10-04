export const campaignTypeDefs = `#graphql
type CampaignTimeLines {
    scheduledAt: DateTime
    startedAt: DateTime
    completedAt: DateTime
    cancelledAt: DateTime
    lastTaskStartedAt: DateTime
}
type Campaign {
    _id: ID!
    name: String!
    channel: Channel
    leads: [Lead]
    config: JSON
    status: String
    timeLines: CampaignTimeLines
    cancel_requested: Boolean
    createdBy: User
    createdAt: DateTime
    updatedAt: DateTime
}
    type TypeReference {
        type: String
        id: ID
    }
    type Task {
        _id: ID!
        business: Business
        campaign: Campaign
        lead: Lead
        status: String
        timeLine: JSON
        createdAt: DateTime
        type: String
        data: JSON
        error: JSON
        updatedAt: DateTime
        response: JSON
        references: TypeReference
    }
    type CampaignPagination {
        data: [Campaign]
        metaData: JSON
    }
    type TaskPagination {
        data: [Task]
        metaData: JSON
    }
    type CampaignFacets {
        status: [FacetOption]
        channel: [FacetOption]
        cancel_requested: [FacetOption]
    }
      type  Query {
            fetchCampaigns(id: ID, name: String, channelIds: [ID], leadIds: [ID], status: String, limit: Int, page: Int sort: JSON): CampaignPagination
            """ Distinct filter values + counts for the campaigns list UI """
            fetchCampaignFacets: CampaignFacets
            fetchTasks(campaignId: ID, status: String, limit: Int, page: Int sort: JSON): TaskPagination
            validateCampaign(channelId: ID, leadIds: [ID], config: JSON): Boolean
        }
       type Mutation {
            createCampaign(name: String, channelId: ID, leadIds: [ID], config: JSON, scheduledAt: DateTime): Campaign
            cancelCampaign(id: ID): Campaign
        }
`