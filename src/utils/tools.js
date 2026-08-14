import axios from "axios";
import { Conversation } from "../models/Conversations.js";
import pkg from 'lodash';
import 'dotenv/config'
export const populateStructure = (child, dataMap, parentPath = "") => {
    const result = []
    if (child.dataType == "object") child.childSchema.forEach(ele => result.push(...populateStructure(ele, dataMap, parentPath + "/" + child.key)))
    else {
        if (child.userDefined) {
            const obj = { ...child, fieldPath: parentPath + "/" + child.key }
            const value = dataMap.get(child.key);
            if (value !== undefined) obj.data = value || null;
            result.push(obj)
        }
    }
    return result
}
export const sessionFetcher = async (actionId, conversationId, fieldPath) => {
    try {
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return null;
        return conversation.session[actionId]?.[fieldPath]
    } catch (error) {
        console.log(error);
        return null;
    }
}
export const updateSession = async (conversationId, inputData) => {
    try {
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return null;
        const { actionId, collectedData } = inputData;
        conversation.session ??= {}; // Ensure session object exists
        conversation.session[actionId] ??= {}; // Ensure actionId entry exists
        collectedData.forEach(item => conversation.session[actionId][item.fieldPath] = item);
        await conversation.save();
    } catch (error) {
        console.log("Session save errored");
        console.log(error);
    }
}
export const generateMeetingUrl = (meetingName) => {
    // Clean up and format the meeting name for use in URL
    const cleanName = meetingName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    // Add random string for uniqueness
    const randomString = Math.random().toString(36).substring(2, 8);

    // Create a Jitsi Meet URL (completely free, no API keys needed)
    const roomName = `${cleanName}-${randomString}`;
    const meetingUrl = `https://meet.jit.si/${roomName}`;
    return meetingUrl
    // return {
    //     url: meetingUrl,
    //     provider: "Jitsi Meet",
    //     roomName: roomName
    // };
}
export const getLocation = async (latitude, longitude) => {
    try {
        const { data } = await axios.get(`https://us1.locationiq.com/v1/reverse?key=${process.env.LOCATIONIQ_API_KEY}&lat=${latitude}&lon=${longitude}&format=json`)
        const reqFields = { city: data.address.city || data.address.town || data.address.village, country_name: data.address.country, region: data.address.state, postal: data.address.postcode }
        return { latitude, longitude, ...data, ...reqFields }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error('Error status:', error.response?.status);
            console.error('Error at getLocation:', error.response?.data || error.message);
        } else {
            console.error('Unexpected error:', error);
        }
        return { latitude, longitude }
    }
}
export function createToolWrapper(toolDef) {
    const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
    const wrapperBody = `
        "use strict";
        ${toolDef.functionString}
    `;
    const errorFn = toolDef.errorFunction ? `
        "use strict";
        ${toolDef.errorFunction}
    `: null
    let toolSchema = {
        name: toolDef.name,
        description: toolDef.description,
        parameters: buildJSONSchema(toolDef.parameters),
        execute: toolDef.async ? new AsyncFunction('input', wrapperBody) : new Function('input', wrapperBody),
        strict: true,
        errorFunction: errorFn,
        needsApproval: toolDef.needsApproval
    }
    return toolSchema;
}
export function buildFollowUpButtons(followUps = []) {
    return {
        type: "button",
        body: {
            text: generateHeading()
        },
        action: {
            buttons: followUps.slice(0, 3).map((question, index) => ({
                type: "reply",
                reply: {
                    id: `followup_${index + 1}`,
                    title: truncate(question, 20)
                }
            }))
        }
    };
}
function truncate(text, maxLength) {
    return text.length <= maxLength ? text : text.slice(0, maxLength - 1) + "…";
}
function generateHeading() {
    const variants = [
        "Here are a few questions you can consider asking:",
        "You might want to follow up with:",
        "Try asking one of these next:",
        "Want to go deeper? Consider these:",
        "Some questions you could ask:"
    ];
    return variants[Math.floor(Math.random() * variants.length)];
}
export const knowledgeToolBaker = (collections) => {
    if (!collections || collections.length < 1) return null;
    const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
    const wrapperBody = `
        "use strict";
          if (!input.query || !input.options?.source || !Array.isArray(input.options?.source)) {
        throw new Error('Both "query" (string) and "source" (array) are required parameters');
    }
    if (input.query.trim().length < 3) {
        throw new Error('Query must be at least 3 characters long');
    }
    if (input.options.source.length < 1) {
        throw new Error('Source array must have at least one collection');
    }
    const response = await fetch('${process.env.SERVER_URL}fetch-from-db', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
        query: input.query,
        collections: input.options.source
    })
    });
    const data = await response.json();
    if (!data.success) {
        throw new Error(data.message || 'Knowledge base fetch failed');
    }
    return \`Answer from the knowledge base for query: "\${input.query}"\\n\\n\${data.data}\`;
    `;
    const errorFn = `
        "use strict";
    console.error('Knowledge fetch failed with input:', input);
    return 'I couldn\\'t retrieve the requested information.Please check your query and source.If the issue persists, try again later.';
    `
    let template = {
        name: "search_knowledge_base",
        description: "Searches the knowledge base using a query and optional source filters.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The text-based search query to retrieve relevant information from the existing vector database."
                },
                options: {
                    type: "object",
                    description: "Additional search parameters such as filtering by source cluster IDs.",
                    properties: {
                        source: {
                            type: "array",
                            description: "Array of knowledge base cluster IDs to narrow the search scope.",
                            items: { type: "string" },
                            default: collections
                        }
                    },
                    required: ["source"],
                    additionalProperties: false
                }
            },
            required: ["query", "options"],
            additionalProperties: false
        },
        execute: new AsyncFunction('input', wrapperBody),
        strict: true,
        errorFunction: errorFn,
        needsApproval: false
    }
    return template;
};
export const buildJSONSchema = (def) => {
    const schema = { description: def.description, type: def.dataType };
    if (def.title) schema.title = def.title
    if (def.examples) schema.examples = def.examples
    if (def.default !== undefined) schema.default = def.default;
    // Handle composition keywords
    if (def.allOf) schema.allOf = def.allOf.map(buildJSONSchema);
    if (def.oneOf) schema.oneOf = def.oneOf.map(buildJSONSchema);
    if (def.not) schema.not = buildJSONSchema(def.not);
    // Handle conditional schemas
    if (def.if) schema.if = buildJSONSchema(def.if);
    if (def.then) schema.then = buildJSONSchema(def.then);
    if (def.else) schema.else = buildJSONSchema(def.else);
    if (def.const !== undefined) {
        schema.const = def.const;
        return schema; // const doesn't need type
    }
    if (Array.isArray(def.dataType)) {
        schema.type = def.dataType;
        return schema;
    }
    switch (def.dataType) {
        case "string":
            if (def.pattern) schema.pattern = def.pattern
            if (["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"].includes(def.format)) schema.format = def.format
            if (def.minLength) schema.minLength = def.minLength
            if (def.maxLength) schema.maxLength = def.maxLength
            if (def.enum) schema.enum = def.enum
            break;
        case "number":
        case "integer":
            if (def.multipleOf) schema.multipleOf = def.multipleOf
            if (def.maximum) schema.maximum = def.maximum
            if (def.exclusiveMaximum) schema.exclusiveMaximum = def.exclusiveMaximum
            if (def.minimum) schema.minimum = def.minimum
            if (def.exclusiveMinimum) schema.exclusiveMinimum = def.exclusiveMinimum
            break;
        case "array":
            schema.items = (def.items) ? buildJSONSchema(def.items) : { type: null }
            if (def.minItems) schema.minItems = def.minItems
            if (def.maxItems) schema.maxItems = def.maxItems
            if (def.uniqueItems) schema.uniqueItems = def.uniqueItems
            break;
        case "object":
            schema.properties = {};
            schema.required = [];
            schema.additionalProperties = false;
            if (def.anyOf && Array.isArray(def.anyOf) && def.anyOf.length > 0) schema.anyOf = def.anyOf.map(buildJSONSchema);
            if (def.properties) {
                for (const [key, value] of Object.entries(def.properties)) {
                    const valuable = buildJSONSchema(value)
                    if (valuable) {
                        schema.properties[key] = valuable
                        schema.required.push(key)
                    };
                }
            }
            if (def.minProperties) schema.minProperties = def.minProperties
            if (def.maxProperties) schema.maxProperties = def.maxProperties
            // Handle pattern properties
            if (def.patternProperties) {
                schema.patternProperties = {};
                for (const [pattern, propDef] of Object.entries(def.patternProperties)) {
                    schema.patternProperties[pattern] = buildJSONSchema(propDef);
                }
            }
            if (Object.keys(schema.properties).length === 0 && (!schema.patternProperties || Object.keys(schema.patternProperties).length === 0)) return false;
        case "boolean":
            break;
        case "null":
            break;
        default: console.warn(`Unknown dataType: ${def.dataType}`, "def", JSON.stringify(def, null, 2));
            break;
    }
    return schema;
}

