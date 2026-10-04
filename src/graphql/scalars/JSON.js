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
    if (value == null) return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (typeof value !== 'object') return value;
    if (seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => plain(item, seen));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item, seen)]));
};

export const JSONScalar = new GraphQLScalarType({
    name: 'JSON',
    description: 'Arbitrary JSON value',
    serialize: (value) => plain(value),
    parseValue: (value) => value,
    parseLiteral,
});
