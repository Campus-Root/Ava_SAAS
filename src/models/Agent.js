import { Schema, model } from "mongoose";

// --- ENUMS ---
const TurnDetectionTypeEnum = ['server_vad', 'semantic_vad'];
const ToolChoiceEnum = ['auto', 'none', 'required'];
const AudioFormatEnum = ['pcm16', 'wav', 'mp3', 'g711_ulaw', 'g711_alaw', 'opus'];
const OpenAiVoices = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"];
const OpenAiRealtimeModels = ['gpt-4o-realtime-preview', 'gpt-4o-mini-realtime-preview', 'gpt-4o-realtime-preview-2025-06-03', 'gpt-4o-realtime-preview-2024-12-17', 'gpt-4o-realtime-preview-2024-10-01', 'gpt-4o-mini-realtime-preview-2024-12-17']
const ModalitiesEnum = ["audio", "text"];

// --- AUDIO TRANSCRIPTION ---
const InputAudioTranscriptionSchema = new Schema(
    {
        model: { type: String, default: "whisper-1" },
        prompt: { type: String },
        language: { type: String },  // ISO code like "en"
    },
    { _id: false }
);
// --- TURN DETECTION BASE ---
const TurnDetectionBase = new Schema(
    {
        create_response: { type: Boolean, default: true },
        type: { type: String, enum: TurnDetectionTypeEnum, required: true, default: "server_vad" },
    },
    { _id: false, discriminatorKey: "type" }
);

// --- SERVER VAD ---
const ServerVadSchema = new Schema(
    {
        idle_timeout_ms: { type: Number, min: 0 },
        silence_duration_ms: { type: Number, default: 1000, min: 0 },
        prefix_padding_ms: { type: Number, default: 300, min: 0 },
        interrupt_response: { type: Boolean, default: true },
        threshold: { type: Number, default: 0.5, min: 0, max: 1 },
    },
    { _id: false }
);

// --- SEMANTIC VAD ---
const SemanticVadSchema = new Schema(
    {
        eagerness: { type: String, enum: ["low", "medium", "high", "auto"], default: "auto" },
    },
    { _id: false }
);

// Attach discriminators for turn detection
TurnDetectionBase.discriminator('server_vad', ServerVadSchema);
TurnDetectionBase.discriminator('semantic_vad', SemanticVadSchema);

// --- AUDIO INPUT ---
const AudioInputSchema = new Schema(
    {
        format: { type: String, default: "g711_ulaw", enum: AudioFormatEnum },
        turn_detection: {
            type: TurnDetectionBase,
            default: () => ({ type: "server_vad" }),
            required: true,
        },
        noise_reduction: { type: { type: String, enum: ["near_field", "far_field"] } },
        transcription: { type: InputAudioTranscriptionSchema }
    },
    { _id: false }
);

// --- AUDIO OUTPUT ---
const AudioOutputSchema = new Schema(
    {
        format: { type: String, default: "g711_ulaw", enum: AudioFormatEnum },
        speed: { type: Number, min: 0.25, max: 2.0, default: 1.0 },
        getTranscription: { type: Boolean, default: true },
    },
    { _id: false }
);

// --- AUDIO CONFIG ---
const AudioSchema = new Schema(
    {
        input: { type: AudioInputSchema },
        output: { type: AudioOutputSchema },
    },
    { _id: false }
);

// --- ASSISTANT CONFIG ---
// const AssistantConfigSchema = new Schema(
//     {
//         model: { type: String, enum: OpenAiRealtimeModels, default: 'gpt-4o-mini-realtime-preview' },
//         provider: { type: String, enum: AiProviderEnum, default: "openai" },
//         voice: { type: String, enum: OpenAiVoices, default: "alloy" },
//         type: { type: String, default: 'realtime' },
//         output_modalities: [{ type: String, enum: ModalitiesEnum }],
//         audio: { type: AudioSchema },
//         max_output_tokens: { type: Number },
//         truncation: { type: String, enum: ["auto", "retention_ratio"], default: "auto" },
//         retention_ratio: { type: Number, default: 0.5 },
//         post_instructions_token_limit: { type: Number }
//     },
//     { _id: false }
// );
// assistant config schema is based on the model provider
// if the model provider is openai, then the assistant config schema is based on the openai realtime models, voice
// if the model provider is google, then the assistant config schema is based on the google realtime models, voice
// if the model provider is anthropic, then the assistant config schema is based on the anthropic realtime models, voice

