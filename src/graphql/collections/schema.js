export const collectionTypeDefs = `#graphql
"""Supported content source types"""
enum contentSourceEnum {
  """Website URL content source"""
  website
  """YouTube video content source"""  
  youtube
  """File upload content source"""
  file
}

"""Status of content processing"""
enum contentStatusEnum {
  """Content successfully processed and active"""
  active
  """Content currently being processed"""
  loading
  """Content processing failed"""
  failed
}

"""Represents a piece of content in a collection"""
type Content {
  """Source type of the content"""
  source: contentSourceEnum
  """Additional metadata about the content"""
  metaData: JSON
  """Current processing status"""
  status: contentStatusEnum
  """Error message if processing failed"""
  error: String
}

"""Represents a collection of related content"""
type Collection {
  """Unique identifier"""
  _id: ID!
  """Display name of the collection"""
  name: String
  """Description of the collection's purpose/contents"""
  description: String
  """Topic tags for categorizing the collection"""
  topics: [String]
  """Source of the collection"""
  source: contentSourceEnum
  """Status of the collection"""
  status: contentStatusEnum
  """Error message if processing failed"""
  error: String
  """Metadata about the collection"""
  metaData: JSON
  """Business that owns this collection"""
  business: Business
  """User who created the collection"""
  createdBy: User
  """Whether the collection is publicly accessible"""
  isPublic: Boolean
  """Whether the collection is highlighted/promoted"""
  isFeatured: Boolean
  """Creation timestamp"""
  createdAt: DateTime
  """Last update timestamp"""
  updatedAt: DateTime
}
 enum contentSourceEnum{
  """Website URL content source"""
  website
  """YouTube video content source"""  
  youtube
  """File upload content source"""
  file
  """Text content source"""
  text
}
enum chunkingStrategyEnum{
  """Recursive structural chunking"""
  recursiveStructural
  """Recursive semantic chunking"""
  recursiveSemantic
}
    input chunkingDetailsInput {
        strategy: chunkingStrategyEnum
        tunables: JSON
    }
 enum parserTierEnum{
    """Fast parser tier"""
      fast
      """Cost-effective parser tier"""
      cost_effective
      """Agentic parser tier"""
      agentic
      """Agentic+ parser tier"""
      agentic_plus
      }
enum parserExpandEnum{
    """Text content"""
    text
    """Items content"""
    items
    """Markdown content"""
    markdown
    """Metadata content"""
    metadata
    """Images content metadata"""
    images_content_metadata
    """XLSX content metadata"""
    xlsx_content_metadata
    """Output PDF content metadata"""
    output_pdf_content_metadata
    }
enum parserVersionEnum{
      """Latest version"""
      latest
    }
    input parserDetailsInput {
        tier: parserTierEnum
        expand: [parserExpandEnum]
        version: parserVersionEnum
        source_url: String
        advancedOptions: JSON
        jobId: String
        lastUpdate: JSON
    }

input webcrawlerInput {
  options: JSON
  jobId: String
  lastUpdate: JSON
  urls: [String]
}

"""Input type for creating collections"""
input CollectionInput {
  """Display name (required)"""
  name: String!
  """Description of the collection"""
  description: String
  """Initial content items"""
  source: contentSourceEnum!
  """Chunking details"""
  chunkingDetails: chunkingDetailsInput
  webcrawler: webcrawlerInput
  """Parser details"""
  parserDetails: parserDetailsInput
  """Whether collection should be public"""
  isPublic: Boolean
  """Whether collection should be featured"""
  isFeatured: Boolean
}

"""Available actions for updating collections"""
enum updateCollectionActionEnum {
  """Change collection name"""
  rename
  """Update collection description"""
  redescribe
  """Add new content items"""
  addContents
  """Remove existing content items"""
  removeContents
}

type CollectionPagination {
  data: [Collection]
  metaData: PaginationMetaData
}
type Query {
  """Get all collections for the user's business
  @param id - Optional ID to fetch specific collection
  @param limit - Maximum number of collections to return
  @param isPublic - Filter by public/private status"""
  collections(id:ID limit: Int page: Int isPublic: Boolean): CollectionPagination @requireScope(scope: "collection:read") @requireBusinessAccess
  """Get a list of uploaded files
  @param StartAfter - The key to start after
  @param ContinuationToken - The continuation token
  @param includeSize - Whether to include the size of the uploaded files"""
  getListOfUploadedFiles(StartAfter: String ContinuationToken: String includeSize: Boolean): JSON @requireScope(scope: "collection:read") @requireBusinessAccess
}

type Mutation {
  """Create a new collection
  @param collection - Collection data to create"""
  createCollection(collection: CollectionInput!): Collection @requireScope(scope: "collection:create") @requireBusinessAccess
  """Get an upload URL
  @param key - The key to upload the file to"""
  getUploadUrl(key: String!): String @requireScope(scope: "collection:upload_files") @requireBusinessAccess
  """Get a download URL
  @param key - The key to download the file from
  @param neverExpire - When true, the signed URL lasts 7 days, the longest R2 allows. Otherwise it lasts 10 minutes."""
  getDownloadUrl(key: String!, neverExpire: Boolean): String @requireScope(scope: "file:download") @requireBusinessAccess
  """Delete an uploaded file from storage
  @param key - The key of the file to delete"""
  deleteUploadedFileFromStorage(key: String!): Boolean @requireScope(scope: "file:delete") @requireBusinessAccess
  """Update a collection
  @param id - ID of collection to update
  @param name - New name of the collection
  @param description - New description of the collection"""
  updateCollection(id: ID! name: String description: String): Collection @requireScope(scope: "collection:update") @requireBusinessAccess
  """Delete a collection
  @param id - ID of collection to delete"""
  deleteCollection(id: ID!): Boolean @requireScope(scope: "collection:delete") @requireBusinessAccess
}
`; 