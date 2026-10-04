import { openai } from "@avakado.ai/providers";

export { openai };

export const OpenAiLLM = async ({ input = [], model = "gpt-4o-mini", text = {} }) => {
    try {
        const response = await openai.responses.parse({
            model,
            input,
            text,
        });
        return response;
    } catch (error) {
        console.error(error);
        return null;
    }
};
