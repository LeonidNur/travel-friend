"""FastAPI application entry point."""

from fastapi import Depends, FastAPI, HTTPException, Header
import psycopg
from pydantic import BaseModel

from travel_friend_backend.auth.telegram import TelegramInitDataVerifier
from travel_friend_backend.config import BackendSettings, get_backend_settings
from travel_friend_backend.auth.service import auth_dependency, login

class TelegramAuthRequest(BaseModel):
    init_data: str | None = None


def create_app(settings: BackendSettings | None = None) -> FastAPI:
    backend_settings = settings or get_backend_settings()
    app = FastAPI(title="Travel Friend Backend")
    app.state.telegram_init_data_verifier = TelegramInitDataVerifier(
        bot_token=backend_settings.telegram_bot_token,
        max_age_seconds=600,
    )

    @app.get("/health")
    def get_health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/auth/telegram")
    def telegram_auth(payload: TelegramAuthRequest) -> dict[str, object]:
        if not backend_settings.database_url:
            raise HTTPException(503, "Database is not configured")
        if payload.init_data is None:
            raise HTTPException(401, "Invalid Telegram authentication")
        try:
            verified = app.state.telegram_init_data_verifier.verify(payload.init_data)
            return login(backend_settings.database_url, verified.identity)
        except HTTPException:
            raise
        except Exception as error:
            from travel_friend_backend.auth.telegram import TelegramInitDataVerificationError
            if isinstance(error, TelegramInitDataVerificationError):
                raise HTTPException(401, "Invalid Telegram authentication") from error
            raise

    @app.get("/auth/test-current")
    def test_current(authorization: str | None = Header(default=None)):
        user = auth_dependency(backend_settings.database_url, authorization)
        return {"user_id": user[0]["id"]}

    @app.post("/auth/logout", status_code=204)
    def logout(authorization: str | None = Header(default=None)):
        user = auth_dependency(backend_settings.database_url, authorization)
        if not backend_settings.database_url:
            raise HTTPException(503, "Database is not configured")
        with psycopg.connect(backend_settings.database_url) as conn:
            conn.execute("UPDATE user_sessions SET revoked_at=now() WHERE id=%s", (user[1],))

    return app


app = create_app()
