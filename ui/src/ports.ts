export type PortDirection = "input" | "output";
export type PortKind = "data" | "llm" | "memory" | "tool" | "parser" | "control";

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
};

// Minimal registry of known spec node types and their port shapes.
// This is intentionally UI-focused and does not attempt to be a runtime contract.
export const SPEC_TYPE_REGISTRY: Record<string, SpecTypeRegistryEntry> = {
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

export function inferPorts(input: { kind: "node" | "workflow" | "spec"; nodeType?: string | undefined }): PortSpec[] {
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
  if (type && SPEC_TYPE_REGISTRY[type]) {
    return SPEC_TYPE_REGISTRY[type].ports;
  }

  // Unknown spec types still get a simple default shape.
  return [
    { id: "input", direction: "input", kind: "data", label: "input" },
    { id: "output", direction: "output", kind: "data", label: "output" },
  ];
}
