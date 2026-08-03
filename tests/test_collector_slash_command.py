"""Tests for slash-command parsing in the collector."""

from __future__ import annotations

from agentsleak.collector.routes import _parse_slash_command


class TestParseSlashCommand:
    def test_command_with_args(self):
        assert _parse_slash_command("/code-review high") == ("code-review", "high")

    def test_command_without_args(self):
        assert _parse_slash_command("/verify") == ("verify", "")

    def test_multiword_args_preserved(self):
        assert _parse_slash_command("/loop 5m /foo") == ("loop", "5m /foo")

    def test_leading_and_trailing_whitespace(self):
        assert _parse_slash_command("  /verify  ") == ("verify", "")

    def test_plain_prompt_is_not_a_command(self):
        assert _parse_slash_command("please fix the bug") is None

    def test_bare_slash_is_not_a_command(self):
        assert _parse_slash_command("/") is None

    def test_slash_space_is_not_a_command(self):
        assert _parse_slash_command("/ spaced") is None

    def test_pasted_absolute_path_is_not_a_command(self):
        # Starts with "/" but the name segment has "/" and ".", so it must not
        # be mistaken for a "/Users..." skill.
        assert _parse_slash_command("/Users/inga/notes.txt what is this?") is None

    def test_plugin_scoped_command(self):
        assert _parse_slash_command("/plugin:skill go") == ("plugin:skill", "go")

    def test_name_with_dot_rejected(self):
        assert _parse_slash_command("/weird.name arg") is None
