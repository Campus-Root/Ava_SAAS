import 'dotenv/config'
export const buildComponents = (parametersMap, data) => {
    return parametersMap.map(component => ({
        ...Object.fromEntries(
            Object.entries(component).filter(([k]) => k !== "parameters")
        ),
        parameters: component.parameters.map(path => ({
            type: path.type,
            parameter_name: path.parameter_name || null,
            [path.type]: evaluateData(path[path.type], data)
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
export const evaluateExpression = (expression, context = {}) => {
    try {
        const names = Object.keys(context);
        const values = Object.values(context);
        return new Function(...names, `"use strict"; return (${expression});`)(...values);
    } catch (error) {
        console.error("Expression error:", expression, error);
        return undefined;
    }
}