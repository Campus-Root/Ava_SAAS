const compact = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value != null && value !== ""));

const findComponent = (list, type, index) => {
    const matches = (list || []).filter((item) => String(item.type).toLowerCase() === type);
    if (index == null) return matches[0];
    const byIndex = matches.find((item) => item.index != null && String(item.index) === String(index));
    if (byIndex) return byIndex;
    if (matches.every((item) => item.index == null)) return matches[index];
    return undefined;
};

// WhatsApp displays currency.fallback_value and date_time.fallback_value.
// coupon_code is the copy-code button value. payload is a quick-reply webhook value.
const parameterText = (parameter) => {
    if (!parameter) return "";
    switch (parameter.type) {
        case "text": return parameter.text ?? "";
        case "currency": return parameter.currency?.fallback_value ?? "";
        case "date_time": return parameter.date_time?.fallback_value ?? "";
        case "coupon_code": return parameter.coupon_code ?? "";
        case "payload": return parameter.payload ?? "";
        default: return "";
    }
};

// Named parameters ({{first_name}}) can arrive in any order and are matched on parameter_name.
// Positional parameters ({{1}}) follow parameter order. A parameter_name wins when both refer to the same token.
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

const headerFrom = (part, parameters = []) => {
    const format = String(part.format || (part.text ? "TEXT" : "")).toUpperCase();
    if (format === "TEXT" || !format) {
        return compact({ format: "TEXT", text: fillPlaceholders(part.text, parameters) });
    }
    if (format === "LOCATION") {
        const parameter = parameters.find((item) => item.type === "location") || parameters[0];
        return compact({ format, location: parameter?.location || null });
    }
    if (format === "PRODUCT") {
        const parameter = parameters.find((item) => item.type === "product") || parameters[0];
        return compact({ format, product: parameter?.product || null });
    }
    const parameter = parameters.find((item) => item.type === format.toLowerCase())
        || parameters.find((item) => ["image", "video", "gif", "document"].includes(item.type))
        || parameters[0];
    const media = parameter?.[parameter?.type];
    return compact({
        format,
        link: media?.link,
        id: media?.id,
        filename: media?.filename,
    });
};

const buttonFrom = (button, parameters = []) => {
    const type = String(button.type || "").toUpperCase();
    const payload = parameters.find((item) => item.type === "payload")?.payload;
    const code = parameters.find((item) => item.type === "coupon_code")?.coupon_code
        || (type === "COPY_CODE" || type === "OTP" ? parameters.find((item) => item.type === "text")?.text : undefined);
    const action = parameters.find((item) => item.type === "action")?.action;
    return compact({
        type,
        text: fillPlaceholders(button.text, parameters) || (type === "COPY_CODE" ? "Copy code" : undefined),
        url: button.url ? fillPlaceholders(button.url, parameters) : undefined,
        phone_number: button.phone_number,
        payload,
        code,
        otp_type: button.otp_type,
        autofill_text: button.autofill_text,
        flow_id: button.flow_id,
        flow_action: button.flow_action,
        navigate_screen: button.navigate_screen,
        ttl_minutes: button.ttl_minutes,
        action,
    });
};

const buttonsFrom = (buttons = [], componentParts = []) => (buttons || []).map((button, index) => {
    const sent = findComponent(componentParts, "button", index);
    return buttonFrom(button, sent?.parameters || []);
});

const authenticationBody = (part, parameters) => {
    const code = parameterText(parameters[0]) || "{{1}}";
    let text = `${code} is your verification code.`;
    if (part.add_security_recommendation) text += " For your security, do not share this code.";
    return text;
};

const footerFrom = (part) => {
    if (part.text) return part.text;
    if (part.code_expiration_minutes != null) return `This code expires in ${part.code_expiration_minutes} minutes.`;
    return "";
};

const cardFrom = (card, sentCard) => {
    const sentParts = sentCard?.components || [];
    const rendered = { header: null, body: "", buttons: [] };
    for (const part of card.components || []) {
        const type = String(part.type || "").toUpperCase();
        if (type === "HEADER") rendered.header = headerFrom(part, findComponent(sentParts, "header")?.parameters || []);
        else if (type === "BODY") rendered.body = fillPlaceholders(part.text, findComponent(sentParts, "body")?.parameters || []);
        else if (type === "BUTTONS") rendered.buttons = buttonsFrom(part.buttons, sentParts);
    }
    return rendered;
};

export const constructWhatsappMessageFromTemplate = (templateParts, componentParts) => {
    const parts = Array.isArray(templateParts) ? templateParts : templateParts?.components || [];
    const sent = componentParts || [];
    const message = { header: null, body: "", footer: "", limitedTimeOffer: null, buttons: [], cards: [] };

    for (const part of parts) {
        const type = String(part.type || "").toUpperCase();
        if (type === "HEADER") {
            message.header = headerFrom(part, findComponent(sent, "header")?.parameters || []);
        } else if (type === "BODY") {
            const parameters = findComponent(sent, "body")?.parameters || [];
            message.body = part.text ? fillPlaceholders(part.text, parameters) : authenticationBody(part, parameters);
        } else if (type === "FOOTER") {
            message.footer = footerFrom(part);
        } else if (type === "BUTTONS") {
            message.buttons = buttonsFrom(part.buttons, sent);
        } else if (type === "LIMITED_TIME_OFFER") {
            const offer = findComponent(sent, "limited_time_offer");
            const expiration = offer?.parameters?.find((item) => item.type === "limited_time_offer")?.limited_time_offer;
            message.limitedTimeOffer = compact({
                text: part.limited_time_offer?.text || part.text || "",
                hasExpiration: part.limited_time_offer?.has_expiration ?? null,
                expirationTimeMs: expiration?.expiration_time_ms,
            });
        } else if (type === "CAROUSEL") {
            const sentCarousel = findComponent(sent, "carousel");
            const sentCards = sentCarousel?.cards || [];
            message.cards = (part.cards || []).map((card, index) => {
                const sentCard = sentCards.find((item) => Number(item.card_index) === index) || sentCards[index];
                return cardFrom(card, sentCard);
            });
        }
    }

    if (!message.limitedTimeOffer) delete message.limitedTimeOffer;
    if (!message.cards.length) delete message.cards;
    if (!message.footer) delete message.footer;
    return message;
};
