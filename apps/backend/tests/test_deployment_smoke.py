from __future__ import annotations

import importlib.util
from pathlib import Path

import httpx
import pytest

SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "deployment_smoke.py"
SCRIPT_SPEC = importlib.util.spec_from_file_location("deployment_smoke", SCRIPT_PATH)
assert SCRIPT_SPEC is not None and SCRIPT_SPEC.loader is not None
deployment_smoke = importlib.util.module_from_spec(SCRIPT_SPEC)
SCRIPT_SPEC.loader.exec_module(deployment_smoke)


def run_with_mocked_responses(
    responses: dict[str, httpx.Response | Exception],
    base_url: str = "https://api.example.test",
) -> tuple[int, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        result = responses[str(request.url)]
        if isinstance(result, Exception):
            raise result
        return result

    transport = httpx.MockTransport(handle)
    with httpx.Client(transport=transport) as client:
        output = deployment_smoke.main(["--base-url", base_url], client=client)
    return output, requests


def response(url: str, status_code: int, payload: object) -> httpx.Response:
    return httpx.Response(status_code, json=payload, request=httpx.Request("GET", url))


def test_smoke_checks_health_and_ready_in_order_with_get_only(capsys: pytest.CaptureFixture[str]) -> None:
    output, requests = run_with_mocked_responses(
        {
            "https://api.example.test/health": response(
                "https://api.example.test/health", 200, {"status": "ok"}
            ),
            "https://api.example.test/ready": response(
                "https://api.example.test/ready", 200, {"status": "ready"}
            ),
        }
    )

    assert output == 0
    assert [(request.method, request.url.path) for request in requests] == [
        ("GET", "/health"),
        ("GET", "/ready"),
    ]
    assert "PASS" in capsys.readouterr().out


@pytest.mark.parametrize(
    ("endpoint", "status_code", "payload"),
    [
        ("health", 302, {"location": "https://unexpected.example.test/"}),
        ("health", 503, {"status": "ok"}),
        ("health", 200, {"status": "degraded"}),
        ("ready", 503, {"detail": "Service unavailable"}),
        ("ready", 200, {"status": "not-ready"}),
    ],
)
def test_smoke_fails_on_unhealthy_http_status_or_body(
    endpoint: str,
    status_code: int,
    payload: object,
    capsys: pytest.CaptureFixture[str],
) -> None:
    health_url = "https://api.example.test/health"
    ready_url = "https://api.example.test/ready"
    responses = {
        health_url: response(health_url, 200, {"status": "ok"}),
        ready_url: response(ready_url, 200, {"status": "ready"}),
    }
    url = f"https://api.example.test/{endpoint}"
    responses[url] = response(url, status_code, payload)

    output, requests = run_with_mocked_responses(responses)

    assert output == 1
    assert requests[-1].url.path == f"/{endpoint}"
    assert "FAIL" in capsys.readouterr().err


def test_smoke_fails_on_malformed_json(capsys: pytest.CaptureFixture[str]) -> None:
    url = "https://api.example.test/health"

    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not-json", request=request)

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        output = deployment_smoke.main(
            ["--base-url", "https://api.example.test"], client=client
        )

    assert output == 1
    assert "FAIL" in capsys.readouterr().err


def test_smoke_fails_on_network_error_without_leaking_error_details(
    capsys: pytest.CaptureFixture[str],
) -> None:
    url = "https://api.example.test/health"
    output, requests = run_with_mocked_responses(
        {url: httpx.ConnectError("private connection detail")}
    )

    assert output == 1
    assert len(requests) == 1
    error_output = capsys.readouterr().err
    assert "ConnectError" in error_output
    assert "private connection detail" not in error_output


def test_default_client_uses_bounded_timeout_and_does_not_follow_redirects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_client = httpx.Client
    client_options: dict[str, object] = {}

    def create_mock_client(**options: object) -> httpx.Client:
        client_options.update(options)
        return real_client(
            transport=httpx.MockTransport(
                lambda request: response(
                    str(request.url),
                    200,
                    {"status": "ok" if request.url.path == "/health" else "ready"},
                )
            ),
            **options,
        )

    monkeypatch.setattr(deployment_smoke.httpx, "Client", create_mock_client)

    output = deployment_smoke.main(["--base-url", "https://api.example.test"])

    assert output == 0
    assert client_options == {
        "timeout": deployment_smoke.REQUEST_TIMEOUT_SECONDS,
        "follow_redirects": False,
    }


@pytest.mark.parametrize(
    "base_url",
    [
        "https://api.example.test/path",
        "https://api.example.test/",
        "https://api.example.test?env=prod",
        "https://api.example.test#backend",
    ],
)
def test_cli_rejects_base_url_with_path_query_or_fragment(base_url: str) -> None:
    with pytest.raises(SystemExit):
        deployment_smoke.main(["--base-url", base_url])


@pytest.mark.parametrize(
    "base_url",
    [
        "ftp://api.example.test",
        "https://user:secret@api.example.test",
        "https://api.example.test:",
        "not-a-url",
    ],
)
def test_cli_rejects_invalid_or_credentialed_base_url(base_url: str) -> None:
    with pytest.raises(SystemExit):
        deployment_smoke.main(["--base-url", base_url])


@pytest.mark.parametrize(
    "base_url",
    [
        "http://api.example.test",
        "https://api.example.test",
        "https://api.example.test:8443",
    ],
)
def test_cli_accepts_http_origin_with_optional_port(
    base_url: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    output, requests = run_with_mocked_responses(
        {
            f"{base_url}/health": response(
                f"{base_url}/health", 200, {"status": "ok"}
            ),
            f"{base_url}/ready": response(
                f"{base_url}/ready", 200, {"status": "ready"}
            ),
        },
        base_url,
    )

    assert output == 0
    assert [request.url.path for request in requests] == ["/health", "/ready"]
    assert "healthy" in capsys.readouterr().out


def test_cli_requires_explicit_base_url() -> None:
    with pytest.raises(SystemExit):
        deployment_smoke.main([])
