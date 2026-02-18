export type PortDirection = "input" | "output";
export type PortKind = "data" | "llm" | "memory" | "tool" | "parser" | "control" | "response";
export type NodeConnectionRole = "flow" | "provider";

export type PortSpec = {
  id: string;
  direction: PortDirection;
  kind?: PortKind;
  label?: string;
  multi?: boolean;
};

export type SpecTypeRegistryEntry = {
  type: string;
  ports: PortSpec[];
  connectionRole?: NodeConnectionRole;
};

// Minimal registry of known spec node types and their port shapes.
// This is intentionally UI-focused and does not attempt to be a runtime contract.
export const SPEC_TYPE_REGISTRY: Record<string, SpecTypeRegistryEntry> = {
  "langchain.agent": {
    type: "langchain.agent",
    ports: [
      { id: "input", direction: "input", kind: "data", label: "Input" },
      { id: "llm", direction: "input", kind: "llm", label: "LLM" },
      { id: "memory", direction: "input", kind: "memory", label: "Memory" },
      { id: "tools", direction: "input", kind: "tool", label: "Tools", multi: true },
      { id: "parser", direction: "input", kind: "parser", label: "Structured Output" },
      { id: "output", direction: "output", kind: "data", label: "Output" },
    ],
  },
  // Alias for manual inputs or label mismatches
  "Langchain Agent": {
    type: "langchain.agent",
    ports: [
      { id: "input", direction: "input", kind: "data", label: "Input" },
      { id: "llm", direction: "input", kind: "llm", label: "LLM" },
      { id: "memory", direction: "input", kind: "memory", label: "Memory" },
      { id: "tools", direction: "input", kind: "tool", label: "Tools", multi: true },
      { id: "parser", direction: "input", kind: "parser", label: "Structured Output" },
      { id: "output", direction: "output", kind: "data", label: "Output" },
    ],
  },
  "llm.model": {
    type: "llm.model",
    ports: [{ id: "output", direction: "output", kind: "llm", label: "LLM" }],
    connectionRole: "provider",
  },
  "memory.buffer": {
    type: "memory.buffer",
    ports: [{ id: "memory", direction: "output", kind: "memory", label: "memory" }],
    connectionRole: "provider",
  },
  "langchain.memory.buffer": {
    type: "langchain.memory.buffer",
    ports: [{ id: "memory", direction: "output", kind: "memory", label: "memory" }],
    connectionRole: "provider",
  },
  "tool.function": {
    type: "tool.function",
    ports: [{ id: "tool", direction: "output", kind: "tool", label: "tool" }],
    connectionRole: "provider",
  },
  "langchain.tool": {
    type: "langchain.tool",
    ports: [{ id: "tool", direction: "output", kind: "tool", label: "tool" }],
    connectionRole: "provider",
  },
  "tool.example": {
    type: "tool.example",
    ports: [{ id: "tool", direction: "output", kind: "tool", label: "tool" }],
    connectionRole: "provider",
  },
  "parser.json": {
    type: "parser.json",
    ports: [{ id: "parser", direction: "output", kind: "parser", label: "parser" }],
  },
  "parser.structured": {
    type: "parser.structured",
    ports: [{ id: "output", direction: "output", kind: "parser", label: "Structured Output" }],
    connectionRole: "provider",
  },
  "logic.switch": {
    type: "logic.switch",
    ports: [
      { id: "input", direction: "input", kind: "data", label: "Input" },
      { id: "out_0", direction: "output", kind: "data", label: "Branch 0" },
      { id: "out_1", direction: "output", kind: "data", label: "Branch 1" },
      { id: "out_2", direction: "output", kind: "data", label: "Branch 2" },
      { id: "out_3", direction: "output", kind: "data", label: "Branch 3" },
      { id: "out_4", direction: "output", kind: "data", label: "Branch 4" },
      { id: "out_5", direction: "output", kind: "data", label: "Branch 5" },
      { id: "out_6", direction: "output", kind: "data", label: "Branch 6" },
      { id: "out_7", direction: "output", kind: "data", label: "Branch 7" },
      { id: "out_8", direction: "output", kind: "data", label: "Branch 8" },
      { id: "out_9", direction: "output", kind: "data", label: "Branch 9" },
      { id: "out_fallback", direction: "output", kind: "data", label: "Fallback" },
    ],
  },
  "code.python": {
    type: "code.python",
    ports: [
      { id: "input", direction: "input", kind: "data", label: "Input" },
      { id: "output", direction: "output", kind: "data", label: "Output" },
    ],
  },
  "http.request": {
    type: "http.request",
    ports: [
      { id: "input", direction: "input", kind: "data", label: "Input" },
      { id: "output", direction: "output", kind: "data", label: "Output" },
    ],
  },
  "trigger.manual": {
    type: "trigger.manual",
    ports: [{ id: "start", direction: "output", kind: "data", label: "start" }],
  },
  "trigger.chat": {
    type: "trigger.chat",
    ports: [
      { id: "response", direction: "input", kind: "response", label: "↩ Response", multi: true },
      { id: "out", direction: "output", kind: "data", label: "Message" },
    ],
  },
};

export function inferPorts(input: { kind: "spec" | "inline_code"; nodeType?: string | undefined }): PortSpec[] {
  const type = input.nodeType;
  if (type && SPEC_TYPE_REGISTRY[type]) {
    return SPEC_TYPE_REGISTRY[type].ports;
  }

  // Unknown spec types still get a simple default shape.
  return [
    { id: "input", direction: "input", kind: "data", label: "input" },
    { id: "output", direction: "output", kind: "data", label: "output" },
  ];
}

export function getNodeConnectionRole(nodeType?: string | null): NodeConnectionRole {
  if (!nodeType) {
    return "flow";
  }

  const fromRegistry = SPEC_TYPE_REGISTRY[nodeType]?.connectionRole;
  if (fromRegistry) {
    return fromRegistry;
  }

  if (
    nodeType === "llm.model" ||
    nodeType.startsWith("memory.") ||
    nodeType.startsWith("langchain.memory") ||
    nodeType.startsWith("tool.") ||
    nodeType.startsWith("langchain.tool")
  ) {
    return "provider";
  }

  return "flow";
}
