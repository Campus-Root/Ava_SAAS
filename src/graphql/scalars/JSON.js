import { GraphQLScalarType, Kind } from 'graphql';

const parseLiteral = (ast) => {
    switch (ast.kind) {
        case Kind.STRING:
        case Kind.BOOLEAN:
            return ast.value;
        case Kind.INT:
        case Kind.FLOAT:
            return Number(ast.value);
        case Kind.NULL:
            return null;
        case Kind.LIST:
            return ast.values.map(parseLiteral);
        case Kind.OBJECT:
            return Object.fromEntries(ast.fields.map((field) => [field.name.value, parseLiteral(field.value)]));
        default:
            return null;
    }
};

const plain = (value, seen = new WeakSet()) => {
    if (value == null || typeof value !== 'object') return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (seen.has(value)) return null;
    seen.add(value);
    // Mongoose documents enumerate $__, $__parent, and _doc. Read the stored value first
    // so a JSON field does not include the parent document.
    const source = typeof value.toObject === 'function' ? value.toObject({ virtuals: false }) : value;
    if (Array.isArray(source)) return source.map((item) => plain(item, seen));
    if (source == null || typeof source !== 'object') return source;
    if (source !== value) {
        if (seen.has(source)) return null;
        seen.add(source);
    }
    return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, plain(item, seen)]));
};

export const JSONScalar = new GraphQLScalarType({
    name: 'JSON',
    description: 'Arbitrary JSON value',
    serialize: (value) => plain(value),
    parseValue: (value) => value,
    parseLiteral,
});
