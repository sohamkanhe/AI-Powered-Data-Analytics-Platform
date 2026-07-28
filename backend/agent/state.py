import operator
from typing import Annotated, TypedDict, List, Dict, Optional, Any
from langchain_core.messages import BaseMessage

def append_block(left: List[Dict[str, Any]], right: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if right is None:
        return []

    if not left: left = []
    if not right: right = []
    return left + right

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    intent: str
    dataset_name: str
    source_type: str
    artifact_url: Optional[str]
    connection_string: Optional[str]
    schema_context: Optional[str]       # pre-computed schema injected into agent prompt
    current_code: Optional[str]
    error_trace: Optional[str]
    attempt_count: int
    ui_blocks: Annotated[List[Dict[str, Any]], append_block]
    df_json: Optional[str]
    workspace_id: Optional[str]
    workspace_sources: Optional[List[Dict[str, Any]]]  # [{id, name, artifact_url}, ...]
    view_map: Optional[Dict[str, str]]  # {view_name: artifact_url}
    sandbox_result: Optional[Dict[str, Any]]



