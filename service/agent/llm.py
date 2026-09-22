"""LLM interface. The agent depends on the `LLM` protocol only, so tests use ScriptedLLM and
production uses any OpenAI-compatible tool-calling endpoint (Groq by default)."""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

import httpx


@dataclass
class ToolCall:
    name: str
    arguments: dict
    id: str = "call_0"


@dataclass
class LLMResponse:
    content: Optional[str] = None
    tool_calls: list[ToolCall] = field(default_factory=list)


class LLM(Protocol):
    def chat(self, messages: list[dict], tools: list[dict], tool_choice: Optional[str] = None) -> LLMResponse: ...


class LLMError(RuntimeError):
    pass


class GroqChat:
    """OpenAI-compatible chat + tool calling against Groq. Retries 429s using `retry-after`.

    NOTE: not exercised by the test-suite (no network in CI); covered by the live smoke test in
    service/eval/simulate.py when GROQ_API_KEY is set.
    """
    URL = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None,
                 temperature: float = 0.3, max_retries: int = 3, timeout: float = 30.0):
        # llama-3.3-70b-versatile was deprecated by Groq (June 2026); gpt-oss-120b is their recommended replacement.
        self.model = model or os.getenv("AGENT_MODEL", "openai/gpt-oss-120b")
        self.api_key = api_key or os.getenv("GROQ_API_KEY", "")
        self.temperature, self.max_retries, self.timeout = temperature, max_retries, timeout
        self.calls = 0

    def chat(self, messages: list[dict], tools: list[dict], tool_choice: Optional[str] = None) -> LLMResponse:
        if not self.api_key:
            raise LLMError("GROQ_API_KEY is not set")
        choice = {"type": "function", "function": {"name": tool_choice}} if tool_choice else "auto"
        body = {"model": self.model, "messages": messages, "tools": tools,
                "tool_choice": choice, "temperature": self.temperature}
        for attempt in range(self.max_retries + 1):
            r = httpx.post(self.URL, json=body, timeout=self.timeout,
                           headers={"Authorization": f"Bearer {self.api_key}"})
            self.calls += 1
            if r.status_code == 429 and attempt < self.max_retries:
                wait = float(r.headers.get("retry-after", 2 ** attempt))
                time.sleep(min(wait, 20))
                continue
            if r.status_code >= 400:
                raise LLMError(f"{r.status_code}: {r.text[:300]}")
            msg = r.json()["choices"][0]["message"]
            calls = []
            for tc in msg.get("tool_calls") or []:
                try:
                    args = json.loads(tc["function"].get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                calls.append(ToolCall(tc["function"]["name"], args, tc.get("id", "call_0")))
            return LLMResponse(msg.get("content"), calls)
        raise LLMError("rate limited after retries")


class ScriptedLLM:
    """Deterministic LLM for tests: returns queued responses, or calls a function of the messages."""
    def __init__(self, script: list[LLMResponse] | Callable[[list[dict], list[dict]], LLMResponse]):
        self.script = script
        self.calls: list[list[dict]] = []
        self.tool_choices: list[Optional[str]] = []

    def chat(self, messages: list[dict], tools: list[dict], tool_choice: Optional[str] = None) -> LLMResponse:
        self.calls.append([dict(m) for m in messages])
        self.tool_choices.append(tool_choice)
        if callable(self.script):
            return self.script(messages, tools)
        if not self.script:
            return LLMResponse(content="(script exhausted)")
        return self.script.pop(0)


def call(name: str, **args) -> LLMResponse:
    """Test helper: one tool call."""
    return LLMResponse(tool_calls=[ToolCall(name, args, id=f"call_{name}")])