//  get the differentiators for the assistant config schema based on the model provider
// elevenlabs: {
//     models: ['eleven_monolingual_v1', 'eleven_multilingual_v1', 'eleven_multilingual_v2', 'eleven_turbo_v2'],
//     voices: ['rachel', 'clyde', 'domi', 'dave', 'fin', 'sarah', 'antoni', 'thomas']
// },
// azure: {
//     models: ['en-US-JennyNeural', 'en-US-GuyNeural', 'en-US-AriaNeural'],
//     voices: ['en-US-JennyNeural', 'en-US-GuyNeural', 'en-US-AriaNeural', 'en-US-DavisNeural']
// },
// deepgram: {
//     models: ['aura-asteria-en', 'aura-luna-en', 'aura-stella-en', 'aura-athena-en'],
//     voices: ['aura-asteria-en', 'aura-luna-en', 'aura-stella-en', 'aura-athena-en', 'aura-orion-en']
// },
const VoiceProviderConfig = {
    openai: {
        models: ['gpt-realtime', 'gpt-realtime-mini'],
        voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar']
    },
    gemini: {
        models: ['gemini-2.5-flash-native-audio-latest'],
        voices: ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat']
    }
};

const AssistantConfigSchema = new Schema({
    provider: { type: String, enum: Object.keys(VoiceProviderConfig), default: 'openai' },
    model: { type: String, validate: { validator: function (value) { return VoiceProviderConfig[this.provider]?.models.includes(value); }, message: props => `Invalid model for provider` } },
    voice: { type: String, validate: { validator: function (value) { return VoiceProviderConfig[this.provider]?.voices.includes(value); }, message: props => `Invalid voice for provider` } },
    advancedConfig: {
        startOfSpeechSensitivity: { type: String, enum: ['START_SENSITIVITY_LOW', 'START_SENSITIVITY_HIGH'], default: 'START_SENSITIVITY_HIGH' },
        endOfSpeechSensitivity: { type: String, enum: ['END_SENSITIVITY_LOW', 'END_SENSITIVITY_HIGH'], default: 'END_SENSITIVITY_LOW' },
        prefixPaddingMs: { type: Number, default: 300 },
        silenceDurationMs: { type: Number, default: 800 }
    },
}, { _id: false });
// --- AGENT SCHEMA ---
const AgentSchema = new Schema({
    appearance: {
        clientMessageBox: { backgroundColor: String, textColor: String },
        avaMessageBox: { backgroundColor: String, textColor: String },
        textInputBox: { backgroundColor: String, textColor: String },
        quickQuestionsWelcomeScreenBox: { backgroundColor: String, textColor: String }
    },
    personalInfo: {
        name: String,
        description: String,
        avatar: String,
        prompt: {
            role: String,
            objective: String,
            instructionsAndWorkflow: String,
            constraintsAndRules: String
        },
        systemPrompt: String,
        quickQuestions: [{ label: String, value: String }],
        welcomeMessage: String,
        model: { type: String, default: 'gpt-4.1-mini' },
        temperature: { type: Number, default: 0.5 },
        VoiceAgentSessionConfig: AssistantConfigSchema,
    },
    workflow: { type: Schema.Types.ObjectId, ref: 'Workflow' },
    collections: [{ type: Schema.Types.ObjectId, ref: 'Collection' }],
    channels: [{ type: Schema.Types.ObjectId, ref: 'Channel' }],
    actions: [{ type: Schema.Types.ObjectId, ref: 'Action' }],
    tool_choice: { type: String, enum: ToolChoiceEnum, default: "auto" },
    business: { type: Schema.Types.ObjectId, ref: 'Businesses' },
    analysisMetrics: Schema.Types.Mixed,
    facets: [String],
    createdBy: { type: Schema.Types.ObjectId, ref: 'Users' },
    isPublic: { type: Boolean, default: false },
    isFeatured: { type: Boolean, default: false },
}, {
    timestamps: true
});
export const AgentModel = model('Agent', AgentSchema, "Agent");
// const newAgentSchema = new Schema({
//     // connections
//     business: { type: Schema.Types.ObjectId, ref: 'Businesses' },
//     createdBy: { type: Schema.Types.ObjectId, ref: 'Users' },
//     isPublic: { type: Boolean, default: false },
//     isFeatured: { type: Boolean, default: false },
//     workflow: { type: Schema.Types.ObjectId, ref: 'Workflow' },
//     collections: [{ type: Schema.Types.ObjectId, ref: 'Collection' }],
//     channels: [{ type: Schema.Types.ObjectId, ref: 'Channel' }],
//     actions: [{ type: Schema.Types.ObjectId, ref: 'Action' }],
//     tool_choice: { type: String, enum: ['auto', 'none', 'required'], default: "auto" },

