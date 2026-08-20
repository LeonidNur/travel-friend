"""FastAPI application entry point."""

from fastapi import FastAPI

from travel_friend_backend.auth.telegram import TelegramInitDataVerifier
from travel_friend_backend.config import BackendSettings, get_backend_settings


def create_app(settings: BackendSettings | None = None) -> FastAPI:
    backend_settings = settings or get_backend_settings()
    app = FastAPI(title="Travel Friend Backend")
    app.state.telegram_init_data_verifier = TelegramInitDataVerifier(
        bot_token=backend_settings.telegram_bot_token
    )

    @app.get("/health")
    def get_health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
