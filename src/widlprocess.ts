import * as webidl2 from "webidl2";
import * as Browser from "./types";
import { getEmptyWebIDL } from "./helpers";

export function convert(text: string) {
    const rootTypes = webidl2.parse(text);
    const partialInterfaces: Browser.Interface[] = [];
    const browser = getEmptyWebIDL();
    for (const rootType of rootTypes) {
        if (rootType.type === "interface") {
            const converted = convertInterface(rootType);
            if (rootType.partial) {
                partialInterfaces.push(converted);
            }
            else {
                browser.interfaces!.interface[rootType.name] = converted;
            }
        }
        else if (rootType.type === "interface mixin") {
            browser["mixins"]!.mixin[rootType.name] = convertInterfaceMixin(rootType);
        }
        else if (rootType.type === "callback interface") {
            browser["callback-interfaces"]!.interface[rootType.name] = convertInterface(rootType);
        }
        else if (rootType.type === "callback") {
            browser["callback-functions"]!["callback-function"][rootType.name]
                = convertCallbackFunctions(rootType);
        }
        else if (rootType.type === "dictionary") {
            browser.dictionaries!.dictionary[rootType.name] = convertDictionary(rootType);
        }
        else if (rootType.type === "typedef") {
            browser.typedefs!.typedef.push(convertTypedef(rootType));
        }
    }
    return { browser, partialInterfaces };
}

function getExposure(extAttrs: webidl2.ExtendedAttributes[]) {
    for (const extAttr of extAttrs) {
        if (extAttr.name === "Exposed") {
            if (Array.isArray(extAttr.rhs.value)) {
                return extAttr.rhs.value.join(' ');
            }
            return extAttr.rhs.value;
        }
    }
    return "Window";
}

function convertInterface(i: webidl2.InterfaceType) {
    const result = convertInterfaceCommon(i);
    if (i.inheritance) {
        result.extends = i.inheritance;
    }
    return result;
}

function convertInterfaceMixin(i: webidl2.InterfaceMixinType) {
    const result = convertInterfaceCommon(i);
    result['no-interface-object'] = 1;
    return result;
}

function convertInterfaceCommon(i: webidl2.InterfaceType | webidl2.InterfaceMixinType) {
    const result: Browser.Interface = {
        name: i.name,
        extends: "Object",
        constants: { constant: {} },
        methods: { method: {} },
        properties: { property: {} },
        constructor: getConstructor(i.extAttrs, i.name), // TODO: implement this
        exposed: getExposure(i.extAttrs)
    };
    for (const member of i.members) {
        if (member.type === "const") {
            result.constants!.constant[member.name] = convertConstantMember(member);
        }
        else if (member.type === "attribute") {
            result.properties!.property[member.name] = convertAttribute(member);
        }
        else if (member.type === "operation" && member.name) {
            const operation = convertOperation(member);
            const { method } = result.methods;
            if (method[member.name]) {
                method[member.name].signature.push(...operation.signature);
            }
            else {
                method[member.name] = operation;
            }
        }
    }

    return result;
}

function getConstructor(extAttrs: webidl2.ExtendedAttributes[], parent: string) {
    const constructor: Browser.Constructor = {
        signature: []
    };
    for (const extAttr of extAttrs) {
        if (extAttr.name === "Constructor") {
            constructor.signature.push({
                type: parent,
                param: extAttr.arguments ? extAttr.arguments.map(convertArgument) : []
            });
        }
    }
    if (constructor.signature.length) {
        return constructor;
    }
}

function convertOperation(operation: webidl2.OperationMemberType): Browser.Method {
    if (!operation.name || !operation.idlType) {
        throw new Error("Unexpected anonymous operation");
    }
    return {
        name: operation.name,
        signature: [{
            ...convertIdlType(operation.idlType),
            param: operation.arguments.map(convertArgument)
        }],
        getter: operation.getter ? 1 : undefined,
        static: operation.static ? 1 : undefined,
        stringifier: operation.stringifier ? 1 : undefined,
    };
}

function convertCallbackFunctions(c: webidl2.CallbackType): Browser.CallbackFunction {
    return {
        name: c.name,
        callback: 1,
        signature: [{
            ...convertIdlType(c.idlType),
            param: c.arguments.map(convertArgument)
        }]
    }
}

function convertArgument(arg: webidl2.Argument): Browser.Param {
    return {
        name: arg.name,
        ...convertIdlType(arg.idlType),
        optional: arg.optional ? 1 : undefined,
        variadic: arg.variadic ? 1 : undefined,
    }
}

function convertAttribute(attribute: webidl2.AttributeMemberType): Browser.Property {
    return {
        name: attribute.name,
        ...convertIdlType(attribute.idlType),
        "read-only": attribute.readonly ? 1 : undefined
    }
}

function convertConstantMember(constant: webidl2.ConstantMemberType): Browser.Constant {
    return {
        name: constant.name,
        type: constant.idlType.idlType as string,
        value: convertConstantValue(constant.value)
    };
}

function convertConstantValue(value: webidl2.ValueDescription): string {
    switch (value.type) {
        case "string":
            return `"${value.value}"`;
        case "boolean":
        case "number":
        case "sequence":
            return `${value.value}`;
        case "null":
        case "NaN":
            return value.type;
        case "Infinity":
            return (value.negative ? '-' : '') + value.type;
        default:
            throw new Error("Not implemented");
    }
}

function convertDictionary(dictionary: webidl2.DictionaryType) {
    const result: Browser.Dictionary = {
        name: dictionary.name,
        extends: dictionary.inheritance || "Object",
        members: { member: {} }
    }
    for (const member of dictionary.members) {
        result.members.member[member.name] = convertDictionaryMember(member);
    }
    return result;
}

function convertDictionaryMember(member: webidl2.DictionaryMemberType): Browser.Member {
    return {
        name: member.name,
        default: member.default ? convertConstantValue(member.default) : undefined,
        ...convertIdlType(member.idlType)
    }
}

function convertTypedef(typedef: webidl2.TypedefType): Browser.TypeDef {
    return {
        "new-type": typedef.name,
        ...convertIdlType(typedef.idlType)
    }
}

function convertIdlType(i: webidl2.IDLTypeDescription): Browser.Typed {
    if (typeof i.idlType === "string") {
        return {
            type: i.idlType,
            nullable: i.nullable ? 1 : undefined
        };
    }
    if (i.generic) {
        return {
            type: i.generic,
            subtype: convertIdlType(i.idlType as webidl2.IDLTypeDescription),
            nullable: i.nullable ? 1 : undefined
        };
    }
    if (i.union) {
        return {
            type: (i.idlType as webidl2.IDLTypeDescription[]).map(convertIdlType),
            nullable: i.nullable ? 1 : undefined
        };
    }
    throw new Error("Unsupported IDL type structure");
}
