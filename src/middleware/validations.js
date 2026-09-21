
import { GraphQLError } from "graphql";
import { LeadTemplate } from '@avakado.ai/schemas';
export const validateLeadDataCore = async (templateId, data) => {
    // Fetch template
    const template = await LeadTemplate.findById(templateId);
    if (!template) throw new GraphQLError('Template not found', { extensions: { code: "BAD_USER_INPUT" } });
    if (!template.isActive) throw new GraphQLError('Template is not active', { extensions: { code: "BAD_USER_INPUT" } });

    // Validate each field according to template
    const errors = [];
    const validatedData = new Map();
    for (const field of template.fields) {
        const fieldValue = data[field.name];
        // Check required fields
        if (field.required && (fieldValue === undefined || fieldValue === null || fieldValue === '')) {
            errors.push(`${field.label} (${field.name}) is required`);
            continue;
        }
        // Use default value if field is empty and has default
        let value = fieldValue;
        if ((value === undefined || value === null || value === '') && field.defaultValue !== null) value = field.defaultValue;
        // Type validation
        if (value !== undefined && value !== null && value !== '') {
            switch (field.type) {
                case 'string':
                case 'text':
                    if (typeof value !== 'string') {
                        errors.push(`${field.label} must be a string`);
                        continue;
                    }
                    if (field.validation) {
                        if (field.validation.minLength && value.length < field.validation.minLength) errors.push(`${field.label} must be at least ${field.validation.minLength} characters`);
                        if (field.validation.maxLength && value.length > field.validation.maxLength) errors.push(`${field.label} must be at most ${field.validation.maxLength} characters`);
                        if (field.validation.pattern) {
                            const regex = new RegExp(field.validation.pattern);
                            if (!regex.test(value)) errors.push(`${field.label} format is invalid`);
                        }
                        if (field.validation.enum && !field.validation.enum.includes(value)) errors.push(`${field.label} must be one of: ${field.validation.enum.join(', ')}`);
                    }
                    break;
                case 'number':
                    const numValue = Number(value);
                    if (isNaN(numValue)) {
                        errors.push(`${field.label} must be a number`);
                        continue;
                    }
                    if (field.validation) {
                        if (field.validation.min !== undefined && numValue < field.validation.min) errors.push(`${field.label} must be at least ${field.validation.min}`);
                        if (field.validation.max !== undefined && numValue > field.validation.max) errors.push(`${field.label} must be at most ${field.validation.max}`);
                    }
                    value = numValue;
                    break;
                case 'email':
                    if (typeof value !== 'string') {
                        errors.push(`${field.label} must be a string`);
                        continue;
                    }
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(value)) errors.push(`${field.label} must be a valid email address`);
                    break;

                case 'phone':
                    if (typeof value !== 'string') {
                        errors.push(`${field.label} must be a string`);
                        continue;
                    }
                    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
                    if (!phoneRegex.test(value)) errors.push(`${field.label} must be a valid phone number`);
                    break;

                case 'date':
                    const dateValue = new Date(value);
                    if (isNaN(dateValue.getTime())) {
                        errors.push(`${field.label} must be a valid date`);
                        continue;
                    }
                    value = dateValue;
                    break;

                case 'boolean':
                    if (typeof value !== 'boolean') (value === 'true' || value === '1') ? value = true : (value === 'false' || value === '0') ? value = false : errors.push(`${field.label} must be a boolean`);
                    break;
                case 'url':
                    if (typeof value !== 'string') {
                        errors.push(`${field.label} must be a string`);
                        continue;
                    }
                    try {
                        new URL(value);
                    } catch {
                        errors.push(`${field.label} must be a valid URL`);
                    }
                    break;
            }
        }
        // Store validated value
        validatedData.set(field.name, value);
    }
    // Check for extra fields not in template
    const templateFieldNames = template.fields.map(f => f.name);
    const extraFields = Object.keys(data).filter(key => !templateFieldNames.includes(key));
    if (extraFields.length > 0) errors.push(`Unknown fields: ${extraFields.join(', ')}`);
    if (errors.length > 0) throw new GraphQLError('Validation failed', { extensions: { code: "BAD_USER_INPUT", errors: errors } });
    // Convert Map to plain object for MongoDB storage
    const validatedDataObject = {};
    validatedData.forEach((value, key) => { validatedDataObject[key] = value; });
    return { validatedData: validatedDataObject, template };
};