//     //    identity
//     appearance: {
//         clientMessageBox: { backgroundColor: String, textColor: String },
//         avaMessageBox: { backgroundColor: String, textColor: String },
//         textInputBox: { backgroundColor: String, textColor: String },
//         quickQuestionsWelcomeScreenBox: { backgroundColor: String, textColor: String }
//     },
//     personalInfo: {
//         name: String,
//         description: String,
//         avatar: String,
//         prompt: {
//             role: String,
//             objective: String,
//             instructionsAndWorkflow: String,
//             constraintsAndRules: String
//         }
//     },
//     // brain
//     // runtime: { type: String, enum: ['TURN_BASED', 'REALTIME', 'BACKGROUND'], default: 'TURN_BASED' }
// }, { timestamps: true, discriminatorKey: 'runtime' });
// const configOpts = { _id: false, strict: false };
// const TurnBasedConfigSchema = new Schema({
//     runtime: { type: String, default: 'TURN_BASED' },
//     config: {
//         provider: { type: String, enum: ['openai', 'google', 'anthropic'], default: 'openai' },
//         model: {
//             type: String,
//             validate: {
//                 validator: function (value) {
//                     // return VoiceProviderConfig[this.provider]?.models.includes(value);  check the model value based on provider and runtime
//                     return true;
//                 }, message: props => `Invalid model for provider`
//             }
//         },
//         temperature: { type: Number, default: 0.3 },
//     }
// }, configOpts);
// const RealtimeConfigSchema = new Schema({
//     runtime: { type: String, default: 'REALTIME' },
//     config: {
//         provider: { type: String, enum: ['openai', 'google', 'anthropic'], default: 'openai' },
//         model: { type: String, validate: { validator: function (value) { return VoiceProviderConfig[this.provider]?.models.includes(value); }, message: props => `Invalid model for provider` } },
//         temperature: { type: Number, default: 0.3 },
        

//     //     {
//     //     "type": "realtime",
//     //     audio: {
//     //         input: {
//     //             format: audioIpFormat,
//     //             noise_reduction: { type: "near_field" },
//     //             transcription: { model: "whisper-1" },
//     //             turn_detection: {
//     //                 type: "server_vad",
//     //                 create_response: true,
//     //                 interrupt_response: true,
//     //                 prefix_padding_ms: agentDetails.personalInfo.VoiceAgentSessionConfig.advancedConfig.prefixPaddingMs,
//     //                 silence_duration_ms: agentDetails.personalInfo.VoiceAgentSessionConfig.advancedConfig.silenceDurationMs,
//     //                 threshold: 0.8
//     //             }
//     //         },
//     //         output: {
//     //             format: audioOpFormat,
//     //             speed: 1.0,
//     //             voice: agentDetails.personalInfo.VoiceAgentSessionConfig.voice || "alloy",
//     //         }
//     //     },
//     //     instructions: instructions,
//     //     model: agentDetails.personalInfo.VoiceAgentSessionConfig.model,
//     //     output_modalities: ["audio"],
//     //     tools: toolsJson.map(tool => ({ type: "function", ...tool })),
//     //     tool_choice: agentDetails.tool_choice || "auto"
//     // }


// //  {
// //     model: "models/" + agentDetails.personalInfo.VoiceAgentSessionConfig.model,
// //     generationConfig: {
// //         responseModalities: ["AUDIO"],
// //         speechConfig: {
// //             voiceConfig: {
// //                 prebuiltVoiceConfig: {
// //                     voiceName: agentDetails.personalInfo.VoiceAgentSessionConfig.voice || "Iapetus",
// //                 }
// //             }
// //         }
// //     },
// //     proactivity: { proactiveAudio: true },
// //     realtimeInputConfig: {
// //         automaticActivityDetection: {
// //             disabled: false, // default
// //             startOfSpeechSensitivity: agentDetails.personalInfo.VoiceAgentSessionConfig.advancedConfig.startOfSpeechSensitivity,
// //             endOfSpeechSensitivity: agentDetails.personalInfo.VoiceAgentSessionConfig.advancedConfig.endOfSpeechSensitivity,
// //             prefixPaddingMs: agentDetails.personalInfo.VoiceAgentSessionConfig.advancedConfig.prefixPaddingMs,
// //             silenceDurationMs: agentDetails.personalInfo.VoiceAgentSessionConfig.advancedConfig.silenceDurationMs,
// //         }
// //     },
// //     inputAudioTranscription: {},
// //     outputAudioTranscription: {},
// //     systemInstruction: {
// //         parts: [{
// //             text: instructions
// //         }]
// //     },
// //     tools: [{ functionDeclarations: toolsJson }]
// // }


//     }
// }, configOpts);
// const BackgroundConfigSchema = new Schema({
//     runtime: { type: String, default: 'BACKGROUND' },
//     config: {
//         provider: { type: String, enum: ['openai', 'google', 'anthropic'], default: 'openai' },
//         model: { type: String, validate: { validator: function (value) { return VoiceProviderConfig[this.provider]?.models.includes(value); }, message: props => `Invalid model for provider` } },
//         temperature: { type: Number, default: 0.3 },
//     }
// }, configOpts);
// export const NewAgentModel = model('NewAgent', newAgentSchema, "NewAgent");
// newAgentSchema.discriminator('TURN_BASED', TurnBasedConfigSchema)
// newAgentSchema.discriminator('REALTIME', RealtimeConfigSchema)
// newAgentSchema.discriminator('BACKGROUND', BackgroundConfigSchema);