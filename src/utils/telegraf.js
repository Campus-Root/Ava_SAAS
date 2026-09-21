import { AgentModel } from '@avakado.ai/schemas';
import { Channel } from '@avakado.ai/schemas';

export const getBotDetails = async ({ type, botId }) => {
    try {
        let channelDetails;

        switch (type) {
            case "telegram":
                channelDetails = await Channel.findOne({ "config.id": botId });
                break;
            case "whatsapp":
                channelDetails = await Channel.findOne({ "config.phone_number_id": botId });
                break;
            case "instagram":
                channelDetails = await Channel.findOne({ "config.igBusinessId": botId });
                break;
            default:
                return { agentDetails: null, channelDetails: null };
        }

        if (!channelDetails) {
            console.warn(`Channel not found for type: ${type}, botId: ${botId}`);
            return { agentDetails: null, channelDetails: null };
        }

        const agentDetails = await AgentModel.findOne({ channels: channelDetails._id }).populate("business actions");

        if (!agentDetails) {
            console.warn(`Agent not found for channelId: ${channelDetails._id}`);
        }

        return { agentDetails, channelDetails };

    } catch (error) {
        console.error("Error in getBotDetails:", error);
        return { agentDetails: null, channelDetails: null };
    }
};
export function categorizeTelegramTrigger(body) {
    // {"update_id":525235049,"message":{"message_id":50,"from":{"id":6233054381,"is_bot":false,"first_name":"Vishnu","language_code":"en"},"chat":{"id":6233054381,"first_name":"Vishnu","type":"private"},"date":1752608910,"text":"Can you say that again?"}}

    // {"update_id":525235051,"callback_query":{"id":"8324020648854304967","from":{"id":6233054381,"is_bot":false,"first_name":"Vishnu","language_code":"en"},"message":{"message_id":53,"from":{"id":8125663159,"is_bot":true,"first_name":"Pilla","username":"Pilla2846_bot"},"chat":{"id":6233054381,"first_name":"Vishnu","type":"private"},"date":1752609003,"text":"I work as a sales assistant designed to help you with product information and support. How can I assist you with your needs today?","reply_markup":{"inline_keyboard":[[{"text":"Product Features","callback_data":"features_info"}],[{"text":"Contact Support","callback_data":"contact_support"}]]}},"chat_instance":"6930704767987197904","data":"features_info"}}
    if (body.message) {
        if (body.message.text && body.message.text.startsWith('/')) return 'command';
        if (body.message.text) return 'text_message';
        if (body.message.photo) return 'photo';
        if (body.message.video) return 'video';
        if (body.message.document) return 'document';
        if (body.message.voice) return 'voice';
        if (body.message.audio) return 'audio';
        if (body.message.sticker) return 'sticker';
        if (body.message.contact) return 'contact';
        if (body.message.location) return 'location';
        if (body.message.new_chat_members) return 'new_chat_members';
        if (body.message.left_chat_member) return 'left_chat_member';
        if (body.edited_message) return 'edited_message';
        return 'unknown';
    }
    if (body.callback_query) return 'callback_query';
    if (body.inline_query) return 'inline_query';
    if (body.chat_join_request) return 'chat_join_request';
    if (body.my_chat_member) return 'my_chat_member';
    if (body.chat_member) return 'chat_member';
    return 'unknown';
}
export const loggingResults = (result) => {
    // Log all available properties from RunResultBase
    console.log('=== COMPLETE AGENT RUN RESULT ===');
    // history - Complete conversation flow including inputs and generated content
    // console.log('\n1. HISTORY (input + generated items):');
    // console.log(JSON.stringify(result.history, null, 2));
    // // output - New model data that can be used for next runs
    // console.log('\n2. OUTPUT (new model data):');
    // console.log(JSON.stringify(result.output, null, 2));
    // // input - Original input items - PRevMessages
    // console.log('\n3. INPUT (original input):');
    // console.log(JSON.stringify(result.input, null, 2));

    // console.log('\n4. NEW ITEMS (run items with agent associations):');
    // console.log(JSON.stringify(result.newItems, null, 2));

    console.log('\n5. RAW RESPONSES (LLM responses):');
    console.log(JSON.stringify(result.rawResponses, null, 2));

    // console.log('\n6. LAST RESPONSE ID:');
    // console.log(result.lastResponseId);

    // console.log('\n7. LAST AGENT:');
    // console.log(result.lastAgent);

    // console.log('\n8. INPUT GUARDRAIL RESULTS:');
    // console.log(JSON.stringify(result.inputGuardrailResults, null, 2));

    // console.log('\n9. OUTPUT GUARDRAIL RESULTS:');
    // console.log(JSON.stringify(result.outputGuardrailResults, null, 2));

    // console.log('\n10. INTERRUPTIONS:');
    // console.log(JSON.stringify(result.interruptions, null, 2));

    // console.log('\n11. FINAL OUTPUT:');
    // console.log(JSON.stringify(result.finalOutput, null, 2));

    // console.log('\n12. STATE:');
    // console.log(JSON.stringify(result.state, null, 2));

    console.log('\n=== END RESULT LOGGING ===');

    // Also log the entire result object to see if there are any additional properties
    console.log('\n=== FULL RESULT OBJECT ===');
    console.log(JSON.stringify(result, null, 2));
}