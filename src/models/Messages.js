import { model, Schema } from 'mongoose';
const MessageSessionSchema = new Schema({
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    firstMessage: { type: Schema.Types.ObjectId, ref: 'Message' },
    lastMessage: { type: Schema.Types.ObjectId, ref: 'Message' },
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation' },
    business: { type: Schema.Types.ObjectId, ref: 'Businesses' },
})
const MessagesSchema = new Schema({
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation' },
    campaign: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    business: { type: Schema.Types.ObjectId, ref: 'Businesses' },
    externalMessageId: String,
    direction: String,
    sender: {
        type: { type: String, enum: ["Lead", "agent", "user", "system", "unknown"], default: "Lead" },
        id: String,
        name: String,
        ref: { type: Schema.Types.ObjectId, refPath: "sender.refModel" },
        refModel: { type: String, enum: ["Lead", "Agent", "Users"] },
    },
    type: {
        type: String,
        enum: ["text", "image", "audio", "voice", "video", "document", "file", "sticker",
            "location", "contacts", "interactive", "button", "order", "unknown", "template"],
        default: "text",
    },
    kind: { type: String, enum: ["message", "postback", "system"], default: "message" },
    content: { type: Schema.Types.Mixed, default: {} }, // { body } | location | interactive | …
    repliedTo: { type: Schema.Types.ObjectId, ref: "Message" },
    reactions: { type: [{ emoji: String, by: String, at: Date }], default: [], _id: false },
    statusTimeline: {
        scheduled: Date, initiated: Date, sent: Date, delivered: Date, read: Date, failed: Date
    },
    misc: { type: Schema.Types.Mixed, default: {} },
    errors: [{ type: Schema.Types.Mixed, default: [] }],
    isInternalNote: { type: Boolean, default: false },
    isSummarized: { type: Boolean, default: false },
    // readByContact: { type: Boolean, default: We false }
}, {
    timestamps: true
});
export const Message = model('Message', MessagesSchema, "Messages");
export const MessageSession = model('MessageSession', MessageSessionSchema, "MessageSessions");