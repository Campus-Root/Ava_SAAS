export const channelTypeDefs = `#graphql
"""Base Interface for all communication channels"""
type Channel {
  """Unique identifier for the channel"""
  _id: ID!
  """Display name of the channel"""
  name: String!
    """Runtime of the channel"""
    runtime: ChannelRuntimeEnum
  """ID of the business that owns this channel"""
    business: Business
  provider: Provider
  apiAuthenticator: ApiAuthenticator
  """Current status of the channel (active, inactive, etc)"""
  status: String
  """URL for receiving webhook notifications"""
  webhookUrl: String
  """Base prompt that defines how the agent behaves on this channel"""
  systemPrompt: String
  """Whether the channel is publicly accessible"""
  isPublic: Boolean
  """Custom UI configuration elements"""
  UIElements: JSON
  """Creation timestamp"""
  createdAt: DateTime
  """Last update timestamp"""
  updatedAt: DateTime
   """Channel-specific configuration settings"""
   config: JSON,
   type: ChannelTypeEnum
}
enum ChannelTypeEnum {
  whatsapp
  telegram
  website
  phone
  instagram
  sms
  email
}


type ChannelPagination {
  data: [Channel]
  metaData: PaginationMetaData
}

type Query {
  """Get channels matching the specified filters
  @param _id - Optional channel ID to fetch a specific channel
  @parm provider - Filter by provider ID
  @parm apiAuthenticator - Filter by api authenticator ID
  @param status - Filter by channel status
  @param type - Filter by channel type"""
  getChannels(_id: ID, provider: ID, apiAuthenticator: ID, status: String, type: ChannelTypeEnum, page: Int, limit: Int): ChannelPagination @requireScope(scope: "channel:read") @requireBusinessAccess

  """List the setting methods for a channel
  @param id - ID of the channel"""
  channelSettingMethods(id: ID!): JSON @requireScope(scope: "channel:read") @requireBusinessAccess
}
enum ChannelRuntimeEnum {
  TURN_BASED
  REALTIME
}
"""Input type for creating/updating channels"""
input ChannelInput {
  """Display name of the channel"""
  name: String
  """Runtime of the channel"""
  runtime: ChannelRuntimeEnum
  """ID of the api authenticator that this channel is associated with"""
  apiAuthenticator: ID
  """Base prompt that defines how the agent behaves"""
  systemPrompt: String
  """Whether the channel is publicly accessible"""
  isPublic: Boolean
  """Custom UI configuration elements"""
  UIElements: JSON
  """Channel-specific configuration settings"""
  config: JSON
  """Channel type"""
  type: ChannelTypeEnum
}

type Mutation {
  """Create a new communication channel
  @param input - Channel configuration data"""
  createChannel(input: ChannelInput!): Channel @requireScope(scope: "channel:create") @requireBusinessAccess

  """Update an existing channel
  @param id - ID of channel to update
  @param input - New channel configuration"""
  updateChannel(id: ID!, input: ChannelInput!): Channel @requireScope(scope: "channel:update") @requireBusinessAccess

  """Delete a channel
  @param id - ID of channel to delete"""
  deleteChannel(id: ID!): Boolean @requireScope(scope: "channel:delete") @requireBusinessAccess
  

  """Execute a channel setting method
  @param id - ID of the channel
  @param method - Name of the method to execute
  @param parameters - Parameters for the method"""
  channelSetting(id: ID!, method: String!, parameters: JSON!): JSON @requireScope(scope: "channel:read") @requireBusinessAccess
}
`; 