export const knowledgeTypeDefs = `#graphql

type Query {
  """Get a list of uploaded files
  @param StartAfter - The key to start after
  @param ContinuationToken - The continuation token
  @param includeSize - Whether to include the size of the uploaded files"""
  getListOfUploadedFiles(StartAfter: String ContinuationToken: String includeSize: Boolean): JSON @requireScope(scope: "file:read") @requireBusinessAccess
}

type Mutation {
  """Get an upload URL
  @param key - The key to upload the file to"""
  getUploadUrl(key: String!): String @requireScope(scope: "file:upload") @requireBusinessAccess
  """Get a download URL
  @param key - The key to download the file from
  @param neverExpire - When true, the signed URL lasts 7 days, the longest R2 allows. Otherwise it lasts 10 minutes."""
  getDownloadUrl(key: String!, neverExpire: Boolean): String @requireScope(scope: "file:download") @requireBusinessAccess
  """Delete an uploaded file from storage
  @param key - The key of the file to delete"""
  deleteUploadedFileFromStorage(key: String!): Boolean @requireScope(scope: "file:delete") @requireBusinessAccess
}
`; 