export const buildComponents = (parametersMap, data) => {
    return parametersMap.map(component => ({
        ...Object.fromEntries(
            Object.entries(component).filter(([k]) => k !== "parameters")
        ),
        parameters: component.parameters.map(path => ({
            type: path.type,
            parameter_name: path.parameter_name || null,
            [path.type]: evaluateData(path[path.type], data)
            // path[path.type].startsWith("{{") && path[path.type].endsWith("}}") ? pkg.get(data, path[path.type].slice(2, -2)) : path[path.type]
        }))
    }));
};
export const evaluateData = (data, context) => {
    //check if expression or not
    const isExpression = typeof data === "string" && data.startsWith("{{") && data.endsWith("}}")
    //if expression evalute
    if (isExpression) {
        const expression = data.slice(2, -2).trim();
        return evaluateExpression(expression, context);
    }
    else {
        if (data == null) {
            return data
        }
        if (Array.isArray(data)) {
            return data.map((v) => evaluateData(v, context));
        }
        else if (typeof data == "object") {
            return Object.keys(data).reduce((acc, curr) => { acc[curr] = evaluateData(data[curr], context); return acc }, {})
        }
        else {
            return data;
        }
    }
}
export const evaluateExpression = (expression, context) => {
    let result = pkg.get(context, expression);
    console.log(result, "result");
    return result;
}