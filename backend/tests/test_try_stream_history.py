"""Conversation continuity across the watch/Try endpoint's tool rounds."""
import asyncio
import copy
import json
import unittest
from contextlib import ExitStack, nullcontext
from unittest.mock import MagicMock, patch

from app import llm
from app.routes import playground
from app.schemas import TryIn


class TryStreamHistory(unittest.TestCase):
    def run_stream(self, history, tool_rounds):
        current = "Search NASA updates instead of giving another daily brief."
        captured = []
        call = json.dumps({"tool": "web_search", "args": {"q": "NASA updates"}})

        def chat_stream(system, context, message, **kwargs):
            captured.append((copy.deepcopy(context), message))
            yield "token", call if len(captured) <= tool_rounds else "NASA update from the tool."

        agent = {"id": 1, "model": "test", "temperature": 0,
                 "context_url": "", "ai_flags": '{"web":true}'}
        conn = MagicMock()
        conn.execute.return_value.fetchone.return_value = agent
        with ExitStack() as stack:
            replacements = {
                "db": lambda: nullcontext(conn),
                "can_use_agent": lambda *args: True,
                "row_to_dict": dict,
                "_agent_llm": lambda *args: None,
                "_user_llm": lambda *args: None,
                "_sysprompt": lambda *args: "Test assistant",
                "_memories": lambda *args: "",
                "_ai_web_tool": lambda *args: {"ok": True, "result": "NASA fixture"},
            }
            for name, replacement in replacements.items():
                stack.enter_context(patch.object(playground, name, replacement))
            stack.enter_context(patch.object(playground.cx, "connected_plugins", return_value=[]))
            stack.enter_context(patch.object(llm, "chat_stream", chat_stream))
            response = playground.try_agent_stream(
                1, TryIn(message=current, history=history),
                user={"id": 1, "display_name": "Tester", "username": "tester"})

            async def collect():
                return [json.loads(line) async for line in response.body_iterator]

            events = asyncio.run(collect())
        self.assertEqual(events[-1], {"t": "done"})
        self.assertFalse(any(event["t"] == "error" for event in events), events)
        return current, captured

    def test_latest_question_survives_tool_rounds(self):
        previous = [{"role": "user", "content": "Give me a daily brief."},
                    {"role": "assistant", "content": "Here is your daily brief."}]
        for history in ([], previous):
            for tool_rounds in (1, 2):
                with self.subTest(history=bool(history), tool_rounds=tool_rounds):
                    current, captured = self.run_stream(history, tool_rounds)
                    self.assertEqual(len(captured), tool_rounds + 1)
                    self.assertEqual(captured[0], (history, current))
                    for context, tool_output in captured[1:]:
                        self.assertEqual(context[:len(history)], history)
                        questions = [m for m in context
                                     if m == {"role": "user", "content": current}]
                        self.assertEqual(len(questions), 1,
                                         "The latest question must reach every tool follow-up")
                        self.assertEqual(context[len(history)], questions[0])
                        self.assertIn("NASA fixture", tool_output)

    def test_no_tool_request_keeps_current_question_separate_from_history(self):
        previous = [{"role": "user", "content": "First question"},
                    {"role": "assistant", "content": "First answer"}]
        current, captured = self.run_stream(previous, 0)
        self.assertEqual(captured, [(previous, current)])


if __name__ == "__main__":
    unittest.main()
