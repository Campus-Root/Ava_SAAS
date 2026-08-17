import { Schema, model } from 'mongoose';

const Capability = new Schema({
    key: String,
    enabled: { type: Boolean, default: false },
    label: String,
    description: String,
}, { _id: false });

export const ChannelCapabilityDefaults = {
    whatsapp: [
        {
            key: "text",
            enabled: true,
            label: "Text",
            description: "Plain text messages. Supports basic formatting like bold, italic, and emojis.",
        },
        {
            key: "button",
            enabled: true,
            label: "Quick Reply Buttons",
            description: "Up to 3 tappable reply buttons below a message. Best for simple yes/no or multi-choice responses."
        },
        {
            key: "list",
            enabled: false,
            label: "List Menu",
            description: "A scrollable menu with up to 10 rows grouped into sections. Best for support categories, product options, or multi-step flows."
        },
        {
            key: "cta_url",
            enabled: false,
            label: "CTA URL Button",
            description: "A button that opens a URL in the user's browser when tapped."
        },
        {
            key: "voice_call",
            enabled: false,
            label: "Voice Call Button",
            description: "A button that opens the user's phone app to make a voice call when tapped."
        },
        {
            key: "location",
            enabled: false,
            label: "Location Request",
            description: "A button that opens the user's phone app to send their location when tapped."
        },
        {
            key: "image",
            enabled: false,
            label: "Image",
            description: "Send images (JPEG/PNG) with an optional caption. Useful for product visuals, receipts, or guides."
        },
        {
            key: "template",
            enabled: false,
            label: "Template",
            description: "Pre-approved message templates required for first outbound messages or notifications outside the 24-hour window."
        },
        {
            key: "document",
            enabled: false,
            label: "Document",
            description: "Send files such as PDFs, invoices, or manuals. Supports most common document formats."
        },
        {
            key: "video",
            enabled: false,
            label: "Video",
            description: "Send MP4 video files with an optional caption. Useful for tutorials or product demos."
        },
        {
            key: "audio",
            enabled: false,
            label: "Audio",
            description: "Send voice notes or audio clips. Useful for spoken instructions or announcements."
        },
        {
            key: "sticker",
            enabled: false,
            label: "Sticker",
            description: "Send WhatsApp-compatible WebP stickers. Mostly used for casual or expressive interactions."
        },
    ],
    telegram: [
        {
            key: "text",
            enabled: true,
            label: "Text",
            description: "Plain or Markdown-formatted text messages. Supports bold, italic, code blocks, and links."
        },
        {
            key: "interactive_button",
            enabled: true,
            label: "Inline Buttons",
            description: "Inline keyboard buttons attached to a message. Each button carries a callback_data payload sent back on tap."
        },
        {
            key: "image",
            enabled: false,
            label: "Image",
            description: "Send photos with an optional caption. Supports JPEG and PNG formats."
        },
        {
            key: "video",
            enabled: false,
            label: "Video",
            description: "Send MP4 video files with an optional caption."
        },
        {
            key: "audio",
            enabled: false,
            label: "Audio",
            description: "Send audio files or voice messages. Displayed as a playable audio player in chat."
        },
        {
            key: "document",
            enabled: false,
            label: "Document",
            description: "Send any file type as a document. Useful for sharing PDFs, spreadsheets, or archives."
        },
        {
            key: "sticker",
            enabled: false,
            label: "Sticker",
            description: "Send Telegram-compatible WebP or TGS animated stickers."
        },
    ],
    sms: [
        {
            key: "text",
            enabled: true,
            label: "Text",
            description: "Plain text SMS. Maximum 160 characters per segment. No formatting, links, or media supported natively."
        },
    ],
    email: [
        {
            key: "text",
            enabled: true,
            label: "Text / HTML",
            description: "Plain text or HTML-formatted email body. Supports rich layout, headings, and styled content."
        },
        {
            key: "image",
            enabled: false,
            label: "Inline Image",
            description: "Embed images directly in the email body or include them as attachments."
        },
        {
            key: "document",
            enabled: false,
            label: "Attachment",
            description: "Attach files such as PDFs, invoices, or reports to the email."
        },
    ],
    web: [
        {
            key: "text",
            enabled: true,
            label: "Text",
            description: "Plain text chat bubble rendered in the web widget. Supports basic markdown."
        },
        {
            key: "interactive_button",
            enabled: true,
            label: "Quick Reply Buttons",
            description: "Clickable option buttons rendered below a message. Ideal for guided flows and FAQs."
        },
        {
            key: "interactive_list",
            enabled: false,
            label: "List Menu",
            description: "A dropdown or scrollable list of options. Best for longer option sets like categories or topics."
        },
        {
            key: "image",
            enabled: false,
            label: "Image",
            description: "Display images inside the chat widget with an optional caption."
        },
        {
            key: "card",
            enabled: false,
            label: "Card",
            description: "A rich card with a title, subtitle, image, and action buttons. Useful for product listings or recommendations."
        },
    ],
    instagram: [
        {
            key: "text",
            enabled: true,
            label: "Text",
            description: "Plain text DM. Supports emojis but no rich formatting."
        },
        {
            key: "interactive_button",
            enabled: true,
            label: "Quick Reply Buttons",
            description: "Predefined reply chips shown below a message. User taps one to send a reply. Limited to Instagram's supported button types."
        },
        {
            key: "image",
            enabled: false,
            label: "Image",
            description: "Send images directly in the DM. Useful for product previews or visual confirmations."
        },
        {
            key: "sticker",
            enabled: false,
            label: "Sticker / Reaction",
            description: "Send Instagram stickers or emoji reactions within the DM thread."
        },
    ],
    phone: [
        {
            key: "voice",
            enabled: true,
            label: "Voice / TTS",
            description: "Text-to-speech voice response read aloud to the caller. Supports plain text or SSML for tone and pacing control."
        },
    ],
};

const ChannelBaseSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        business: { type: Schema.Types.ObjectId, ref: 'Businesses', required: true },
        provider: { type: Schema.Types.ObjectId, ref: 'Providers' },
        apiAuthenticator: { type: Schema.Types.ObjectId, ref: 'ApiAuthenticators' },
        type: { type: String, enum: ["whatsapp", "telegram", "website", "phone", "instagram", "sms", "email"] },
        runtime: { type: String, enum: ['TURN_BASED', 'REALTIME'], default: 'TURN_BASED' },
        config: { type: Schema.Types.Mixed, default: {} },
        externalId: String,
        status: { type: String, default: 'disabled' },   // enabled | disabled | error
        webhookUrl: String,
        systemPrompt: String,
        isPublic: { type: Boolean, default: false },
        UIElements: Schema.Types.Mixed,
        settings: {
            // defaultTemplate for leades created using this channel
            // snoozTime: Date,
            // Notification:Schema.Types.Mixed,
            // iceBreaker: template
            responseFormatCapabilities: [Capability],
        }

    },
    { timestamps: true }
);
ChannelBaseSchema.methods.updateStatus = function (status) {
    this.status = status;
    return this.save();
};
ChannelBaseSchema.pre("save", function (next) {
    if (this.isNew && !this.settings?.responseFormatCapabilities?.length) {
        const defaults = ChannelCapabilityDefaults[this.type] || [
            { key: "text", enabled: true, label: "Text", description: "Plain text messages. Supports basic formatting like bold, italic, and emojis." }   // fallback
        ];
        this.settings = {
            ...this.settings,
            responseFormatCapabilities: defaults
        };
    }
    next();
});
export const Channel = model('Channel', ChannelBaseSchema, 'Channel');