"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPEC_TYPE_REGISTRY = void 0;
exports.inferPorts = inferPorts;
// Minimal registry of known spec node types and their port shapes.
// This is intentionally UI-focused and does not attempt to be a runtime contract.
exports.SPEC_TYPE_REGISTRY = {
    "langchain.agent": {
        type: "langchain.agent",
        ports: [
            { id: "input", direction: "input", kind: "data", label: "input" },
            { id: "llm", direction: "input", kind: "llm", label: "llm" },
            { id: "memory", direction: "input", kind: "memory", label: "memory" },
            { id: "tools", direction: "input", kind: "tool", label: "tools", multi: true },
            { id: "output", direction: "output", kind: "data", label: "output" },
        ],
    },
    "llm.model": {
        type: "llm.model",
        ports: [{ id: "llm", direction: "output", kind: "llm", label: "llm" }],
    },
    "memory.buffer": {
        type: "memory.buffer",
        ports: [{ id: "memory", direction: "output", kind: "memory", label: "memory" }],
    },
    "tool.example": {
        type: "tool.example",
        ports: [{ id: "tool", direction: "output", kind: "tool", label: "tool" }],
    },
    "parser.json": {
        type: "parser.json",
        ports: [{ id: "parser", direction: "output", kind: "parser", label: "parser" }],
    },
};
function inferPorts(input) {
    if (input.kind === "workflow") {
        return [{ id: "start", direction: "output", kind: "control", label: "start" }];
    }
    if (input.kind === "node") {
        return [
            { id: "input", direction: "input", kind: "data", label: "input" },
            { id: "output", direction: "output", kind: "data", label: "output" },
        ];
    }
    const type = input.nodeType;
    if (type && exports.SPEC_TYPE_REGISTRY[type]) {
        return exports.SPEC_TYPE_REGISTRY[type].ports;
    }
    // Unknown spec types still get a simple default shape.
    return [
        { id: "input", direction: "input", kind: "data", label: "input" },
        { id: "output", direction: "output", kind: "data", label: "output" },
    ];
}
