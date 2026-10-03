"""Safe HTTP request correlation at the ASGI application boundary."""

from __future__ import annotations

import logging
import time
import traceback
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID, uuid4


REQUEST_ID_HEADER_NAME = b"x-request-id"
MAX_REQUEST_ID_HEADER_BYTES = 128
_INTERNAL_SERVER_ERROR_BODY = b'{"detail":"Internal server error"}'
_LOGGER = logging.getLogger(__name__)

ASGIMessage = dict[str, Any]
ASGIReceive = Callable[[], Awaitable[ASGIMessage]]
ASGISend = Callable[[ASGIMessage], Awaitable[None]]
ASGIApp = Callable[[dict[str, Any], ASGIReceive, ASGISend], Awaitable[None]]


class RequestCorrelationMiddleware:
    """Assign a canonical request ID, return it, and log safe request metadata."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: ASGIReceive, send: ASGISend) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _request_id_from_headers(scope.get("headers", []))
        method = str(scope["method"])
        path = str(scope["path"])
        started_at = time.perf_counter()
        response_started = False
        status = 500

        async def send_with_request_id(message: ASGIMessage) -> None:
            nonlocal response_started, status
            if message["type"] == "http.response.start":
                response_started = True
                status = int(message["status"])
                response_headers = [
                    (name, value)
                    for name, value in message.get("headers", [])
                    if name.lower() != REQUEST_ID_HEADER_NAME
                ]
                response_headers.append((REQUEST_ID_HEADER_NAME, request_id.encode("ascii")))
                await send({**message, "headers": response_headers})
                return
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception as error:
            _log_unexpected_exception(error, request_id, method, path)
            if response_started:
                raise
            status = 500
            await _send_internal_server_error(send_with_request_id)
        finally:
            duration_ms = (time.perf_counter() - started_at) * 1000
            _LOGGER.info(
                "Request completed request_id=%s method=%s path=%s status=%s duration_ms=%.3f",
                request_id,
                method,
                path,
                status,
                duration_ms,
                extra={
                    "request_id": request_id,
                    "method": method,
                    "path": path,
                    "status": status,
                    "duration_ms": duration_ms,
                },
            )


def _request_id_from_headers(headers: list[tuple[bytes, bytes]]) -> str:
    values = [value for name, value in headers if name.lower() == REQUEST_ID_HEADER_NAME]
    if len(values) != 1 or len(values[0]) > MAX_REQUEST_ID_HEADER_BYTES:
        return str(uuid4())

    try:
        decoded_value = values[0].decode("ascii")
        parsed_value = UUID(decoded_value)
    except (UnicodeDecodeError, ValueError, AttributeError):
        return str(uuid4())

    canonical_value = str(parsed_value)
    return canonical_value if decoded_value.lower() == canonical_value else str(uuid4())


def _log_unexpected_exception(error: Exception, request_id: str, method: str, path: str) -> None:
    safe_traceback = "".join(traceback.format_tb(error.__traceback__))
    _LOGGER.error(
        "Unexpected request failure request_id=%s method=%s path=%s Traceback (most recent call last):\n%s",
        request_id,
        method,
        path,
        safe_traceback,
        extra={"request_id": request_id, "method": method, "path": path},
    )


async def _send_internal_server_error(send: ASGISend) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": 500,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(_INTERNAL_SERVER_ERROR_BODY)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": _INTERNAL_SERVER_ERROR_BODY})
