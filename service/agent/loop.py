"""Bounded tool-calling loop shared by the interviewer and the evaluator."""
from __future__ import annotations

import json
from typing import Optional

from .blackboard import Blackboard
from .llm import LLM
from .tools import ToolBox

NUDGE = "You must act through a tool. Call the terminal tool named in your instructions (after any bookkeeping)."


def run_tool_loop(llm: LLM, toolbox: ToolBox, board: Blackboard, system: str, user_message: str,
                  max_steps: int, actor: str, nudge: str = NUDGE) -> Optional[dict]:
    """Returns the terminal action dict, or None if the model never produced one within `max_steps`."""
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user_message}]
    schemas = toolbox.schemas()
    for step in range(max_steps):
        resp = llm.chat(messages, schemas)
        board.emit(actor, "llm_step", step=step, tools=[c.name for c in resp.tool_calls])
        if not resp.tool_calls:
            messages.append({"role": "assistant", "content": resp.content or ""})
            messages.append({"role": "user", "content": nudge})
            continue
        messages.append({"role": "assistant", "content": resp.content, "tool_calls": [
            {"id": c.id, "type": "function", "function": {"name": c.name, "arguments": json.dumps(c.arguments)}}
            for c in resp.tool_calls]})
        for call in resp.tool_calls:
            result = toolbox.execute(call.name, call.arguments)
            messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result)})
            if result.get("terminal") and result.get("ok"):
                return result["action"]
    return None
