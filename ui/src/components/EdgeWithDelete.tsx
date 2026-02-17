import React from 'react';
import {
    BaseEdge,
    EdgeLabelRenderer,
    getBezierPath,
    getSmoothStepPath,
    Position,
    useStore,
    type EdgeProps,
} from 'reactflow';
import { useUIStore } from '../store';
import { postToHost } from '../vscodeBridge';

export default function EdgeWithDelete({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
    source,
    target,
    sourceHandleId,
    targetHandleId,
    data,
}: EdgeProps) {
    const targetInternalNode = useStore((state: any) => state.nodeInternals?.get?.(target));

    const shouldRouteAroundTarget =
        targetPosition === Position.Left &&
        Boolean(targetInternalNode?.positionAbsolute) &&
        typeof targetInternalNode?.height === 'number';

    let edgePath: string;
    let labelX: number;
    let labelY: number;

    if (shouldRouteAroundTarget) {
        const nodeTopY = targetInternalNode.positionAbsolute.y;
        const nodeBottomY = nodeTopY + targetInternalNode.height;
        const routePadding = 44;

        const topLaneY = nodeTopY - routePadding;
        const bottomLaneY = nodeBottomY + routePadding;

        const routeViaTop = Math.abs(sourceY - topLaneY) <= Math.abs(sourceY - bottomLaneY);
        const centerY = routeViaTop ? topLaneY : bottomLaneY;

        [edgePath, labelX, labelY] = getSmoothStepPath({
            sourceX,
            sourceY,
            sourcePosition,
            targetX,
            targetY,
            targetPosition,
            centerY,
            borderRadius: 16,
            offset: 32,
        });
    } else {
        [edgePath, labelX, labelY] = getBezierPath({
            sourceX,
            sourceY,
            sourcePosition,
            targetX,
            targetY,
            targetPosition,
        });
    }

    const [isHovered, setIsHovered] = React.useState(false);

    const onEdgeDelete = () => {
        // Send delete message directly (no confirmation dialog per user request)
        // Use data from edge.data which contains original class names and port names
        const edgeData = data || {};
        
        postToHost({
            type: "ui.edgeDeleted",
            edge: {
                // Use original class names from data, not React Flow node IDs
                source: edgeData.source || source,
                target: edgeData.target || target,
                // Use original port names from data
                sourcePort: edgeData.sourcePort || sourceHandleId || null,
                targetPort: edgeData.targetPort || targetHandleId || null,
            }
        });
    };

    return (
        <g onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
            {/* Invisible interaction path (wider target for hover) */}
            <BaseEdge path={edgePath} style={{ strokeWidth: 20, stroke: 'transparent', fill: 'none' }} />
            <BaseEdge path={edgePath} {...(markerEnd ? { markerEnd } : {})} style={style} />
            <EdgeLabelRenderer>
                <div
                    style={{
                        position: 'absolute',
                        transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                        fontSize: 12,
                        pointerEvents: 'all',
                    }}
                    className="nodrag nopan"
                >
                    <button
                        className="edgeTrashButton"
                        style={{
                            opacity: isHovered ? 1 : 0,
                            pointerEvents: isHovered ? 'all' : 'none',
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            onEdgeDelete();
                        }}
                        aria-label="Delete edge"
                        title="Delete connection"
                    >
                        🗑️
                    </button>
                </div>
            </EdgeLabelRenderer>
        </g>
    );
}
