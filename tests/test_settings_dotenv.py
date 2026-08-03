"""Tests for the dependency-free .env loader in settings."""

from __future__ import annotations

import os
from pathlib import Path

from agentsleak.config.settings import load_dotenv


def test_loads_key_value(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("AGENTSLEAK_TEST_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_text("AGENTSLEAK_TEST_KEY=hello\n")
    load_dotenv(env)
    assert os.environ["AGENTSLEAK_TEST_KEY"] == "hello"


def test_real_env_wins(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("AGENTSLEAK_TEST_KEY", "from-shell")
    env = tmp_path / ".env"
    env.write_text("AGENTSLEAK_TEST_KEY=from-file\n")
    load_dotenv(env)
    assert os.environ["AGENTSLEAK_TEST_KEY"] == "from-shell"


def test_strips_quotes_and_export(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("AGENTSLEAK_TEST_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_text('export AGENTSLEAK_TEST_KEY="quoted value"\n')
    load_dotenv(env)
    assert os.environ["AGENTSLEAK_TEST_KEY"] == "quoted value"


def test_skips_comments_and_blanks_and_malformed(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("AGENTSLEAK_TEST_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_text("# a comment\n\nNO EQUALS HERE\nAGENTSLEAK_TEST_KEY=ok\n")
    load_dotenv(env)  # must not raise
    assert os.environ["AGENTSLEAK_TEST_KEY"] == "ok"


def test_missing_file_is_noop() -> None:
    load_dotenv("/nonexistent/path/.env")  # must not raise


def test_value_with_equals_sign(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("AGENTSLEAK_TEST_KEY", raising=False)
    env = tmp_path / ".env"
    env.write_text("AGENTSLEAK_TEST_KEY=a=b=c\n")
    load_dotenv(env)
    assert os.environ["AGENTSLEAK_TEST_KEY"] == "a=b=c"
