#!/usr/bin/env python3
"""Read-only HTTP smoke checks for a deployed Travel Friend backend."""

from __future__ import annotations

import argparse
import sys
from contextlib import nullcontext
from urllib.parse import urlsplit

import httpx

REQUEST_TIMEOUT_SECONDS = 5.0
EXPECTED_RESPONSES = (
    ("/health", {"status": "ok"}),
    ("/ready", {"status": "ready"}),
)


class SmokeFailure(RuntimeError):
    """A required health or readiness check failed."""


def validate_base_url(value: str) -> str:
    """Accept only an HTTP(S) origin with an optional valid port."""
    try:
        parsed = urlsplit(value)
        parsed.port  # Access validates malformed port values.
    except ValueError as error:
        raise argparse.ArgumentTypeError("base URL is invalid") from error

    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or "?" in value
        or "#" in value
        or parsed.netloc.endswith(":")
        or any(character.isspace() for character in parsed.netloc)
    ):
        raise argparse.ArgumentTypeError(
            "base URL must be an HTTP(S) origin with an optional port"
        )
    return value


def check_endpoint(
    client: httpx.Client,
    base_url: str,
    path: str,
    expected_payload: dict[str, str],
) -> None:
    url = f"{base_url}{path}"
    try:
        response = client.get(url)
    except httpx.HTTPError as error:
        raise SmokeFailure(
            f"GET {path} failed with network error ({type(error).__name__})"
        ) from error

    if response.status_code != 200:
        raise SmokeFailure(f"GET {path} returned HTTP {response.status_code}; expected 200")

    try:
        payload = response.json()
    except ValueError as error:
        raise SmokeFailure(f"GET {path} returned invalid JSON") from error

    if payload != expected_payload:
        raise SmokeFailure(f"GET {path} returned an unexpected response body")


def run_smoke(base_url: str, client: httpx.Client) -> None:
    for path, expected_payload in EXPECTED_RESPONSES:
        check_endpoint(client, base_url, path, expected_payload)
        print(f"PASS GET {path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        required=True,
        type=validate_base_url,
        help="explicit backend base URL, for example https://backend.example.test",
    )
    return parser


def main(argv: list[str] | None = None, *, client: httpx.Client | None = None) -> int:
    args = build_parser().parse_args(argv)
    client_context = (
        nullcontext(client)
        if client is not None
        else httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS,
            follow_redirects=False,
        )
    )

    try:
        with client_context as smoke_client:
            run_smoke(args.base_url, smoke_client)
    except SmokeFailure as error:
        print(f"FAIL {error}", file=sys.stderr)
        return 1

    print("Deployment smoke passed: /health and /ready are healthy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
