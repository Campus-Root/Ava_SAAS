
// ─── Type Definitions ─────────────────────────────────────────────────────────

export const messageTypeDefs = `#graphql

  """Type of message content"""
  enum MessageTypeEnum {
    text
    image
    audio
    voice
    video
    document
    file
    sticker
    location
    contacts
    interactive
    button
    order
    unknown
    template
  }

  """Nature of the message event"""
  enum MessageKindEnum {
    message
    postback
    system
  }

  """Delivery status timeline for a message"""
  type MessageStatusTimeline {
    initiated: DateTime
    sent: DateTime
    delivered: DateTime
    read: DateTime
    failed: DateTime
  }

  """Sender identity on a message"""
  type MessageSender {
    type: String
    id: String
    name: String
    ref: JSON
    refModel: String
  }

  """A single emoji reaction on a message"""
  type MessageReaction {
    emoji: String
    by: String
    at: DateTime
  }

  """A message in a conversation"""
  type Message {
    _id: ID!
    """Conversation this message belongs to"""
    conversation: Conversation
    business: Business
    """Provider-side message ID"""
    externalMessageId: String
    """inbound | outbound"""
    direction: String
    """Who sent this message"""
    sender: MessageSender
    """Content type"""
    type: MessageTypeEnum
    """Event kind"""
    kind: MessageKindEnum
    """Raw message content (body, location, interactive payload, etc.)"""
    content: JSON
    """Message this is a reply to"""
    repliedTo: ID
    """Emoji reactions on this message"""
    reactions: [MessageReaction]
    """Delivery status timestamps"""
    statusTimeline: MessageStatusTimeline
    """Miscellaneous provider data"""
    misc: JSON
    """Delivery/processing errors"""
    errors: [JSON]
    """Whether this is an internal agent note (not sent to lead)"""
    isInternalNote: Boolean
    """Whether this message has been included in a summary"""
    isSummarized: Boolean
    createdAt: DateTime
    updatedAt: DateTime
  }

  type MessagePagination {
    data: [Message]
    metaData: PaginationMetaData
  }

  # ─── Call Sessions ───────────────────────────────────────────────────────────


  """Recording state for a call session"""
  enum RecordingStatusEnum {
    none
    pending
    stored
    failed
  }

  """A single transcript segment from a call"""
  type Transcript {
    speaker: String
    transcript: String
    """Millisecond offset from call start"""
    startMs: Int
    endMs: Int
    """Recognition confidence score"""
    confidence: Float
    """Transcription provider (whisper, deepgram, etc.)"""
    source: String
    usage: JSON
  }

  """Recording details for a call session"""
  type CallRecording {
    status: RecordingStatusEnum
    key: String
    url: String
  }

  """Status timestamps for a call session"""
  type CallStatusTimeline {
    scheduledAt: DateTime
    initiatedAt: DateTime
    ringingAt: DateTime
    in_progressAt: DateTime
    completedAt: DateTime
    failedAt: DateTime
    busyAt: DateTime
    no_answerAt: DateTime
    canceledAt: DateTime
    durationSec: Int
  }

  """A phone/voice call session linked to a conversation"""
  type CallSession {
    _id: ID!
    lead: Lead
    conversation: Conversation
    campaign: Campaign
    business: Business
    channel: Channel
    agent: Agent
    externalCallSessionId: String
    direction: String
    statusTimeline: CallStatusTimeline
    recording: CallRecording
    transcripts: [Transcript]
    callDetails: JSON
    isSummarized: Boolean
    sequenceOfEvents: [JSON]
    createdAt: DateTime
    updatedAt: DateTime
  }

  type CallSessionPagination {
    data: [CallSession]
    metaData: PaginationMetaData
  }

  # ─── Queries ─────────────────────────────────────────────────────────────────

  type Query {
    """
    Fetch paginated messages for a conversation.
    @param conversationId - Filter by conversation (required for scoped fetch)
    @param limit          - Results per page (default: 20)
    @param page           - Page number (default: 1)
    """
    fetchMessages(
      conversationId: ID
      limit: Int
      page: Int
    ): MessagePagination @requireScope(scope: "message:read") @requireBusinessAccess

    """
    Fetch paginated call sessions for a conversation.
    @param conversationId - Filter by conversation
    @param status         - Filter by call status
    @param limit          - Results per page (default: 20)
    @param page           - Page number (default: 1)
    """
    fetchCallSessions(
      conversationId: ID
      ids: [ID]
      direction: [String]
      externalCallSessionId: String
      limit: Int
      page: Int
    ): CallSessionPagination @requireScope(scope: "call:read") @requireBusinessAccess
  }
`;