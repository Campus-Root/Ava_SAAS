export const agentTypeDefs = `#graphql
  """ Defines the color scheme for different UI elements """
  type ColorBox {
    """ Background color in hex/rgb format """
    backgroundColor: String
    """ Text color in hex/rgb format """
    textColor: String
  }


  type AgentPrompt {
    role: String,
    objective: String,
    instructionsAndWorkflow: String,
    constraintsAndRules: String
  }

  """ Core information and settings that define the agent's behavior """
  type PersonalInfo {
    """ Display name of the agent """
    name: String
    """ Description of the agent """
    description: String
    """ Avatar of the agent """
    avatar: String
    """ Base prompt that defines the agent's role and behavior """
    systemPrompt: AgentPrompt
  }

  enum AgentRuntimeEnum {
    TURN_BASED
    REALTIME
    BACKGROUND
  }
  type ModelConfig {
    provider: String
    customProviderRef: String,
    providerData: JSON,
    model: String,
    modelSettings: JSON
  }

  """ Main agent type containing all agent properties """
  type Agent {
    """ Unique identifier """
    _id: ID!
    """ Core agent configuration """
    personalInfo: PersonalInfo
    runtime: AgentRuntimeEnum
    modelConfig: ModelConfig
    responseConfig: JSON
    """ Associated knowledge collections """
    collections: [Collection]
    """ Associated workflow """
    workflow: Workflow
    """ Communication channels the agent is active on """
    channels: [Channel]
    """ Available actions/functions the agent can perform """
    actions: [Action]
    """ Business that owns this agent """
    business: Business
    """ User who created the agent """
    createdBy: User
    """ Whether the agent is publicly accessible """
    isPublic: Boolean
    """ Whether the agent is highlighted/promoted """
    isFeatured: Boolean
    """ Creation timestamp """
    createdAt: DateTime
    """ Last update timestamp """
    updatedAt: DateTime
  }

  """ Input type for color scheme configuration """
  input ColorBoxInput {
    backgroundColor: String
    textColor: String
  }


  input AgentPromptInput {
    role: String,
    objective: String,
    instructionsAndWorkflow: String,
    constraintsAndRules: String
  }
  """ Input type for core agent settings """
  input AgentPersonalInfoInput {
    name: String
    description: String,
    avatar: String,
    systemPrompt: AgentPromptInput
    model: String
    temperature: Float
    VoiceAgentSessionConfig:JSON
  }

  """ Input type for creating/updating agents """
  input AgentInput {
    personalInfo: AgentPersonalInfoInput
    runtime: AgentRuntimeEnum
    modelConfig: JSON
    responseConfig: JSON
    collections: [ID]
    workflow: ID
    channels: [ID]
    actions: [ID]
    isPublic: Boolean
    isFeatured: Boolean
  }
enum AgentProviderEnum {
  openai
  gemini
}
type AgentPagination {
    data: [Agent]
    metaData: PaginationMetaData
}

type Demonstration {
  _id: ID
  lead: JSON
  organization: JSON
  transcripts: JSON
  miscellaneous: JSON
  kind: String
  demoEndedAt: DateTime
}
  input DemonstrationInput {
leadName: String
leadEmail: String
leadPhone: String
leadDepartment: String
leadSource: String
organizationId: String
organizationName: String
organizationIndustry: String
kind: String
  }


  type Query {
    """ Get all agents for the user's business
        @param limit - Maximum number of agents to return
        @param isPublic - Filter by public/private status
        @param isFeatured - Filter by featured status
        @param id - Optional ID to fetch a specific agent """
    agents(limit: Int page: Int isPublic: Boolean isFeatured: Boolean id: ID): AgentPagination @requireScope(scope: "agent:read") @requireBusinessAccess
    """ Get an ephemeral token for an agent
        @param id - ID of agent to get the token for """
    ephemeralToken(id: ID,model: String, voice: String, provider: AgentProviderEnum): JSON
  }

  type Mutation {
    """ Create a new agent
        @param agent - Agent configuration data """
    createAgent(agent: AgentInput!): Agent @requireScope(scope: "agent:create") @requireBusinessAccess

    """ Update an existing agent
        @param id - ID of agent to update
        @param agent - New agent configuration """
    updateAgent(id: ID!, agent: AgentInput!): Agent @requireScope(scope: "agent:update") @requireBusinessAccess

    """ Delete an agent
        @param id - ID of agent to delete """
    deleteAgent(id: ID!): Boolean @requireScope(scope: "agent:delete") @requireBusinessAccess

    """ Test prompt generation for an agent
        @param prompt - Test prompt to generate from """
    generatePrompt(prompt: String!): String @requireScope(scope: "agent:manage_prompts") @requireBusinessAccess
    startDemo(input: DemonstrationInput!): Demonstration @requireScope(scope: "agent:test") @requireBusinessAccess
    endDemo(_id: ID!, transcripts: JSON, miscellaneous: JSON): Demonstration @requireScope(scope: "agent:test") @requireBusinessAccess
  }
`; 