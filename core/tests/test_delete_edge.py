"""Unit tests for delete_edge."""
from __future__ import annotations
import textwrap
from holon.services.patcher import delete_edge

def test_delete_edge_removes_link_call() -> None:
    source = textwrap.dedent(
        """
        from holon import workflow, link

        @workflow
        def main():
            link("node:a", "out", "node:b", "in")
            link("node:a", "out", "node:c", "in")
            return None
        """
    )
    
    updated = delete_edge(
        source,
        source_node_id="node:a",
        source_port="out",
        target_node_id="node:b",
        target_port="in"
    )
    
    assert 'link("node:a", "out", "node:b", "in")' not in updated
    assert 'link("node:a", "out", "node:c", "in")' in updated

def test_delete_edge_removes_port_map_class() -> None:
    source = textwrap.dedent(
        """
        from holon import port_map

        @port_map
        class Map1:
            source = ("node:src", "out")
            target = ("node:dst", "in")

        @port_map
        class Map2:
            source = ("node:src", "out")
            target = ("node:other", "in")
        """
    )
    
    updated = delete_edge(
        source,
        source_node_id="node:src",
        source_port="out",
        target_node_id="node:dst",
        target_port="in"
    )
    
    assert "class Map1" not in updated
    assert "class Map2" in updated

def test_delete_edge_removes_link_class() -> None:
    source = textwrap.dedent(
        """
        from holon import link

        @link
        class Link1:
            source = ("node:src", "out")
            target = ("node:dst", "in")
        """
    )

    updated = delete_edge(
        source,
        source_node_id="node:src",
        source_port="out",
        target_node_id="node:dst",
        target_port="in"
    )
    
    assert "class Link1" not in updated

def test_delete_edge_removes_link_class_with_class_ref() -> None:
    source = textwrap.dedent(
        """
        from holon import link, node

        @node
        def SrcNode(): pass

        @link
        class Link1:
            source = (SrcNode, "out")
            target = ("node:dst", "in")
        """
    )

    updated = delete_edge(
        source,
        source_node_id="node:SrcNode",
        source_port="out",
        target_node_id="node:dst",
        target_port="in"
    )
    
    assert "class Link1" not in updated
