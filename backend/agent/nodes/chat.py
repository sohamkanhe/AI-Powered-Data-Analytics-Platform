from langchain_core.messages import SystemMessage
from agent.llm_client import llm
from agent.state import AgentState



def chat_node(state: AgentState):
    print("💬 [Chat Node] Generating conversational response...")
    messages = state.get("messages", [])
    dataset_name = state.get("dataset_name", "")

    system_prompt = SystemMessage(content=f"""
        You are a helpful, advanced Data Analysis Agent. 
        The user is currently exploring a dataset named '{dataset_name}'.
        Answer their question conversationally. Do not write code or SQL.
        """)

    full_conversation = [system_prompt] + messages

    response = llm.invoke(full_conversation)

    ui_block = {
        "type": "markdown",
        "content": response.content
    }

    return {"ui_blocks": [ui_block], "messages": [response]}
