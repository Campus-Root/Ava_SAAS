export const serviceProvidersTypeDefs = `#graphql
type Provider {
    _id: ID!
    name: String
    description: String
    basicScopes: [String]
    icon: String
    color: String
    apiFilters: JSON
}
type ProviderPagination {
    data: [Provider]
    metaData: PaginationMetaData
}

enum apiAuthEnum {
    oauth2
    apiKey
    basic
    bearer
    jwt
    hmac
    customHeader
    mtls
    cookie
    none
}
type apiUrlTemplate {
        base: String
        path: String
        params: JSON
    }
type apiRequestTemplate {
  method: String
  url: apiUrlTemplate
  headers: JSON
  body: JSON
}
type ApiSchema {
    input: JSON
    config: JSON
    output: JSON
    error: JSON
    auth: apiAuthEnum
}

type Api {
    _id: ID!
    provider: Provider
    title: String
    description: String
    version: String
    schemas: ApiSchema
    requestTemplate: apiRequestTemplate
    requiredScopes: [String]
    metadata: JSON
}
type ApiPagination {
    data: [Api]
    metaData: PaginationMetaData
}
type ApiAuthenticatorPagination {
    data: [ApiAuthenticator]
    metaData: PaginationMetaData
}
type ApiAuthenticator {
  _id: ID!
  provider: Provider
  accountDetails: JSON
  scope: [String]
  isActive: Boolean
  createdBy: User
  business: Business
  authType: apiAuthEnum!
#   credentials: JSON
#   config: JSON
}
type AuthStrategy {
    authType: apiAuthEnum!
    authUrl: String
    scopes: [String]
    providerId: ID
    misc: JSON
}
type Query {
    fetchProviders(name: String, description: String, _id: ID, page: Int, limit: Int): ProviderPagination @requireScope(scope: "integration:read")
    fetchApis(providers: [ID], providerName: String, title: String, description: String, version: String, _id: ID, page: Int, limit: Int, category: String, feature: String): ApiPagination @requireScope(scope: "integration:read")
    fetchApiAuthenticators(provider: ID, providerName: String, _id: ID, page: Int, limit: Int): ApiAuthenticatorPagination @requireScope(scope: "integration:read") @requireBusinessAccess
}
type Mutation {
    createProvider(name: String, description: String, icon: String, color: String, basicScopes: [String]): Provider @requireScope(scope: "super:marketplace")
    updateProvider(id: ID!, name: String, description: String, icon: String, color: String): Provider @requireScope(scope: "super:marketplace")
    deleteProvider(id: ID!): Boolean @requireScope(scope: "super:marketplace")
    createApi(providerId: ID!, title: String, description: String, version: String, schemas: JSON, requestTemplate: JSON, requiredScopes: [String], metadata: JSON): Api @requireScope(scope: "super:marketplace")
    updateApi(id: ID!, title: String, description: String, version: String, schemas: JSON, requestTemplate: JSON, requiredScopes: [String], metadata: JSON): Api @requireScope(scope: "super:marketplace")
    deleteApi(id: ID!): Boolean @requireScope(scope: "super:marketplace")
    createAuthStrategy(apiId: ID!, state: String):AuthStrategy @requireScope(scope: "integration:create") @requireBusinessAccess
    createApiAuthenticator(providerId: ID!, authType: apiAuthEnum!, existingAuthenticatorId: ID, keys: JSON): ApiAuthenticator @requireScope(scope: "integration:create") @requireBusinessAccess
    testApi(apiId: ID!, authId: ID!, input: JSON, config: JSON): JSON @requireScope(scope: "integration:create") @requireBusinessAccess
}

`;