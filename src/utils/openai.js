import OpenAI from "openai";
import { Data } from "../models/Data.js";
import mongoose from "mongoose";
import 'dotenv/config'
export const openai = new OpenAI({ apiKey: process.env.OPEN_API_KEY });
export const EmbeddingFunct = async (text) => {
    try {
        const { data, model, usage } = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text,
            encoding_format: "float",
        });
        return { data, model, usage }
    } catch (error) {
        console.error(error);
        return null;
    }
}
export const getSummary = async (chunk, topicsSoFar = []) => {
    try {
        const { choices, usage, model } = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `
You are a strict evaluator, summarizer and  incremental topic builder.

EVALUATION RULES
● Ignore common knowledge, definitions, boilerplate.
● Only deem "valuable" if the chunk contains non‑obvious, specific information: data, unique insights,citations, or technical details, URLs, detailed steps, etc.
● Only summarize content with specific, contextual, or specialized knowledge

TOPIC RULES
● Consider the list TOPICS_SO_FAR supplied below.
● Extract only *new* essential topics in this chunk that are not already in TOPICS_SO_FAR.
● A “topic” is a short noun phrase (2–6 words) that captures a distinct idea or entity.
● Do NOT output duplicates, synonyms, or over‑broad words (e.g. use “token‑based rate‑limit” not just “rate‑limit”).

OUTPUT (valid minified JSON, no comments, no extra keys)
If *valuable*:
{
  "result": true,
  "summary": "<concise summary>",
  "new_topics": ["topic A", "topic B"]
}
Else:
{ "result": false }
Output strictly valid JSON. Do not include commentary or extra text.`
                },
                {
                    role: "user",
                    content: `
                    CHUNK:
                    <<< ${chunk} >>>
                    TOPICS_SO_FAR:
                    ${topicsSoFar.join(", ") || "none"}`
                }
            ],
            temperature: 0.1
        });

        const raw = choices[0].message.content.trim();
        const tokenUsage = {
            input: usage.prompt_tokens,
            output: usage.completion_tokens,
            total: usage.total_tokens,
            model: model
        }
        const parsed = JSON.parse(raw);          // throws if bad JSON
        if (!parsed.result) return { result: false };
        // ------ merge topics locally ------
        const nextTopics = uniqueTopicMerge(topicsSoFar, parsed.new_topics || []);

        return {
            result: true,
            summary: parsed.summary,
            newTopics: parsed.new_topics,
            topics: nextTopics,          // the full updated list
            tokenUsage
        };
    } catch (error) {
        console.error("OpenAI API error:", error);
        return { result: false };
    }
};
export const normalise = str => str.toLowerCase().replace(/[^\w\s]/g, "").trim();

export const uniqueTopicMerge = (oldArr, newArr) => {
    const seen = new Set(oldArr.map(normalise));
    for (const t of newArr || []) {
        const key = normalise(t);
        if (!seen.has(key)) seen.add(key);
    }
    return [...seen].map(t => t);        // back to plain array
};

