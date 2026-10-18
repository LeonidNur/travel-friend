#!/usr/bin/env python3
"""Validate the configured production backup connection locally without connecting."""

from __future__ import annotations

from dataclasses import dataclass
import subprocess
import sys
from urllib.parse import SplitResult, parse_qsl, quote, unquote, urlsplit, urlunsplit


KEYCHAIN_SERVICE = "travel-friend-production-postgres"
KEYCHAIN_ACCOUNT = "postgres.tlgprfsecdasloqnuyjo"


@dataclass(frozen=True)
class Target:
    host: str
    port: int
    database: str
    username: str
    sslmode: str


EXPECTED_TARGET = Target(
    host="aws-0-eu-central-1.pooler.supabase.com",
    port=5432,
    database="postgres",
    username="postgres.tlgprfsecdasloqnuyjo",
    sslmode="require",
)


class ConfigurationError(Exception):
    """Raised when a local connection setting cannot be validated safely."""


def validate_target(target: Target) -> None:
    if type(target) is not Target or target != EXPECTED_TARGET:
        raise ConfigurationError("Unexpected database target.")


def parse_and_validate_uri(uri: str, expected_password: str | None = None) -> SplitResult:
    """Parse a generated URI and verify its exact target and TLS mode."""
    try:
        parsed = urlsplit(uri)
        valid = (
            parsed.scheme == "postgresql"
            and parsed.hostname == EXPECTED_TARGET.host
            and parsed.port == EXPECTED_TARGET.port
            and unquote(parsed.username or "") == EXPECTED_TARGET.username
            and unquote(parsed.path.removeprefix("/")) == EXPECTED_TARGET.database
            and parsed.fragment == ""
            and parse_qsl(parsed.query, strict_parsing=True) == [("sslmode", "require")]
            and parsed.password is not None
            and (expected_password is None or unquote(parsed.password) == expected_password)
        )
    except (UnicodeError, ValueError):
        valid = False
    if not valid:
        raise ConfigurationError("Could not validate the local connection URI.")
    return parsed


def build_connection_uri(password: str, target: Target = EXPECTED_TARGET) -> str:
    """Build and validate a URI in memory; callers must not display or persist it."""
    validate_target(target)
    if not isinstance(password, str) or not password or any(char in password for char in "\x00\r\n"):
        raise ConfigurationError("Keychain password is empty or invalid.")

    try:
        username = quote(target.username, safe="", encoding="utf-8", errors="strict")
        encoded_password = quote(password, safe="", encoding="utf-8", errors="strict")
        uri = urlunsplit((
            "postgresql",
            f"{username}:{encoded_password}@{target.host}:{target.port}",
            f"/{target.database}",
            "sslmode=require",
            "",
        ))
        parse_and_validate_uri(uri, expected_password=password)
    except ConfigurationError:
        raise
    except Exception:
        raise ConfigurationError("Could not form the local connection URI.") from None
    return uri


def read_keychain_password() -> str:
    """Read one generic-password item while capturing all command output privately."""
    command = [
        "security", "find-generic-password", "-s", KEYCHAIN_SERVICE,
        "-a", KEYCHAIN_ACCOUNT, "-w",
    ]
    try:
        result = subprocess.run(command, capture_output=True, check=False)
    except Exception:
        raise ConfigurationError("Could not read the configured macOS Keychain item.") from None

    if result.returncode != 0 or not isinstance(result.stdout, bytes):
        raise ConfigurationError("Could not read the configured macOS Keychain item.")

    password_bytes = result.stdout
    if password_bytes.endswith(b"\r\n"):
        password_bytes = password_bytes[:-2]
    elif password_bytes.endswith(b"\n"):
        password_bytes = password_bytes[:-1]
    try:
        password = password_bytes.decode("utf-8", errors="strict")
    except UnicodeError:
        raise ConfigurationError("The configured Keychain item is not valid UTF-8.") from None
    if not password or any(char in password for char in "\x00\r\n"):
        raise ConfigurationError("Keychain password is empty or invalid.")
    return password


def main() -> int:
    if sys.platform != "darwin":
        print("This local Keychain check is available only on macOS.", file=sys.stderr)
        return 1

    try:
        password = read_keychain_password()
        build_connection_uri(password)
    except Exception:
        print("Could not validate the local production backup connection configuration.", file=sys.stderr)
        return 1

    print("Connection configuration is valid; no network connection was attempted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
