from typing import Literal
from pydantic import BaseModel
from agent.llm_client import llm
from agent.state import AgentState


class RoutingIntent(BaseModel):
    intent: Literal["chat", "sql", "python"]


def router_node(state: AgentState):
    """Classifies the user query to direct the graph."""
    print("🚦 [Router] Analyzing user intent...")

    messages = state.get("messages", [])
    if not messages:
        return {"current_intent": "chat"}

    last_message = messages[-1].content
    dataset = state.get("dataset_name", "the dataset")

    # --- THE NEW AGGRESSIVE PROMPT ---
    prompt = f"""
    You are the Traffic Cop for a data analysis platform. The user is currently exploring the dataset: '{dataset}'.

    CRITICAL ROUTING RULES:
    - 'chat': ONLY for general greetings (e.g., "hello") or asking what you can do.
    - 'sql': FOR ALL REQUESTS TO SEE DATA. If the user asks for rows, columns, counts, averages, or to "show me", you MUST choose 'sql'.
    - 'python': FOR ALL VISUALIZATIONS. If the user asks for a chart, plot, or graph.

    User Query: {last_message}
    """

    router_llm = llm.with_structured_output(RoutingIntent)
    decision = router_llm.invoke(prompt)

    print(f"🚦 [Router] Decided path: {decision.intent}")
    return {"intent": decision.intent}


def route_to_specialist(state: AgentState):
    intent = state.get("intent")
    if intent == "chat":
        return "chat"
    elif intent == "sql":
        return "sql"
    elif intent == "python":
        return "generator"
    else:
        return "chat"