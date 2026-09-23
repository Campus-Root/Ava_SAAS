export const userTypeDefs = `#graphql
  """User role enum defining permission levels"""
  enum UserRole {
    superAdmin
    admin
    manager
  }

  """Allowed roles when creating new users"""
  enum UserCreatingRole {
    admin
    manager
  }

  """Input type for business registration"""
  input BusinessRegistrationInput {
    name: String!
    email: String!
    password: String!
    BusinessName: String!
    logoURL: String
  }
  """Input type for creating new users"""
  input UserInput {
    """User's full name"""
    name: String!
    """User's email address"""
    email: String!
    """User's password"""
    password: String!
    """Role to assign to new user"""
    role: UserCreatingRole!
    """Permission scopes to grant"""
    scopes: [String]
  }

  """Input type for updating existing users"""
  input UserUpdateInput {
    """Updated full name"""
    name: String
    """Updated email address"""
    email: String
    """Updated role"""
    role: UserRole
    """Updated permission scopes"""
    scopes: [String]
  }

  """Input type for user login"""
  input LoginInput {
    """User's email address"""
    email: String!
    """User's password"""
    password: String!
  }

  """Response type for login"""
  type LoginResponse {
    """Access token for authentication"""
    accessToken: String!
    """User's role"""
    role: String!
    """User's permission scopes"""
    scopes: [String]!
    """User information"""
    user: User
    """Access token lifetime in seconds"""
    expiresIn: Int
  }

  enum OauthGrantMode {
    access_refresh
    access_only
    permanent
  }

  type OauthClient {
    clientId: String!
    name: String
    redirectUris: [String!]!
    allowedOrigins: [String!]!
    grantMode: OauthGrantMode!
    secretVersion: Int!
    revokedAt: DateTime
    createdAt: DateTime
    isFirstParty: Boolean
  }

  type OauthClientSecretPayload {
    client: OauthClient!
    clientSecret: String!
  }

  input CreateOauthClientInput {
    name: String!
    redirectUris: [String!]!
    allowedOrigins: [String!]
    grantMode: OauthGrantMode!
  }

  input UpdateOauthClientInput {
    name: String
    redirectUris: [String!]
    allowedOrigins: [String!]
    grantMode: OauthGrantMode
  }

  # input ScopeUpdateInput {
  #   scopes: [String]!
  #   operation: ScopeOperation!
  # }

  # enum ScopeOperation {
  #   add
  #   remove
  #   replace
  # }

  # input BulkUserUpdateInput {
  #   userId: ID!
  #   scopes: [String]!
  #   operation: ScopeOperation!
  # }

  type Query {
    """Get current user profile"""
    me: User @requireScope(scope: "user:read")

    """Get all users (admin only)"""
    users( id: ID limit: Int role: UserRole isVerified: Boolean): [User] @requireScope(scope: "admin:users") @requireBusinessAccess

    """The OAuth app for this user, or a business-shared app if they have not created one"""
    oauthClient: OauthClient


    # # Get users by business
    # businessUsers(
    #   businessId: ID
    #   role: UserRole
    #   limit: Int
    # ): [User] @requireScope(scope: "admin:users") @requireBusinessAccess

    # # Get managers for a business
    # managers(
    #   businessId: ID
    #   limit: Int
    # ): [User] @requireScope(scope: "admin:users") @requireBusinessAccess

    # # Get all available scopes
    # availableScopes: [ScopeInfo] @requireScope(scope: "admin:users")

    # # Get scopes by category
    # scopesByCategory: JSON @requireScope(scope: "admin:users")

    # # Get default scopes for a role
    # defaultScopesForRole(role: UserRole!): [ScopeInfo] @requireScope(scope: "admin:users")

    # # Validate scopes
    # validateScopes(scopes: [String]!): ScopeValidation @requireScope(scope: "admin:users")
  }

  type Mutation {
    """Create a new user (admin only)"""
    createUser(user: UserInput!): User @requireScope(scope: "admin:users") @requireBusinessAccess

    """Update an existing user"""
    updateUser(id: ID!, user: UserUpdateInput!): User @requireScope(scope: "admin:users") @requireResourceOwnership(model: "User", idField: "id",creatorIndependent:true)

    """Delete a user"""
    deleteUser(id: ID!): Boolean @requireScope(scope: "admin:users") @requireResourceOwnership(model: "User", idField: "id",creatorIndependent:true)

    """Generate a new access token for a user"""
    generateUserAccessToken(expiresIn: String): String

    """Login with email and password"""
    login(input: LoginInput!): LoginResponse

    """Register"""
    register(input: BusinessRegistrationInput!): JSON

    """Clear the refresh cookie and revoke refresh tokens."""
    logout: Boolean

    """Create this user's single OAuth client. Returns the client secret once."""
    createOauthClient(input: CreateOauthClientInput!): OauthClientSecretPayload

    """Update redirect URIs, origins, name, or grant mode. Does not change the secret."""
    updateOauthClient(input: UpdateOauthClientInput!): OauthClient

    """Replace the only valid client secret and revoke refresh tokens."""
    rotateOauthClientSecret: OauthClientSecretPayload

    """Disable this user's OAuth client."""
    revokeOauthClient: Boolean

    """Send a one-time reset link if the email belongs to a verified user."""
    requestPasswordReset(email: String!): JSON

    """Alias of requestPasswordReset"""
    forgotPassword(email: String!): JSON

    """Consume the reset link and set a new password."""
    resetPassword(token: String!, email: String!, password: String!): JSON


  #   # Verify user email
  #   verifyUser(userId: ID!): User @requireScope(scope: "admin:users") @requireResourceOwnership(model: "User", idField: "userId")

  #   # Deactivate user
  #   deactivateUser(userId: ID!): User @requireScope(scope: "admin:users") @requireResourceOwnership(model: "User", idField: "userId")

  #   # Reactivate user
  #   reactivateUser(userId: ID!): User @requireScope(scope: "admin:users") @requireResourceOwnership(model: "User", idField: "userId")

  #   # Reset user password (admin only)
  #   resetUserPassword(userId: ID!): Boolean @requireScope(scope: "admin:users") @requireResourceOwnership(model: "User", idField: "userId")

  #   # Send password reset email
  #   sendPasswordResetEmail(email: String!): Boolean @requireScope(scope: "admin:users")
  """Talk to AI"""
  talkToAi(systemInstructions: String!, userQuery: String!, model: String = "gpt-4o-mini", zodFormat: JSON): JSON
  }
`; 