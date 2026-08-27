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
    const names = Object.keys(context);
    const values = Object.values(context);
    return new Function(...names, `return (${expression})`)(...values);
}
export const serializeBody = (body, contentType) => {
    switch (contentType?.toLowerCase()) {
        case "application/x-www-form-urlencoded": {
            const params = new URLSearchParams();

            Object.entries(body).forEach(([key, value]) => {
                if (value == null) return;

                params.append(
                    key,
                    typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)
                );
            });

            return params;
        }

        case "application/json":
        default:
            return body;
    }
}