export const actions = async (messages, availableActions) => {
    const systemMessage = {
        role: "system",
        content: `You are an AI assistant designed to analyze all previous messages to maintain context, classify user intents, and extract structured data for predefined actions.
        Your goal is to accurately identify one or more relevant intents and extract structured parameters.
        Today:${new Date()}
        Your task is to:
        1️⃣ Identify one or more relevant intents ONLY from the available actions:
           ${JSON.stringify(availableActions, null, 2)}
        2️⃣ Extract required parameters for each identified intent from conversation based on the provided data schema in tool calls.
        3️⃣ Assign a confidence score (between 0 and 1) to each detected intent based on certainty.
        4️⃣ If multiple intents exist, extract them all with confidence.
        5️⃣ Infer missing parameters from conversation context when possible.
        6️⃣ If a parameter cannot be inferred, set its value to null.
        7️⃣ If a query implies an intent without stating it explicitly, deduce the intent logically.
        🚨 ALWAYS provide at least one intent with a confidence score, even if the intent is uncertain.
        🚨 ALWAYS use the exact same output format with actions array containing intent, confidence, and dataSchema.
        🚨 ALWAYS return ALL relevant intents - do not limit to just one intent when multiple are applicable.`
    }
    const tools = [
        {
            type: "function",
            function: {
                name: "universal_tool",
                description: "Handles one or more intent-based actions dynamically.",
                strict: true,
                parameters: {
                    type: "object",
                    properties: {
                        actions: {
                            type: "array",
                            description: "A list of identified actions matching the user query.",
                            items: {
                                type: "object",
                                properties: {
                                    intent: { type: "string", description: "The identified user intent." },
                                    confidence: {
                                        type: "number",
                                        description: "Confidence score (0 to 1) indicating certainty of intent classification."
                                    },
                                    dataSchema: {
                                        type: "array",
                                        description: "Extracted parameters for the intent, stored under 'data', based on given json of actions.",
                                        items: {
                                            type: "object",
                                            properties: {
                                                key: { type: "string", description: "Parameter name." },
                                                data: {
                                                    type: ["string", "number", "boolean", "null"],
                                                    description: "Extracted value or null if missing. maintain same structure"
                                                }
                                            },
                                            required: ["key", "data"],
                                            additionalProperties: false
                                        }
                                    }
                                },
                                required: ["intent", "confidence", "dataSchema"],
                                additionalProperties: false
                            },
                        },
                    },
                    required: ["actions"],
                    additionalProperties: false
                },
            },
        },
    ];
    const modelOptions = {
        model: "gpt-4o-mini-2024-07-18",
        temperature: 0.7, // Slightly higher temperature to encourage multiple intents when appropriate
        messages: [systemMessage, ...messages],
        tools,
        tool_choice: "required",
    };
    try {
        const { model, usage, choices } = await openai.chat.completions.create(modelOptions);
        const toolCall = choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall) {
            console.warn("No valid tool execution.");
            return { matchedActions: [], model, usage };
        }
        let toolData;
        try {
            toolData = JSON.parse(toolCall.function.arguments);
            // Ensure we have the consistent structure with actions array
            if (!toolData.actions || !Array.isArray(toolData.actions)) {
                // Transform inconsistent format into proper format
                const transformedActions = [];
                // If we got a flattened object like {Topic: "something"} instead of proper structure
                if (typeof toolData === 'object' && !Array.isArray(toolData)) {
                    const dataSchema = Object.entries(toolData).map(([key, data]) => ({ key, data }));
                    transformedActions.push({ intent: "enquiry", confidence: 0.7, dataSchema });
                } else if (Array.isArray(toolData)) toolData = { actions: toolData };
                if (transformedActions.length > 0) toolData = { actions: transformedActions };
            }
            // Validate each action has required fields
            toolData.actions = toolData.actions.map(action => { return { intent: action.intent || "enquiry", confidence: typeof action.confidence === 'number' ? action.confidence : 0.7, dataSchema: Array.isArray(action.dataSchema) ? action.dataSchema : [{ "key": "Topic", "data": messages.at(-1) }] }; });
        } catch (error) {
            console.warn("Error parsing tool call arguments:", error);
            toolData = { actions: [] };
        }
        return { matchedActions: toolData.actions, model, usage };
    } catch (error) {
        console.error("Error processing actions:", error);
        return { matchedActions: [], model: null, usage: null };
    }
};
export const getContextMain = async (collectionIds, text, options = {}) => {
    const { numCandidates = 500, limit = 10 } = options;
    const embeddingResult = await EmbeddingFunct(text) // this will return the embedding vector of the text
    try {
        // First stage retrieval with more candidates
        let context = await Data.aggregate([
            {
                $vectorSearch: {
                    "exact": false,
                    "filter": { "collection": { $in: collectionIds.map(ele => new mongoose.Types.ObjectId(ele)) } },
                    "index": "vector_index",
                    "path": "embeddingVector",
                    "queryVector": embeddingResult.data[0].embedding,
                    "numCandidates": numCandidates,
                    "limit": limit, // Retrieve more documents initially for reranking
                }
            },
            {
                $project: {
                    metadata: 1,
                    summary: 1,
                    score: { $meta: 'vectorSearchScore' }
                }
            }
        ]);
        let result = {
            // context: [],
            answer: '',
            // embeddingTokens: {
            //     model: embeddingResult.model,
            //     usage: embeddingResult.usage
            // },
        };
        context.forEach(ele => {
            result.answer += `\n${ele.summary}\n`;
            // result.context.push({ ...ele.metadata, score: ele.score, chunkNumber: ele.chunkNumber });
        })
        return result;
    } catch (error) {
        console.error(error);
        return {
            context: [],
            answer: '',
            embeddingTokens: {
                model: embeddingResult.model,
                usage: embeddingResult.usage
            },
        };;
    }
}
export const AssistantResponse = async (req, res, config) => {
    const { prevMessages, additional_instructions, assistant_id, messageId, conversationId, signalKeyword = "DATAPOINT_NEXUS", streamOption } = config
    const thread = await openai.beta.threads.create({ messages: prevMessages });
    if (streamOption) { res.setHeader('Content-Type', 'text/plain'); res.setHeader('Transfer-Encoding', 'chunked'); }
    const stream = await openai.beta.threads.runs.create(thread.id, { assistant_id, additional_instructions, stream: true });
    let signalDetected = false, responseTokens, response = ""
    for await (const chunk of stream) {
        switch (chunk.event) {
            case "thread.message.delta":
                const content = chunk.data.delta.content[0]?.text?.value || "";
                if (content) {
                    if (content.includes(signalKeyword)) signalDetected = true;
                    const cleanContent = content.replace(signalKeyword, "") || content;
                    response += cleanContent;
                    if (streamOption) res.write(JSON.stringify({ id: "conversation", messageId, conversationId, responseType: "chunk", data: cleanContent }));
                }
                break;
            case "thread.run.completed":
                try {
                    await openai.beta.threads.del(thread.id);
                    console.log(`Thread deleted`);
                } catch (error) {
                    console.error(`Error deleting thread: ${error.message}`);
                }
                const { usage, model } = chunk.data
                responseTokens = { usage, model };
                break;
        }
    }
    if (response.includes(signalKeyword)) {
        signalDetected = true;
        response = response.replace(signalKeyword, "");
    }
    return { responseTokens, response, signalDetected }
}
// export const createAnOpenAiApiKey = async (name) => {
//     try {
//         const { data } = await axios.post("https://api.openai.com/v1/organization/admin_api_keys", { name }, { headers: { 'Authorization': `Bearer ${process.env.OPEN_API_ADMIN_KEY}`, 'Content-Type': 'application/json' } })
//         return { apiKey: data.value, name: data.name, id: data.id, redacted_value: data.redacted_value, created_at: data.created_at }
//     } catch (error) {
//         console.log(error);
//         throw new Error("Error occurred while creating openAi api key");
//     }
// }
export const OpenAiLLM = async ({ input = [], model = "gpt-4o-mini", text = {} }) => {
    try {
        const response = await openai.responses.parse({
            model,
            input,
            text
        });
        return response
    } catch (error) {
        console.error(error);
        return null;
    }
}
export const pricing = {
    // GPT-4.1 Series
    'gpt-4.1-2025-04-14': { input: 0.002, output: 0.008 },
    'gpt-4.1': { input: 0.002, output: 0.008 }, // Latest alias
    'gpt-4.1-mini-2025-04-14': { input: 0.0004, output: 0.0016 },
    'gpt-4.1-nano-2025-04-14': { input: 0.0001, output: 0.0004 },

    // GPT-4.5 Preview
    'gpt-4.5-preview-2025-02-27': { input: 0.075, output: 0.15 },

    // GPT-4o Series
    'gpt-4o-2024-08-06': { input: 0.0025, output: 0.01 },
    'gpt-4o-2024-11-20': { input: 0.0025, output: 0.01 },
    'gpt-4o-2024-05-13': { input: 0.005, output: 0.015 },

    // GPT-4o Audio Preview
    'gpt-4o-audio-preview-2024-12-17': { input: 0.0025, output: 0.01 },
    'gpt-4o-audio-preview-2025-06-03': { input: 0.0025, output: 0.01 },
    'gpt-4o-audio-preview-2024-10-01': { input: 0.0025, output: 0.01 },

    // GPT-4o Realtime Preview
    'gpt-4o-realtime-preview-2024-12-17': { input: 0.005, output: 0.02 },
    'gpt-4o-realtime-preview-2025-06-03': { input: 0.005, output: 0.02 },
    'gpt-4o-realtime-preview-2024-10-01': { input: 0.005, output: 0.02 },

    // GPT-4o Mini
    'gpt-4o-mini-2024-07-18': { input: 0.00015, output: 0.0006 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 }, // Latest alias

    // GPT-4o Mini Audio Preview
    'gpt-4o-mini-audio-preview-2024-12-17': { input: 0.00015, output: 0.0006 },

    // GPT-4o Mini Realtime Preview
    'gpt-4o-mini-realtime-preview-2024-12-17': { input: 0.0006, output: 0.0024 },

    // GPT-4o Search Preview
    'gpt-4o-search-preview-2025-03-11': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini-search-preview-2025-03-11': { input: 0.00015, output: 0.0006 },

    // O1 Series
    'o1-2024-12-17': { input: 0.015, output: 0.06 },
    'o1-preview-2024-09-12': { input: 0.015, output: 0.06 },
    'o1-mini-2024-09-12': { input: 0.0011, output: 0.0044 },

    // O1 Pro
    'o1-pro-2025-03-19': { input: 0.15, output: 0.6 },

    // O3 Series
    'o3-2025-04-16': { input: 0.002, output: 0.008 },
    'o3-mini-2025-01-31': { input: 0.0011, output: 0.0044 },
    'o3-pro-2025-06-10': { input: 0.02, output: 0.08 },

    // O4 Mini
    'o4-mini-2025-04-16': { input: 0.0011, output: 0.0044 },

    // Codex
    'codex-mini-latest': { input: 0.0015, output: 0.006 },

    // Computer Use Preview
    'computer-use-preview-2025-03-11': { input: 0.003, output: 0.012 },

    // GPT Image
    'gpt-image-1': { input: 0.005, output: null },

    // ChatGPT-4o Latest
    'chatgpt-4o-latest': { input: 0.005, output: 0.015 },

    // GPT-4 Turbo
    'gpt-4-turbo-2024-04-09': { input: 0.01, output: 0.03 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 }, // Latest alias
    'gpt-4-0125-preview': { input: 0.01, output: 0.03 },
    'gpt-4-1106-preview': { input: 0.01, output: 0.03 },
    'gpt-4-1106-vision-preview': { input: 0.01, output: 0.03 },

    // GPT-4 Original
    'gpt-4-0613': { input: 0.03, output: 0.06 },
    'gpt-4': { input: 0.03, output: 0.06 }, // Latest alias
    'gpt-4-0314': { input: 0.03, output: 0.06 },
    'gpt-4-32k': { input: 0.06, output: 0.12 },

    // GPT-3.5 Turbo
    'gpt-3.5-turbo-0125': { input: 0.0005, output: 0.0015 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 }, // Latest alias
    'gpt-3.5-turbo-1106': { input: 0.001, output: 0.002 },
    'gpt-3.5-turbo-0613': { input: 0.0015, output: 0.002 },
    'gpt-3.5-0301': { input: 0.0015, output: 0.002 },
    'gpt-3.5-turbo-instruct': { input: 0.0015, output: 0.002 },
    'gpt-3.5-turbo-16k-0613': { input: 0.003, output: 0.004 },
    'text-embedding-3-small': { input: 0.00002, output: null }, // Embedding model
    // // Davinci and Babbage
    // 'davinci-002': { input: 0.002, output: 0.002 },
    // 'babbage-002': { input: 0.0004, output: 0.0004 }
};


// Helper function to calculate cost
export const calculateCost = (modelName, inputTokens = 0, outputTokens = 0) => {
    const modelPricing = pricing[modelName];
    if (!modelPricing) {
        return { inputCost: 0, outputCost: 0, totalCost: 0 };
    }

    const inputCost = (inputTokens / 1000) * modelPricing.input;
    const outputCost = (outputTokens / 1000) * (modelPricing.output ?? 0);

    return {
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost,
    };
};
