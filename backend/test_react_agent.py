import asyncio
from langchain_core.messages import HumanMessage
from agent.graph import data_agent


async def test_hi():
    """Test casual greeting — should skip tools, return pure markdown."""
    print("=" * 60)
    print("TEST 1: Casual greeting ('Hi')")
    print("=" * 60)
    initial_state = {
        "messages": [HumanMessage(content="Hi")],
        "ui_blocks": [],
        "dataset_name": "Test dataset",
        "artifact_url": None,
        "connection_string": None,
        "source_type": "csv",
        "workspace_sources": None,
        "view_map": {},
        "attempt_count": 0,
    }

    result = await data_agent.ainvoke(initial_state)
    blocks = result.get("ui_blocks", [])
    print(f"\nNumber of UI blocks: {len(blocks)}")
    for i, block in enumerate(blocks):
        print(f"\nBlock {i+1} (type={block.get('type')}):")
        if block.get("type") == "markdown":
            print(f"  content: {block['content'][:200]}")
        elif block.get("type") == "table":
            print(f"  columns: {block.get('columns')}")
            print(f"  rows: {len(block.get('data', []))}")
        elif block.get("type") == "chart":
            print(f"  has spec: {bool(block.get('spec'))}")
            print(f"  has data: {bool(block.get('data'))}")
        elif block.get("type") == "code":
            print(f"  language: {block.get('language')}")
            print(f"  content: {block['content'][:200]}")

    # Verify: should have at least one markdown block, no tables or charts
    assert len(blocks) >= 1, "Expected at least 1 block"
    assert all(b["type"] == "markdown" for b in blocks), "Casual chat should only produce markdown blocks"
    print("\n✅ TEST 1 PASSED: Casual greeting returned markdown-only blocks")


if __name__ == "__main__":
    asyncio.run(test_hi())
