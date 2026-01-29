"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToExtensionMessageSchema = exports.UiCredentialsRequestSchema = exports.UiNodeCreatedSchema = exports.UiEdgeCreatedSchema = exports.UiNodePatchRequestSchema = exports.UiNodeDeleteRequestSchema = exports.UiNodeDescribeRequestSchema = exports.UiNodeAiRequestSchema = exports.UiNodesChangedSchema = exports.UiReadySchema = exports.ToUiMessageSchema = exports.CredentialsUpdateSchema = exports.AiPromptSchema = exports.AiStatusSchema = exports.GraphErrorSchema = exports.GraphUpdateSchema = exports.GraphInitSchema = exports.CoreGraphSchema = exports.CoreEdgeSchema = exports.CoreNodeSchema = exports.PortSpecSchema = exports.PortKindSchema = exports.PortDirectionSchema = exports.HolonKindSchema = exports.PositionSchema = void 0;
const zod_1 = require("zod");
exports.PositionSchema = zod_1.z.object({
    x: zod_1.z.number(),
    y: zod_1.z.number(),
});
exports.HolonKindSchema = zod_1.z.union([zod_1.z.literal("node"), zod_1.z.literal("workflow"), zod_1.z.literal("spec")]);
exports.PortDirectionSchema = zod_1.z.union([zod_1.z.literal("input"), zod_1.z.literal("output")]);
exports.PortKindSchema = zod_1.z.union([
    zod_1.z.literal("data"),
    zod_1.z.literal("llm"),
    zod_1.z.literal("memory"),
    zod_1.z.literal("tool"),
    zod_1.z.literal("parser"),
    zod_1.z.literal("control"),
]);
exports.PortSpecSchema = zod_1.z.object({
    id: zod_1.z.string(),
    direction: exports.PortDirectionSchema,
    kind: exports.PortKindSchema.nullable().optional(),
    label: zod_1.z.string().nullable().optional(),
    multi: zod_1.z.boolean().nullable().optional(),
});
exports.CoreNodeSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    kind: exports.HolonKindSchema,
    position: exports.PositionSchema.nullable().optional(),
    label: zod_1.z.string().nullable().optional(),
    nodeType: zod_1.z.string().nullable().optional(),
    props: zod_1.z.record(zod_1.z.unknown()).nullable().optional(),
    summary: zod_1.z.string().nullable().optional(),
    badges: zod_1.z.array(zod_1.z.string()).nullable().optional(),
    ports: zod_1.z.array(exports.PortSpecSchema).nullable().optional(),
});
exports.CoreEdgeSchema = zod_1.z.object({
    source: zod_1.z.string(),
    target: zod_1.z.string(),
    sourcePort: zod_1.z.string().nullable().optional(),
    targetPort: zod_1.z.string().nullable().optional(),
    kind: zod_1.z.union([zod_1.z.literal("code"), zod_1.z.literal("link")]).nullable().optional(),
});
exports.CoreGraphSchema = zod_1.z.object({
    nodes: zod_1.z.array(exports.CoreNodeSchema),
    edges: zod_1.z.array(exports.CoreEdgeSchema),
});
exports.GraphInitSchema = zod_1.z.object({
    type: zod_1.z.literal("graph.init"),
    nodes: zod_1.z.array(exports.CoreNodeSchema),
    edges: zod_1.z.array(exports.CoreEdgeSchema),
});
exports.GraphUpdateSchema = zod_1.z.object({
    type: zod_1.z.literal("graph.update"),
    nodes: zod_1.z.array(exports.CoreNodeSchema),
    edges: zod_1.z.array(exports.CoreEdgeSchema),
});
exports.GraphErrorSchema = zod_1.z.object({
    type: zod_1.z.literal("graph.error"),
    error: zod_1.z.string(),
});
exports.AiStatusSchema = zod_1.z.object({
    type: zod_1.z.literal("ai.status"),
    nodeId: zod_1.z.string(),
    status: zod_1.z.union([zod_1.z.literal("idle"), zod_1.z.literal("working"), zod_1.z.literal("error"), zod_1.z.literal("done")]),
    message: zod_1.z.string().optional(),
});
exports.AiPromptSchema = zod_1.z.object({
    type: zod_1.z.literal("ai.prompt"),
    nodeId: zod_1.z.string(),
    title: zod_1.z.string(),
    prompt: zod_1.z.string(),
});
exports.CredentialsUpdateSchema = zod_1.z.object({
    type: zod_1.z.literal("credentials.update"),
    credentials: zod_1.z.record(zod_1.z.record(zod_1.z.string())),
});
exports.ToUiMessageSchema = zod_1.z.union([
    exports.GraphInitSchema,
    exports.GraphUpdateSchema,
    exports.GraphErrorSchema,
    exports.AiStatusSchema,
    exports.AiPromptSchema,
    exports.CredentialsUpdateSchema,
]);
exports.UiReadySchema = zod_1.z.object({
    type: zod_1.z.literal("ui.ready"),
});
exports.UiNodesChangedSchema = zod_1.z.object({
    type: zod_1.z.literal("ui.nodesChanged"),
    nodes: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string(),
        position: exports.PositionSchema,
    })),
});
exports.UiNodeAiRequestSchema = zod_1.z.object({
    type: zod_1.z.literal("ui.node.aiRequest"),
    nodeId: zod_1.z.string(),
    instruction: zod_1.z.string(),
});
exports.UiNodeDescribeRequestSchema = zod_1.z.object({
    type: zod_1.z.literal("ui.node.describeRequest"),
    nodeId: zod_1.z.string(),
});
exports.UiNodeDeleteRequestSchema = zod_1.z.object({
    type: zod_1.z.literal("ui.node.deleteRequest"),
    nodeId: zod_1.z.string(),
});
exports.UiNodePatchRequestSchema = zod_1.z.object({
    type: zod_1.z.literal("ui.node.patchRequest"),
    nodeId: zod_1.z.string(),
    props: zod_1.z.record(zod_1.z.unknown()).optional(),
    label: zod_1.z.string().optional(),
});
exports.UiEdgeCreatedSchema = zod_1.z.object({
    type: zod_1.z.literal("ui.edgeCreated"),
    edge: zod_1.z.object({
        source: zod_1.z.string(),
        target: zod_1.z.string(),
        sourcePort: zod_1.z.string().nullable().optional(),
        targetPort: zod_1.z.string().nullable().optional(),
    }),
});
exports.UiNodeCreatedSchema = zod_1.z.object({
    type: zod_1.z.literal("ui.nodeCreated"),
    node: zod_1.z.object({
        id: zod_1.z.string(),
        type: zod_1.z.string(),
        label: zod_1.z.string(),
        inputs: zod_1.z
            .array(zod_1.z.object({ id: zod_1.z.string(), kind: exports.PortKindSchema.optional(), label: zod_1.z.string().optional(), multi: zod_1.z.boolean().optional() }))
            .optional()
            .default([]),
        outputs: zod_1.z
            .array(zod_1.z.object({ id: zod_1.z.string(), kind: exports.PortKindSchema.optional(), label: zod_1.z.string().optional(), multi: zod_1.z.boolean().optional() }))
            .optional()
            .default([]),
        props: zod_1.z.record(zod_1.z.unknown()).optional(),
    }),
    position: exports.PositionSchema.optional(),
});
exports.UiCredentialsRequestSchema = zod_1.z.object({
    type: zod_1.z.literal("ui.credentials.set"),
    provider: zod_1.z.string(),
    credentials: zod_1.z.record(zod_1.z.string()),
});
exports.ToExtensionMessageSchema = zod_1.z.union([
    exports.UiReadySchema,
    exports.UiNodesChangedSchema,
    exports.UiNodeAiRequestSchema,
    exports.UiNodeDescribeRequestSchema,
    exports.UiNodeDeleteRequestSchema,
    exports.UiNodePatchRequestSchema,
    exports.UiEdgeCreatedSchema,
    exports.UiNodeCreatedSchema,
    exports.UiCredentialsRequestSchema,
]);
