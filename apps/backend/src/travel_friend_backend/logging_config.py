"""Production-visible logging for the Travel Friend application namespace."""

from __future__ import annotations

import logging


APPLICATION_LOGGER_NAME = "travel_friend_backend"
OWNED_HANDLER_ATTRIBUTE = "_travel_friend_backend_owned_handler"
_FORMATTER = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")


def configure_application_logging() -> logging.Logger:
    """Send application INFO+ records to stderr exactly once per emission.

    Uvicorn and Render capture stderr.  The dedicated handler keeps application
    records independent from Uvicorn's root logging configuration, while
    disabled propagation prevents duplicates when a root handler is present.
    """
    application_logger = logging.getLogger(APPLICATION_LOGGER_NAME)
    application_logger.setLevel(logging.INFO)
    application_logger.propagate = False

    owned_handlers = [
        handler
        for handler in application_logger.handlers
        if getattr(handler, OWNED_HANDLER_ATTRIBUTE, False)
    ]
    if not owned_handlers:
        handler = logging.StreamHandler()
        setattr(handler, OWNED_HANDLER_ATTRIBUTE, True)
        handler.setFormatter(_FORMATTER)
        application_logger.addHandler(handler)
        return application_logger

    for duplicate_handler in owned_handlers[1:]:
        application_logger.removeHandler(duplicate_handler)
        duplicate_handler.close()

    return application_logger
