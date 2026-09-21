import axios from "axios"
import crypto from "crypto"
import { Channel } from '@avakado.ai/schemas';
export class InstagramMessagingAPI {
    constructor(config) {
        this.accessToken = config.accessToken;
        this.instagramId = config.instagramId;
        this.tokenExpiryTime = config.tokenExpiryTime; // Unix timestamp
        this.channelId = config.channelId;
        this.baseUrl = 'https://graph.instagram.com/v23.0';
        this.apiVersion = config.apiVersion || 'v23.0';
    }
    static async create(config) {
        const instance = new InstagramMessagingAPI(config);
        await instance.ensureValidToken();
        return instance;
    }
    // Get user profile information
    async getUserProfile(userId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/${userId}`,
                {
                    params: {
                        fields: 'username,name,account_type',
                        access_token: this.accessToken
                    }
                }
            );
            return response.data;
        } catch (error) {
            throw new Error(`Failed to get user profile: ${error.response?.data?.error?.message || error.message}`);
        }
    }
    // Helper method to make API calls
    async makeApiCall(endpoint, data) {
        try {
            const { data } = await axios.post(
                `${this.baseUrl}/${this.instagramId}/${endpoint}`,
                data,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return data;
        } catch (error) {
            throw new Error(`Instagram API Error: ${error.response?.data?.error?.message || error.message}`);
        }
    }
    // Token refresh callback function
    async refreshTokenCallback() {
        try {
            const url = 'https://graph.instagram.com/refresh_access_token';
            const params = {
                grant_type: 'ig_refresh_token',
                access_token: this.accessToken
            };
            const { data } = await axios.get(url, { params });
            const { access_token, token_type, expires_in, permissions } = data;
            this.accessToken = access_token;
            this.tokenExpiryTime = Date.now() + expires_in * 1000
            await Channel.findByIdAndUpdate(this.channelId, {
                'secrets.accessToken': access_token,
                'secrets.refreshAt': new Date(this.tokenExpiryTime),
                'secrets.permissions': permissions
            });
        } catch (error) {
            throw new Error(`Token refresh failed: ${error.message}`);
        }
    }
    // Check if token is expired and refresh if needed
    async ensureValidToken() {
        const currentTime = Math.floor(Date.now() / 1000);
        const bufferTime = 3000; // 50 minutes buffer before expiry
        if (this.tokenExpiryTime && currentTime >= (this.tokenExpiryTime - bufferTime)) await this.refreshTokenCallback()
    }
    async sendTypingIndicator(recipientId, action = 'typing_on') {
        const data = {
            recipient: { id: recipientId },
            sender_action: action // 'typing_on', 'typing_off', 'mark_seen'
        };
        return await this.makeApiCall('messages', data);
    }
    // Send message based on InstagramBotResponseSchema
    async sendMessage(recipientId, responseData) {
        const { type, data, metadata } = responseData;
        try {
            let result;
            switch (type) {
                case 'text':
                    result = await this.sendTextMessage(recipientId, data.text);
                    break;

                case 'quick_reply':
                    result = await this.sendQuickReplyMessage(recipientId, data.text, data.quick_replies);
                    break;

                case 'button_template':
                    result = await this.sendButtonTemplate(recipientId, data.text, data.buttons);
                    break;

                case 'generic_template':
                    result = await this.sendGenericTemplate(recipientId, data.elements);
                    break;

                case 'media':
                    result = await this.sendMediaMessage(recipientId, data.attachment_type, data.url, data.caption);
                    break;

                case 'postback':
                    // For postback, we just send the text response
                    result = await this.sendTextMessage(recipientId, data.text);
                    break;

                default:
                    throw new Error(`Unsupported message type: ${type}`);
            }

            // Log metadata if provided
            // if (metadata) console.log('Message sent with metadata:', { recipientId, type, metadata, messageId: result.message_id });
            return result;

        } catch (error) {
            console.error('Error sending message:', error);
            // Send fallback text message
            try {
                await this.sendTextMessage(recipientId, 'Sorry, I encountered an issue. Please try again.');
            } catch (fallbackError) {
                console.error('Fallback message also failed:', fallbackError);
            }
            throw error;
        }
    }

    // Send text message
    async sendTextMessage(recipientId, text) {
        const data = {
            recipient: { id: recipientId },
            message: { text: text }
        };
        return await this.makeApiCall('messages', data);
    }
    // Send quick reply message
    async sendQuickReplyMessage(recipientId, text, quickReplies) {
        const data = {
            recipient: { id: recipientId },
            message: {
                text: text,
                quick_replies: quickReplies
            }
        };
        return await this.makeApiCall('messages', data);
    }

    // Send button template message
    async sendButtonTemplate(recipientId, text, buttons) {
        const data = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: text,
                        buttons: buttons
                    }
                }
            }
        };
        return await this.makeApiCall('messages', data);
    }
    async sendMediaMessage(recipientId, attachmentType, url, caption = null) {
        const data = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: attachmentType,
                    payload: {
                        url: url,
                        is_reusable: true
                    }
                }
            }
        };

        const response = await this.makeApiCall('messages', data);

        // Send caption as separate message if provided
        if (caption) {
            await this.sendTextMessage(recipientId, caption);
        }

        return response;
    }
    // Send generic template (carousel)
    async sendGenericTemplate(recipientId, elements) {
        const data = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        elements: elements
                    }
                }
            }
        };
        return await this.makeApiCall('messages', data);
    }

    // Send heart sticker
    async sendHeartSticker(recipientId) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/${this.instagramId}/messages`,
                {
                    recipient: { id: recipientId },
                    message: {
                        attachment: {
                            type: 'like_heart'
                        }
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            throw new Error(`Failed to send heart sticker: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    // Send reaction to a message
    async sendReaction(recipientId, messageId, reaction = 'love') {
        try {
            const response = await axios.post(
                `${this.baseUrl}/${this.instagramId}/messages`,
                {
                    recipient: { id: recipientId },
                    sender_action: 'react',
                    payload: {
                        message_id: messageId,
                        reaction: reaction
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            throw new Error(`Failed to send reaction: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    // Remove reaction from a message
    async removeReaction(recipientId, messageId) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/${this.instagramId}/messages`,
                {
                    recipient: { id: recipientId },
                    sender_action: 'unreact',
                    payload: {
                        message_id: messageId
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            throw new Error(`Failed to remove reaction: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    // Send media share (Instagram post)
    async sendMediaShare(recipientId, postId) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/${this.instagramId}/messages`,
                {
                    recipient: { id: recipientId },
                    message: {
                        attachment: {
                            type: 'MEDIA_SHARE',
                            payload: { id: postId }
                        }
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            throw new Error(`Failed to send media share: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    // Send button template message
    async sendButtonTemplate(recipientId, text, buttons) {
        // Validate buttons
        if (!Array.isArray(buttons) || buttons.length === 0 || buttons.length > 3) {
            throw new Error('Buttons must be an array with 1-3 button objects');
        }

        // Validate button structure
        buttons.forEach((button, index) => {
            if (!button.type || !button.title) {
                throw new Error(`Button ${index + 1} must have 'type' and 'title' properties`);
            }

            if (button.type === 'web_url' && !button.url) {
                throw new Error(`Button ${index + 1} with type 'web_url' must have 'url' property`);
            }

            if (button.type === 'postback' && !button.payload) {
                throw new Error(`Button ${index + 1} with type 'postback' must have 'payload' property`);
            }
        });

        try {
            const response = await axios.post(
                `${this.baseUrl}/${this.instagramId}/messages`,
                {
                    recipient: { id: recipientId },
                    message: {
                        attachment: {
                            type: 'template',
                            payload: {
                                template_type: 'button',
                                text: text,
                                buttons: buttons
                            }
                        }
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            throw new Error(`Failed to send button template: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    // Helper method to create web URL button
    createWebUrlButton(title, url) {
        return {
            type: 'web_url',
            url: url,
            title: title
        };
    }

    // Helper method to create postback button
    createPostbackButton(title, payload) {
        return {
            type: 'postback',
            payload: payload,
            title: title
        };
    }

    // Get user profile information
    async getUserProfile(userId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/${userId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`
                    },
                    params: {
                        fields: 'id,username,account_type,media_count'
                    }
                }
            );
            return response.data;
        } catch (error) {
            throw new Error(`Failed to get user profile: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    // Get conversation history
    async getConversation(userId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/${this.instagramId}/conversations`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`
                    },
                    params: {
                        platform: 'instagram',
                        user_id: userId
                    }
                }
            );
            return response.data;
        } catch (error) {
            throw new Error(`Failed to get conversation: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    // Mark message as read
    async markAsRead(messageId) {
        try {
            const response = await axios.post(
                `${this.baseUrl}/${this.instagramId}/messages`,
                {
                    message_id: messageId,
                    sender_action: 'mark_seen'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            return response.data;
        } catch (error) {
            throw new Error(`Failed to mark message as read: ${error.response?.data?.error?.message || error.message}`);
        }
    }
}
export const verifyRequestSignature = (req, res, buf) => {
    var signature = req.headers["x-hub-signature-256"];

    if (!signature) {
        console.warn(`Couldn't find "x-hub-signature-256" in headers.`);
    } else {
        var elements = signature.split("=");
        var signatureHash = elements[1];
        var expectedHash = crypto.createHmac("sha256", config.appSecret).update(buf).digest("hex");
        if (signatureHash != expectedHash) throw new Error("Couldn't validate the request signature.");
    }
}
export const parseWebhook = (webhookData) => {

    const { object, entry } = webhookData;
    const parsedData = {
        object,
        messages: [],
        postbacks: [],
        reactions: [],
        mediaShares: []
    };
    if (entry && Array.isArray(entry) && entry.length > 0) {

        entry.forEach(entry => {
            const { id, time, messaging } = entry;


            if (messaging) {
                messaging.forEach(event => {
                    const { sender, recipient, timestamp, message } = event;
                    const accountId = id;
                    const senderId = sender.id;
                    const recipientId = recipient.id;
                    // mid text.quick_reply.reply_to attachments referral


                    // https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages#quick_reply



                    // Parse text messages
                    if (message.text) parsedData.messages.push({ type: 'text', accountId, senderId, recipientId, timestamp, messageId: message.mid, text: message.text });
                    // Parse attachments (images, videos, audio)
                    if (message.attachments && Array.isArray(message.attachments) && message.attachments.length > 0) message.attachments.forEach(attachment => { parsedData.mediaShares.push({ type: 'attachment', accountId, senderId, recipientId, timestamp, messageId: message.mid, attachmentType: attachment.type, url: attachment.payload.url }); });
                    // Parse postbacks (button clicks)
                    if (event.postback) parsedData.postbacks.push({ type: "postback", accountId, senderId, recipientId, timestamp, payload: event.postback.payload, title: event.postback.title });
                    // Parse reactions
                    if (event.reaction) parsedData.reactions.push({ type: "reaction", accountId, senderId, recipientId, timestamp, messageId: event.reaction.mid, reaction: event.reaction.reaction, action: event.reaction.action  /*'react' or 'unreact'*/ });
                });
            }
        });
    }

    return parsedData;
}