const findComponent = (list, type, index) => {
    const matches = (list || []).filter((item) => String(item.type).toLowerCase() === type);
    if (index == null) return matches[0];
    const byIndex = matches.find((item) => item.index != null && String(item.index) === String(index));
    if (byIndex) return byIndex;
    if (matches.every((item) => item.index == null)) return matches[index];
    return undefined;
};

// WhatsApp displays currency.fallback_value and date_time.fallback_value.
const parameterText = (parameter) => {
    if (!parameter) return "";
    switch (parameter.type) {
        case "text": return parameter.text ?? "";
        case "currency": return parameter.currency?.fallback_value ?? "";
        case "date_time": return parameter.date_time?.fallback_value ?? "";
        case "coupon_code": return parameter.coupon_code ?? "";
        default: return "";
    }
};

// Named parameters ({{first_name}}) match parameter_name, in any order.
// Positional parameters ({{1}}) follow parameter order. parameter_name wins on the same token.
const fillPlaceholders = (text, parameters = []) => {
    if (!text) return "";
    const values = new Map();
    parameters.forEach((parameter, index) => {
        const textValue = parameterText(parameter);
        values.set(String(index + 1), textValue);
        if (parameter.parameter_name) values.set(String(parameter.parameter_name), textValue);
    });
    return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) => {
        const name = key.trim();
        return values.has(name) ? values.get(name) : match;
    });
};

const mediaParameter = (parameters, format) => {
    const kind = String(format || "").toLowerCase();
    return parameters.find((item) => item.type === kind)
        || parameters.find((item) => ["image", "video", "gif", "document"].includes(item.type))
        || parameters[0];
};

const renderHeader = (part, parameters = []) => {
    const format = String(part.format || (part.text ? "TEXT" : "")).toUpperCase();
    const rendered = { type: part.type, format: part.format || "TEXT" };
    if (format === "TEXT" || !part.format) {
        rendered.text = fillPlaceholders(part.text, parameters);
        return rendered;
    }
    if (format === "LOCATION") {
        const location = parameters.find((item) => item.type === "location")?.location;
        if (location) rendered.location = location;
        return rendered;
    }
    if (format === "PRODUCT") {
        const product = parameters.find((item) => item.type === "product")?.product;
        if (product) rendered.product = product;
        return rendered;
    }
    const parameter = mediaParameter(parameters, format);
    const media = parameter?.[parameter?.type];
    const url = media?.link || media?.id;
    if (url) rendered[format.toLowerCase()] = url;
    if (media?.filename) rendered.filename = media.filename;
    return rendered;
};

const renderButton = (button, parameters = []) => {
    const type = String(button.type || "").toUpperCase();
    const { example, ...rest } = button;
    const rendered = { ...rest };
    if (button.text) rendered.text = fillPlaceholders(button.text, parameters);
    if (button.url) rendered.url = fillPlaceholders(button.url, parameters);
    if (type === "COPY_CODE") {
        const code = parameters.find((item) => item.type === "coupon_code")?.coupon_code
            || parameters.find((item) => item.type === "text")?.text;
        if (code) rendered.coupon_code = code;
    }
    const action = parameters.find((item) => item.type === "action")?.action;
    if (action) rendered.action = action;
    const payload = parameters.find((item) => item.type === "payload")?.payload;
    if (payload) rendered.payload = payload;
    return rendered;
};

const authenticationBody = (part, parameters) => {
    const code = parameterText(parameters[0]) || "{{1}}";
    let text = `${code} is your verification code.`;
    if (part.add_security_recommendation) text += " For your security, do not share this code.";
    return text;
};

const renderBody = (part, parameters = []) => {
    const rendered = { type: part.type };
    if (part.add_security_recommendation != null) rendered.add_security_recommendation = part.add_security_recommendation;
    rendered.text = part.text ? fillPlaceholders(part.text, parameters) : authenticationBody(part, parameters);
    return rendered;
};

const renderFooter = (part) => {
    const rendered = { type: part.type };
    if (part.code_expiration_minutes != null) rendered.code_expiration_minutes = part.code_expiration_minutes;
    const text = part.text || (part.code_expiration_minutes != null ? `This code expires in ${part.code_expiration_minutes} minutes.` : "");
    if (text) rendered.text = text;
    return rendered;
};

const renderComponents = (parts, sent) => (parts || []).map((part) => {
    const type = String(part.type || "").toUpperCase();
    if (type === "HEADER") return renderHeader(part, findComponent(sent, "header")?.parameters || []);
    if (type === "BODY") return renderBody(part, findComponent(sent, "body")?.parameters || []);
    if (type === "FOOTER") return renderFooter(part);
    if (type === "BUTTONS") {
        return {
            type: part.type,
            buttons: (part.buttons || []).map((button, index) => renderButton(button, findComponent(sent, "button", index)?.parameters || [])),
        };
    }
    if (type === "LIMITED_TIME_OFFER") {
        const expiration = findComponent(sent, "limited_time_offer")?.parameters?.find((item) => item.type === "limited_time_offer")?.limited_time_offer;
        const offer = { ...(part.limited_time_offer || {}) };
        if (expiration?.expiration_time_ms != null) offer.expiration_time_ms = expiration.expiration_time_ms;
        return { type: part.type, limited_time_offer: offer };
    }
    if (type === "CAROUSEL") {
        const sentCards = findComponent(sent, "carousel")?.cards || [];
        return {
            type: part.type,
            cards: (part.cards || []).map((card, index) => {
                const sentCard = sentCards.find((item) => Number(item.card_index) === index) || sentCards[index];
                return { components: renderComponents(card.components, sentCard?.components || []) };
            }),
        };
    }
    return part;
});

export const constructWhatsappMessageFromTemplate = (templateParts, componentParts) => {
    const parts = Array.isArray(templateParts) ? templateParts : templateParts?.components || [];
    return renderComponents(parts, componentParts || []);
};
