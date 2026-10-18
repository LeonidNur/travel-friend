from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import sys

import pytest


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "production-backup-connection-check.py"
SCRIPT_SPEC = importlib.util.spec_from_file_location("production_backup_connection_check", SCRIPT_PATH)
assert SCRIPT_SPEC is not None and SCRIPT_SPEC.loader is not None
connection_check = importlib.util.module_from_spec(SCRIPT_SPEC)
sys.modules[SCRIPT_SPEC.name] = connection_check
SCRIPT_SPEC.loader.exec_module(connection_check)


def test_uri_encodes_password_and_preserves_exact_expected_target() -> None:
    password = "mock:p@ss/word?x&y=%#"

    uri = connection_check.build_connection_uri(password)

    assert uri == (
        "postgresql://postgres.tlgprfsecdasloqnuyjo:"
        "mock%3Ap%40ss%2Fword%3Fx%26y%3D%25%23@"
        "aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require"
    )
    parsed = connection_check.parse_and_validate_uri(uri)
    assert connection_check.unquote(parsed.password) == password


@pytest.mark.parametrize(
    "target",
    [
        connection_check.Target("unexpected.example.test", 5432, "postgres", "operator", "require"),
        connection_check.Target(
            "aws-0-eu-central-1.pooler.supabase.com", 6543, "postgres",
            "postgres.tlgprfsecdasloqnuyjo", "require",
        ),
        connection_check.Target(
            "aws-0-eu-central-1.pooler.supabase.com", 5432, "other_db",
            "postgres.tlgprfsecdasloqnuyjo", "require",
        ),
        connection_check.Target(
            "aws-0-eu-central-1.pooler.supabase.com", 5432, "postgres",
            "other-user", "require",
        ),
        connection_check.Target(
            "aws-0-eu-central-1.pooler.supabase.com", 5432, "postgres",
            "postgres.tlgprfsecdasloqnuyjo", "prefer",
        ),
    ],
)
def test_uri_rejects_unexpected_target(target: connection_check.Target) -> None:
    with pytest.raises(connection_check.ConfigurationError):
        connection_check.build_connection_uri("mock-password", target=target)


@pytest.mark.parametrize("password", ["", "\x00invalid", "invalid\n"])
def test_uri_rejects_empty_or_invalid_password(password: str) -> None:
    with pytest.raises(connection_check.ConfigurationError):
        connection_check.build_connection_uri(password)


def test_keychain_lookup_uses_only_configured_service_and_account(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []
    mock_password = b"mock-password-with-@-and-%\n"

    def mock_run(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        calls.append(args)
        assert kwargs == {"capture_output": True, "check": False}
        return subprocess.CompletedProcess(args, 0, stdout=mock_password, stderr=b"")

    monkeypatch.setattr(connection_check.subprocess, "run", mock_run)

    assert connection_check.read_keychain_password() == "mock-password-with-@-and-%"
    assert calls == [[
        "security", "find-generic-password", "-s",
        "travel-friend-production-postgres", "-a",
        "postgres.tlgprfsecdasloqnuyjo", "-w",
    ]]


@pytest.mark.parametrize(
    "result",
    [
        subprocess.CompletedProcess([], 44, stdout=b"", stderr=b"mock keychain error"),
        subprocess.CompletedProcess([], 0, stdout=b"\n", stderr=b""),
    ],
)
def test_keychain_missing_or_empty_password_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    result: subprocess.CompletedProcess[bytes],
) -> None:
    monkeypatch.setattr(connection_check.subprocess, "run", lambda *_args, **_kwargs: result)

    with pytest.raises(connection_check.ConfigurationError):
        connection_check.read_keychain_password()


def test_cli_only_reports_safe_local_validation_and_never_prints_uri(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    mock_password = "mock-secret-not-for-output"
    built_uris: list[str] = []
    monkeypatch.setattr(connection_check.sys, "platform", "darwin")
    monkeypatch.setattr(connection_check, "read_keychain_password", lambda: mock_password)
    original_build = connection_check.build_connection_uri

    def capture_uri(password: str, target: connection_check.Target = connection_check.EXPECTED_TARGET) -> str:
        uri = original_build(password, target)
        built_uris.append(uri)
        return uri

    monkeypatch.setattr(connection_check, "build_connection_uri", capture_uri)

    assert connection_check.main() == 0
    output = capsys.readouterr()
    assert "valid" in output.out.lower()
    assert "no network connection" in output.out.lower()
    assert not output.err
    assert mock_password not in output.out + output.err
    assert all(uri not in output.out + output.err for uri in built_uris)


def test_cli_suppresses_uri_construction_errors(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setattr(connection_check.sys, "platform", "darwin")
    monkeypatch.setattr(connection_check, "read_keychain_password", lambda: "mock-secret")

    def fail_uri(*_args: object, **_kwargs: object) -> str:
        raise RuntimeError("mock-secret postgresql://sensitive-uri")

    monkeypatch.setattr(connection_check, "build_connection_uri", fail_uri)

    assert connection_check.main() == 1
    output = capsys.readouterr()
    assert not output.out
    assert "mock-secret" not in output.err
    assert "sensitive-uri" not in output.err


def test_cli_refuses_non_macos_without_keychain_access(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    called = False

    def fail_if_called() -> str:
        nonlocal called
        called = True
        raise AssertionError("Keychain must not be called off macOS")

    monkeypatch.setattr(connection_check.sys, "platform", "linux")
    monkeypatch.setattr(connection_check, "read_keychain_password", fail_if_called)

    assert connection_check.main() == 1
    output = capsys.readouterr()
    assert not called
    assert not output.out
    assert output.err
