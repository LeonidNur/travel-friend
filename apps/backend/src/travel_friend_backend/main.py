"""FastAPI application entry point."""

from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from travel_friend_backend.auth.telegram import TelegramInitDataVerifier
from travel_friend_backend.config import BackendSettings, get_backend_settings
from travel_friend_backend.auth.service import (
    AuthenticatedPrincipal,
    auth_dependency,
    login,
)
from travel_friend_backend.db import get_database_connection
from travel_friend_backend.routers.chats import router as chats_router
from travel_friend_backend.routers.discover import router as discover_router
from travel_friend_backend.routers.me import router as me_router
from travel_friend_backend.routers.trips import router as trips_router

class TelegramAuthRequest(BaseModel):
    init_data: str | None = None


def create_app(settings: BackendSettings | None = None) -> FastAPI:
    backend_settings = settings or get_backend_settings()
    app = FastAPI(title="Travel Friend Backend")
    app.state.backend_settings = backend_settings
    app.state.telegram_init_data_verifier = TelegramInitDataVerifier(
        bot_token=backend_settings.telegram_bot_token,
        max_age_seconds=600,
    )
    app.include_router(chats_router)
    app.include_router(discover_router)
    app.include_router(me_router)
    app.include_router(trips_router)

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
    def test_current(
        principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
    ):
        return {"user_id": principal.user_id}

    @app.post("/auth/logout", status_code=204)
    def logout(
        principal: Annotated[AuthenticatedPrincipal, Depends(auth_dependency)],
        connection: Annotated[object, Depends(get_database_connection)],
    ) -> None:
        connection.execute(
            "UPDATE user_sessions SET revoked_at=now() WHERE id=%s",
            (principal.session_id,),
        )

    return app


app = create_app()
