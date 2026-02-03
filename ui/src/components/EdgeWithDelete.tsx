import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow';
import { useUIStore } from '../store';
import { postToExtension } from '../vscodeBridge';

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
}: EdgeProps) {
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
    });

    const onEdgeDelete = () => {
        // Send delete message directly (no confirmation dialog per user request)
        postToExtension({
            type: "ui.edgeDeleted",
            edge: {
                source,
                target,
                sourcePort: sourceHandleId || null,
                targetPort: targetHandleId || null,
            }
        });
    };

    return (
        <>
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
        </>
    );
}
