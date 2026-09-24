"""Pure ASGI enforcement of the backend raw HTTP request-body limit."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any


REQUEST_BODY_LIMIT_BYTES = 256 * 1024
_REQUEST_TOO_LARGE_BODY = b'{"detail":"Request body exceeds the 256 KiB limit"}'
_REQUEST_BODY_LIMIT_DECIMAL = str(REQUEST_BODY_LIMIT_BYTES).encode("ascii")

ASGIMessage = dict[str, Any]
ASGIReceive = Callable[[], Awaitable[ASGIMessage]]
ASGISend = Callable[[ASGIMessage], Awaitable[None]]
ASGIApp = Callable[[dict[str, Any], ASGIReceive, ASGISend], Awaitable[None]]


class RequestBodyLimitMiddleware:
    """Reject HTTP request bodies larger than ``REQUEST_BODY_LIMIT_BYTES``.

    Valid, bounded request messages are replayed unchanged to the downstream
    application so FastAPI remains responsible for parsing and validation.
    Malformed ``Content-Length`` values are ignored here and bounded by the
    actual ASGI request stream instead.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: ASGIReceive, send: ASGISend) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if _has_oversized_content_length(scope.get("headers", [])):
            await _send_request_too_large(send)
            return

        buffered_messages: list[ASGIMessage] = []
        total_body_bytes = 0

        while True:
            message = await receive()
            if message["type"] != "http.request":
                buffered_messages.append(message)
                break

            body = message.get("body", b"")
            if len(body) > REQUEST_BODY_LIMIT_BYTES - total_body_bytes:
                await _send_request_too_large(send)
                return

            total_body_bytes += len(body)
            buffered_messages.append(message)
            if not message.get("more_body", False):
                break

        next_message_index = 0

        async def replay_receive() -> ASGIMessage:
            nonlocal next_message_index
            if next_message_index < len(buffered_messages):
                message = buffered_messages[next_message_index]
                next_message_index += 1
                return message
            return await receive()

        await self.app(scope, replay_receive, send)


def _has_oversized_content_length(headers: list[tuple[bytes, bytes]]) -> bool:
    for header_name, header_value in headers:
        if header_name.lower() != b"content-length":
            continue
        normalized_value = header_value.strip()
        if _is_decimal_value_above_limit(normalized_value):
            return True
    return False


def _is_decimal_value_above_limit(value: bytes) -> bool:
    if not value.isdigit():
        return False
    significant_digits = value.lstrip(b"0") or b"0"
    return len(significant_digits) > len(_REQUEST_BODY_LIMIT_DECIMAL) or (
        len(significant_digits) == len(_REQUEST_BODY_LIMIT_DECIMAL)
        and significant_digits > _REQUEST_BODY_LIMIT_DECIMAL
    )


async def _send_request_too_large(send: ASGISend) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(_REQUEST_TOO_LARGE_BODY)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": _REQUEST_TOO_LARGE_BODY})
