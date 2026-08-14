import { Schema, model } from "mongoose";

const ProviderConfig = {
    openai: {
        TURN_BASED: {
            models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
        },
        REALTIME: {
            models: ['gpt-realtime', 'gpt-realtime-2.1', 'gpt-realtime-2.1-mini', 'gpt-realtime-2.0', 'gpt-realtime-1.5'],
            voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'],
            modalities: ['audio', 'text'],
            wssUrl: 'wss://api.openai.com/v1/realtime',
        },
    },
    gemini: {
        TURN_BASED: {
            models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro'],
        },
        REALTIME: {
            models: ['gemini-2.5-flash-native-audio-latest'],
            voices: ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'],
            modalities: ['AUDIO', 'TEXT'],
            wssUrl: 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent',
        },
    },
    anthropic: {
        TURN_BASED: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
        REALTIME: null,
    }
};


// --- AGENT SCHEMA ---
const ModelConfigSchema = new Schema({
    provider: { type: String, enum: [...Object.keys(ProviderConfig), 'custom'], required: true, default: 'openai' },
    customProviderRef: { type: String, required: function () { return this.provider === 'custom' } },
    providerData: Schema.Types.Mixed,
    model: {
        type: String, required: true, validate: {
            validator: function (value) {
                if (this.provider === 'custom') return true;
                return ProviderConfig[this.provider]?.[this.$parent()?.runtime]?.models.includes(value);
            }, message: props => `Model "${props.value}" is not valid for provider "${this.provider}"`
        }
    },
    modelSettings: {
        temperature: { type: Number, default: 0.3 },
        toolChoice: { type: String, default: 'auto' },
        topP: Number,
        frequencyPenalty: Number,
        presencePenalty: Number,
        parallelToolCalls: Boolean,
        truncation: { type: String, enum: ['auto', 'disabled'] },
        maxTokens: Number,
        store: Boolean,
        reasoning: {
            effort: { type: String, enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
            mode: String,
            context: { type: String, enum: ['auto', 'current_turn', 'all_turns', null] },
            summary: { type: String, enum: ['auto', 'concise', 'detailed'] },
        },
        text: { verbosity: { type: String, enum: ['low', 'medium', 'high'] } },
        promptCacheOptions: {
            mode: { type: String, enum: ['implicit', 'explicit'] },
            ttl: { type: String, enum: ['30m'] },
        },
        promptCacheRetention: { type: String, enum: ['in-memory', '24h', null] },
        // retry: {
        //     maxRetries: Number,
        //     backoff: {
        //         initialDelayMs: Number,
        //         maxDelayMs: Number,
        //         multiplier: Number,
        //         jitter: Boolean,
        //     },
        //     policy: { type: String, enum: ['providerSuggested', 'networkError', 'retryAfter', 'never'] },
        // },
    },
},
    { _id: false }
);


const ResponseConfigSchema = new Schema({
    provider: { type: String, enum: [...Object.keys(ProviderConfig), 'elevenlabs', 'custom'], required: true },
}, { _id: false, discriminatorKey: 'provider' });
const TurnBasedConfigSchema = new Schema({}, { _id: false });    // currently none but might be used for future features
const BackgroundConfigSchema = new Schema({}, { _id: false });    // currently none but might be used for future features
const RealtimeConfigSchema = new Schema({ responseConfig: ResponseConfigSchema }, { _id: false });
const responseConfigPath = RealtimeConfigSchema.path('responseConfig');
const openaiResponseConfigSchema = new Schema({
    modality: [{ type: String, enum: ProviderConfig.openai?.REALTIME?.modalities, default: ProviderConfig.openai?.REALTIME?.modalities[0] }],
    wssUrl: { type: String, default: ProviderConfig.openai?.REALTIME?.wssUrl },
    audio: {
        input: {
            noise_reduction: { type: String, enum: ['near_field', 'far_field'], default: 'near_field' },
            transcription: { model: { type: String, default: "whisper-1" }, prompt: String, language: String },
            turn_detection: {
                type: { type: String, enum: ['server_vad', 'semantic_vad'], default: 'server_vad' },
                create_response: { type: Boolean, default: true },
                interrupt_response: { type: Boolean, default: true },
                prefix_padding_ms: { type: Number, default: 300 },
                silence_duration_ms: { type: Number, default: 1000 },
                threshold: { type: Number, default: 0.8 }
            }
        },
        output: {
            speed: { type: Number, min: 0.25, max: 2.0, default: 1.0 },
            voice: { type: String, validate: { validator: function (value) { return VoiceProviderConfig.openai?.voices.includes(value); }, message: props => `Invalid voice for openai` } },
        }
    }
}, { _id: false });
responseConfigPath.discriminator('openai', openaiResponseConfigSchema);
const geminiResponseConfigSchema = new Schema({
    modality: [{ type: String, enum: ProviderConfig.gemini?.REALTIME?.modalities, default: ProviderConfig.gemini?.REALTIME?.modalities[0] }],
    wssUrl: { type: String, default: ProviderConfig.gemini?.REALTIME?.wssUrl },
    proactivity: { proactiveAudio: { type: Boolean, default: true } },
    realtimeInputConfig: {
        automaticActivityDetection: {
            disabled: { type: Boolean, default: false },
            startOfSpeechSensitivity: { type: String, enum: ['START_SENSITIVITY_LOW', 'START_SENSITIVITY_HIGH'], default: 'START_SENSITIVITY_HIGH' }, // gemini
            endOfSpeechSensitivity: { type: String, enum: ['END_SENSITIVITY_LOW', 'END_SENSITIVITY_HIGH'], default: 'END_SENSITIVITY_LOW' }, // gemini
            prefixPaddingMs: { type: Number, default: 300 },
            silenceDurationMs: { type: Number, default: 1000 },
        }
    },
    realtimeOutputConfig: {
        speed: { type: Number, min: 0.25, max: 2.0, default: 1.0 },
        voice: { type: String, validate: { validator: function (value) { return VoiceProviderConfig.gemini?.voices.includes(value); }, message: props => `Invalid voice for openai` } },
    },
    inputAudioTranscription: Schema.Types.Mixed,
    outputAudioTranscription: Schema.Types.Mixed,
}, { _id: false });
responseConfigPath.discriminator('gemini', geminiResponseConfigSchema);
const AgentSchema = new Schema({
    personalInfo: {
        name: String,
        description: String,
        avatar: String,
        systemPrompt: {
            role: String,
            objective: String,
            instructionsAndWorkflow: String,
            constraintsAndRules: String
        }
    },
    runtime: { type: String, enum: ['TURN_BASED', 'REALTIME', 'BACKGROUND'], default: 'TURN_BASED' },
    modelConfig: ModelConfigSchema,
    workflow: { type: Schema.Types.ObjectId, ref: 'Workflow' },
    collections: [{ type: Schema.Types.ObjectId, ref: 'Collection' }],
    channels: [{ type: Schema.Types.ObjectId, ref: 'Channel' }],
    actions: [{ type: Schema.Types.ObjectId, ref: 'Action' }],
    tool_choice: { type: String, enum: ['auto', 'none', 'required'], default: "auto" },
    business: { type: Schema.Types.ObjectId, ref: 'Businesses' },
    analysisMetrics: Schema.Types.Mixed,
    facets: [String],
    createdBy: { type: Schema.Types.ObjectId, ref: 'Users' },
    isPublic: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
}, {
    discriminatorKey: 'runtime',
    timestamps: true
});
AgentSchema.discriminator('TURN_BASED', TurnBasedConfigSchema)
AgentSchema.discriminator('REALTIME', RealtimeConfigSchema)
AgentSchema.discriminator('BACKGROUND', BackgroundConfigSchema)
export const AgentModel = model('Agent', AgentSchema, "Agent");