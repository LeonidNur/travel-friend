import hashlib
import hmac
import json
from urllib.parse import urlencode

import pytest

from travel_friend_backend.auth.telegram import (
    ExpiredTelegramInitDataError,
    InvalidTelegramInitDataSignatureError,
    MalformedTelegramInitDataError,
    TelegramInitDataVerifier,
)
from travel_friend_backend.config import (
    BackendSettings,
    TelegramBotTokenNotConfiguredError,
    get_backend_settings,
)


TEST_BOT_TOKEN = "test-bot-token-for-telegram-init-data"
NOW = 1_700_000_000
TEST_USER = {
    "id": 123456789,
    "first_name": "Ada",
    "last_name": "Lovelace",
    "username": "ada",
    "language_code": "en",
    "is_premium": True,
}
FIXED_VECTOR_RAW_INIT_DATA = (
    "auth_date=1699999940&query_id=AAHfHkAAAAAAHfHkAAAB&"
    "user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Ada%22%2C"
    "%22username%22%3A%22ada%22%7D&"
    "hash=6091e98955a0d4770623aed38c6a40158cd515ef0465be7b1572530ca608ed9e"
)


def sign_init_data(fields: dict[str, str], bot_token: str = TEST_BOT_TOKEN) -> str:
    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(fields.items())
    )
    secret_key = hmac.new(
        b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256
    ).digest()
    fields_with_hash = {
        **fields,
        "hash": hmac.new(
            secret_key, data_check_string.encode("utf-8"), hashlib.sha256
        ).hexdigest(),
    }
    return urlencode(fields_with_hash)


@pytest.fixture
def verifier() -> TelegramInitDataVerifier:
    return TelegramInitDataVerifier(
        bot_token=TEST_BOT_TOKEN,
        max_age_seconds=300,
        clock=lambda: NOW,
    )


def test_accepts_correctly_signed_init_data(verifier: TelegramInitDataVerifier) -> None:
    raw_init_data = sign_init_data(
        {
            "auth_date": str(NOW - 60),
            "query_id": "AAHfHkAAAAAAHfHkAAAB",
            "user": json.dumps(TEST_USER, separators=(",", ":")),
        }
    )

    result = verifier.verify(raw_init_data)

    assert result.identity.telegram_user_id == TEST_USER["id"]
    assert result.identity.first_name == "Ada"
    assert result.identity.username == "ada"
    assert result.auth_date == NOW - 60


def test_accepts_fixed_known_telegram_init_data_vector(
    verifier: TelegramInitDataVerifier,
) -> None:
    result = verifier.verify(FIXED_VECTOR_RAW_INIT_DATA)

    assert result.identity.telegram_user_id == 123456789
    assert result.identity.username == "ada"


def test_rejects_duplicate_init_data_field(verifier: TelegramInitDataVerifier) -> None:
    raw_init_data = (
        f"auth_date={NOW - 60}&auth_date={NOW - 60}&"
        "user=%7B%22id%22%3A123456789%2C%22first_name%22%3A%22Ada%22%7D&"
        "hash=0"
    )

    with pytest.raises(MalformedTelegramInitDataError):
        verifier.verify(raw_init_data)


def test_rejects_an_invalid_hash(verifier: TelegramInitDataVerifier) -> None:
    raw_init_data = sign_init_data(
        {
            "auth_date": str(NOW - 60),
            "user": json.dumps(TEST_USER, separators=(",", ":")),
        }
    )
    invalid_hash_init_data = raw_init_data.replace("hash=", "hash=0", 1)

    with pytest.raises(InvalidTelegramInitDataSignatureError):
        verifier.verify(invalid_hash_init_data)


def test_rejects_data_changed_after_signing(verifier: TelegramInitDataVerifier) -> None:
    raw_init_data = sign_init_data(
        {
            "auth_date": str(NOW - 60),
            "user": json.dumps(TEST_USER, separators=(",", ":")),
        }
    )
    tampered_init_data = raw_init_data.replace("Ada", "Eve", 1)

    with pytest.raises(InvalidTelegramInitDataSignatureError):
        verifier.verify(tampered_init_data)


