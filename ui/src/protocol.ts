import { z } from "zod";

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const HolonKindSchema = z.union([z.literal("node"), z.literal("workflow"), z.literal("spec")]);

export const PortDirectionSchema = z.union([z.literal("input"), z.literal("output")]);

export const PortKindSchema = z.union([
  z.literal("data"),
  z.literal("llm"),
  z.literal("memory"),
  z.literal("tool"),
  z.literal("parser"),
  z.literal("control"),
]);

export const PortSpecSchema = z.object({
  id: z.string(),
  direction: PortDirectionSchema,
  kind: PortKindSchema.nullable().optional(),
  label: z.string().nullable().optional(),
  multi: z.boolean().nullable().optional(),
});

export const CoreNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: HolonKindSchema,
  position: PositionSchema.nullable().optional(),
  label: z.string().nullable().optional(),
  nodeType: z.string().nullable().optional(),
  props: z.record(z.unknown()).nullable().optional(),
  summary: z.string().nullable().optional(),
  badges: z.array(z.string()).nullable().optional(),
  ports: z.array(PortSpecSchema).nullable().optional(),
});

export type CoreNode = z.infer<typeof CoreNodeSchema>;

export const CoreEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  sourcePort: z.string().nullable().optional(),
  targetPort: z.string().nullable().optional(),
  kind: z.union([z.literal("code"), z.literal("link")]).nullable().optional(),
});

export type CoreEdge = z.infer<typeof CoreEdgeSchema>;

export const CoreGraphSchema = z.object({
  nodes: z.array(CoreNodeSchema),
  edges: z.array(CoreEdgeSchema),
});

export type CoreGraph = z.infer<typeof CoreGraphSchema>;

export const GraphInitSchema = z.object({
  type: z.literal("graph.init"),
  nodes: z.array(CoreNodeSchema),
  edges: z.array(CoreEdgeSchema),
});

export const GraphUpdateSchema = z.object({
  type: z.literal("graph.update"),
  nodes: z.array(CoreNodeSchema),
  edges: z.array(CoreEdgeSchema),
});

export const GraphErrorSchema = z.object({
  type: z.literal("graph.error"),
  error: z.string(),
});

export const AiStatusSchema = z.object({
  type: z.literal("ai.status"),
  nodeId: z.string(),
  status: z.union([z.literal("idle"), z.literal("working"), z.literal("error"), z.literal("done")]),
  message: z.string().optional(),
});

export const AiPromptSchema = z.object({
  type: z.literal("ai.prompt"),
  nodeId: z.string(),
  title: z.string(),
  prompt: z.string(),
});

export const CredentialsUpdateSchema = z.object({
  type: z.literal("credentials.update"),
  credentials: z.record(z.record(z.string())),
});

export const WorkflowExecutionResultSchema = z.object({
  type: z.literal("workflow.executionResult"),
  output: z.record(z.any()),
});

export const ExecutionOutputSchema = z.object({
  type: z.literal("execution.output"),
  output: z.record(z.unknown()),
});

export const ToUiMessageSchema = z.union([
  GraphInitSchema,
  GraphUpdateSchema,
  GraphErrorSchema,
  AiStatusSchema,
  AiPromptSchema,
  CredentialsUpdateSchema,
  WorkflowExecutionResultSchema,
  ExecutionOutputSchema,
]);
export type ToUiMessage = z.infer<typeof ToUiMessageSchema>;

export const UiReadySchema = z.object({
  type: z.literal("ui.ready"),
});

export const UiNodesChangedSchema = z.object({
  type: z.literal("ui.nodesChanged"),
  nodes: z.array(
    z.object({
      id: z.string(),
      position: PositionSchema,
    })
  ),
});

export const UiNodeAiRequestSchema = z.object({
  type: z.literal("ui.node.aiRequest"),
  nodeId: z.string(),
  instruction: z.string(),
});

export const UiNodeDescribeRequestSchema = z.object({
  type: z.literal("ui.node.describeRequest"),
  nodeId: z.string(),
});

export const UiNodeDeleteRequestSchema = z.object({
  type: z.literal("ui.node.deleteRequest"),
  nodeId: z.string(),
});

export const UiNodePatchRequestSchema = z.object({
  type: z.literal("ui.node.patchRequest"),
  nodeId: z.string(),
  props: z.record(z.unknown()).optional(),
  label: z.string().optional(),
});

export const UiEdgeCreatedSchema = z.object({
  type: z.literal("ui.edgeCreated"),
  edge: z.object({
    source: z.string(),
    target: z.string(),
    sourcePort: z.string().nullable().optional(),
    targetPort: z.string().nullable().optional(),
  }),
});

export const UiNodeCreatedSchema = z.object({
  type: z.literal("ui.nodeCreated"),
  node: z.object({
    id: z.string(),
    type: z.string(),
    label: z.string(),
    inputs: z
      .array(z.object({ id: z.string(), kind: PortKindSchema.optional(), label: z.string().optional(), multi: z.boolean().optional() }))
      .optional()
      .default([]),
    outputs: z
      .array(z.object({ id: z.string(), kind: PortKindSchema.optional(), label: z.string().optional(), multi: z.boolean().optional() }))
      .optional()
      .default([]),
    props: z.record(z.unknown()).optional(),
  }),
  position: PositionSchema.optional(),
});

export const UiCredentialsRequestSchema = z.object({
  type: z.literal("ui.credentials.set"),
  provider: z.string(),
  credentials: z.record(z.string()),
});

export const UiWorkflowRunSchema = z.object({
  type: z.literal("ui.workflow.run"),
  workflowName: z.string(),
});

export const ToExtensionMessageSchema = z.union([
  UiReadySchema,
  UiNodesChangedSchema,
  UiNodeAiRequestSchema,
  UiNodeDescribeRequestSchema,
  UiNodeDeleteRequestSchema,
  UiNodePatchRequestSchema,
  UiEdgeCreatedSchema,
  UiNodeCreatedSchema,
  UiCredentialsRequestSchema,
  UiWorkflowRunSchema,
]);
export type ToExtensionMessage = z.infer<typeof ToExtensionMessageSchema>;
