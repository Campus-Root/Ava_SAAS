import { model, Schema } from 'mongoose';
import Trigger from './Triggers.js';
import { sendKafkaMessage } from '../utils/kafka.js';
import { Message, MessageSession } from './Messages.js';
// const ConversationStatusEnum = ["initiated", "active", "interrupted", "inactive", "disconnected"];
const ConversationSchema = new Schema({
    agent: { type: Schema.Types.ObjectId, ref: 'Agent' },  // the AI agent
    business: { type: Schema.Types.ObjectId, ref: 'Businesses' },
    channel: { type: Schema.Types.ObjectId, ref: "Channel" },
    lead: { type: Schema.Types.ObjectId, ref: "Lead" }, // from sender of the inbound message / call or recipient of the outbound message / call
    campaign: { type: Schema.Types.ObjectId, ref: "Campaign" }, // participant of the campaign(bulk messaging)
    // Deterministic provider thread key used to find-or-create on every inbound
    // event. e.g. WhatsApp: contact wa_id · Telegram: chat.id · Messenger: PSID.
    externalConversationId: { type: String },
    // config is the setting that are applied to the conversation,
    config: {
        // Human/agent routing — promoted to top level so the agent-inbox index can use it.
        assignment: {
            agentReply: { type: Boolean, default: true },
            handoffReason: String,
            handoffUrgency: String,
            // team: { type: Schema.Types.ObjectId, ref: "Team" },
            assignedAt: Date,
            assignedTo: String // for support/agent routing in case of support ping to business notifications else give it to agent,
        },
        tags: [String],
        // more settings to be added here
    },
    status: { type: String, enum: ["open", "pending", "snoozed", "completed", "closed", "archived", "spam"], default: "open" },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    metadata: {
        openai: { "lastResponseId": String, "lastResponseAt": Date },
        extractedData: Schema.Types.Mixed,
        userLocation: Schema.Types.Mixed,
        CreditsUsage: {
            conversationCredits: { type: Number, default: 0 },
            analysisCredits: { type: Number, default: 0 },
            // knowledgeCredits:Number,
            miscellaneousCredits: { type: Number, default: 0 },
            totalCredits: { type: Number, default: 0 },
        }
    }
}, {
    timestamps: true
});
ConversationSchema.methods.updateStatus = async function (status) {
    this.status = status;
    if (status === "completed") {
        console.log("Sending agentic-data-summarisation message");
        const lastMessage = await Message.findOne({ conversation: this._id }).sort({ createdAt: -1 });
        // const messageSession = await MessageSession.updateOne({ conversation: this._id, business: this.business._id, lastMessage: { $exists: false } }, { $set: { lastMessage: lastMessage._id } }, { upsert: true });
        await sendKafkaMessage({
            topic: 'agentic-data-summarisation',
            message: {
                key: 'conversationStatusUpdated',
                value: JSON.stringify({ conversationId: this._id.toString() })
            },
            acks: -1
        });
        console.log("Agentic-data-summarisation message sent");
    }
    console.log("Executing triggers");
    let trigger = await Trigger.findOne({ business: this.business._id, name: "conversationStatusUpdated", type: status });
    let workflowToBeExecuted = trigger?.workflows ?? []
    for (const workflow of workflowToBeExecuted) {
        console.log("Sending workflow-execution-trigger message");
        await sendKafkaMessage({
            topic: 'workflow-execution-trigger',
            message: {
                key: workflow.toString(),
                value: JSON.stringify({ conversationId: this._id.toString() })
            },
            acks: -1
        });
        console.log("Workflow-execution-trigger message sent");
    }
    console.log("Triggers executed");
    return this.save();
}
export const Conversation = model('Conversation', ConversationSchema, "Conversations");
/*
1. Open
 
Meaning:
The conversation requires attention and is currently active.
 
Typical triggers to become Open:
 
New user message arrives.
User replies to a previously closed conversation.
AI agent escalates to a human.
Human agent reopens a conversation.
 
Typical triggers to leave Open:
 
Agent is waiting for customer response → Pending
Follow-up scheduled for later → Snoozed
Issue resolved → Closed
Marked as junk → Spam
Example
 
Customer:
 
My order hasn't arrived.
 
Conversation → Open
 
2. Pending
 
Meaning:
The business is waiting for the customer (or sometimes a third party) to respond.
 
Typical triggers to become Pending:
 
Agent asks a question.
Agent requests documents, screenshots, OTP, account details, etc.
Agent provides a solution and waits for confirmation.
 
Typical triggers to leave Pending:
 
Customer replies → Open
No response and issue considered resolved → Closed
Follow-up scheduled → Snoozed
Example
 
Agent:
 
Could you share your order ID?
 
Conversation → Pending
 
Customer replies with order ID.
 
Conversation → Open
 
3. Snoozed
 
Meaning:
The conversation is temporarily hidden until a future time.
 
Typical triggers to become Snoozed:
 
Customer says:
 
Contact me next week.
 
Agent needs to follow up after delivery.
Waiting for an external event.
 
Typical triggers to leave Snoozed:
 
Snooze timer expires → Open
Customer sends a new message before snooze ends → Open
Example
 
Customer:
 
I'll be available on Monday.
 
Agent snoozes until Monday.
 
Conversation → Snoozed
 
Monday arrives.
 
Conversation → Open
 
4. Closed
 
Meaning:
The issue is considered resolved and no action is required.
 
Typical triggers to become Closed:
 
Agent marks resolved.
Customer confirms resolution.
Auto-close after inactivity.
 
Typical triggers to leave Closed:
 
Customer sends a new message.
 
Most systems automatically:
 
Closed + New Customer Message
           ↓
         Open
Example
 
Customer:
 
Thanks, the problem is fixed.
 
Conversation → Closed
 
5. Archived
 
Meaning:
The conversation is stored for historical purposes and removed from normal operational views.
 
Unlike Closed, archive is more of a storage/organization state.
 
Typical triggers to become Archived:
 
Closed conversation older than X days.
Manual archive by manager.
Data-retention workflow.
 
Typical triggers to leave Archived:
 
Agent restores it.
Customer sends a new message (depends on product).
Example
 
A ticket closed 90 days ago.
 
Conversation → Archived
 
6. Spam
 
Meaning:
The conversation is unwanted, abusive, promotional, or irrelevant.
 
Typical triggers to become Spam:
 
Agent manually marks spam.
Automatic spam detection.
Repeated marketing messages.
 
Typical triggers to leave Spam:
 
Agent reviews and restores it.
Example
 
Message:
 
Earn $5000/day click this link!
 
Conversation → Spam
*/