@pytest.mark.parametrize("raw_init_data", ["", "auth_date=1700000000", "hash=abc&="])
def test_rejects_malformed_init_data(
    verifier: TelegramInitDataVerifier, raw_init_data: str
) -> None:
    with pytest.raises(MalformedTelegramInitDataError):
        verifier.verify(raw_init_data)


def test_rejects_stale_auth_date(verifier: TelegramInitDataVerifier) -> None:
    raw_init_data = sign_init_data(
        {
            "auth_date": str(NOW - 301),
            "user": json.dumps(TEST_USER, separators=(",", ":")),
        }
    )

    with pytest.raises(ExpiredTelegramInitDataError):
        verifier.verify(raw_init_data)


@pytest.mark.parametrize("auth_date", [None, "not-an-integer"])
def test_rejects_invalid_auth_date_after_valid_signature(
    verifier: TelegramInitDataVerifier, auth_date: str | None
) -> None:
    fields = {"user": json.dumps(TEST_USER, separators=(",", ":"))}
    if auth_date is not None:
        fields = {**fields, "auth_date": auth_date}

    with pytest.raises(MalformedTelegramInitDataError):
        verifier.verify(sign_init_data(fields))


def test_rejects_auth_date_beyond_future_clock_skew(
    verifier: TelegramInitDataVerifier,
) -> None:
    raw_init_data = sign_init_data(
        {
            "auth_date": str(NOW + 31),
            "user": json.dumps(TEST_USER, separators=(",", ":")),
        }
    )

    with pytest.raises(MalformedTelegramInitDataError):
        verifier.verify(raw_init_data)


@pytest.mark.parametrize(
    "user",
    [
        "{not-valid-json}",
        json.dumps({**TEST_USER, "id": 0}, separators=(",", ":")),
        json.dumps({**TEST_USER, "username": 123}, separators=(",", ":")),
    ],
)
def test_rejects_invalid_user_after_valid_signature(
    verifier: TelegramInitDataVerifier, user: str
) -> None:
    raw_init_data = sign_init_data({"auth_date": str(NOW - 60), "user": user})

    with pytest.raises(MalformedTelegramInitDataError):
        verifier.verify(raw_init_data)


def test_rejects_missing_user_after_valid_signature(
    verifier: TelegramInitDataVerifier,
) -> None:
    raw_init_data = sign_init_data({"auth_date": str(NOW - 60)})

    with pytest.raises(MalformedTelegramInitDataError):
        verifier.verify(raw_init_data)


def test_does_not_extract_user_before_signature_verification(
    verifier: TelegramInitDataVerifier,
) -> None:
    raw_init_data = urlencode(
        {
            "auth_date": str(NOW - 60),
            "user": "{not-valid-json}",
            "hash": "0" * 64,
        }
    )

    with pytest.raises(InvalidTelegramInitDataSignatureError):
        verifier.verify(raw_init_data)


def test_rejects_missing_bot_token_configuration() -> None:
    with pytest.raises(TelegramBotTokenNotConfiguredError):
        get_backend_settings({})


@pytest.mark.parametrize(
    ("bot_token", "max_age_seconds"),
    [("", 300), (TEST_BOT_TOKEN, 0), (TEST_BOT_TOKEN, -1)],
)
def test_rejects_invalid_verifier_constructor_arguments(
    bot_token: str, max_age_seconds: int
) -> None:
    with pytest.raises(ValueError):
        TelegramInitDataVerifier(
            bot_token=bot_token,
            max_age_seconds=max_age_seconds,
        )


def test_health_endpoint_returns_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TEST_BOT_TOKEN)

    from travel_friend_backend.main import create_app

    app = create_app(BackendSettings(telegram_bot_token=TEST_BOT_TOKEN))
    health_route = next(route for route in app.routes if route.path == "/health")

    assert health_route.endpoint() == {"status": "ok"}
