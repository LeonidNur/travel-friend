# Technical hardening backlog

> Статус: current backlog. Это не roadmap и не specification нового продукта. Он фиксирует известные технические риски persisted backend-backed MVP, которые требуют отдельного scoped work item.

## Как использовать

- Текущее реализованное поведение проверяется по code, tests и migrations.
- HTTP-границы сверяются с [backend contracts](backend/backend-contracts.md), данные — с [database schema](database-schema.md) и migrations.
- Roadmap определяет направление; этот документ хранит детальные technical risks.
- Historical `CHANGELOG.md` и `dev-log.md` могут объяснять происхождение риска, но не меняют его актуальный статус.

## До внешнего запуска backend

- Documented production deployment/configuration для FastAPI и `BACKEND_API_ORIGIN` отсутствуют; Vercel покрывает Mini App, но не является задокументированным production deployment backend.
- Нет RLS policies и production data-access/runbook. Любое решение по RLS, service credentials и operational access должно быть отдельной security/database задачей.
- Не зафиксированы production monitoring, alerting и operating runbook для backend/database.

## Current MVP limitations, требующие отдельного решения

- Auth bootstrap хранит access token только в runtime state клиента; browser reload и UI для server-side logout требуют отдельной задачи.
- Messages не имеют cursor pagination, read/unread API или realtime delivery.
- Trip поддерживает создание и чтение из direct/group Chat, но не write/lifecycle commands, stop editor, `start/complete/cancel/leave` или invitations.
- Group Chat имеет фиксированный состав: invitations, add/remove/leave, roles/admin/permissions и invite links не реализованы.
- Discover — последовательный список без impressions, filters/ranking и отдельного Match list.
- Block/report/audit и moderation capabilities пока не реализованы.

## Отложенная архитектура, не backlog текущего slice

AI/Proposal, provider integrations, transport/external offers и расширенный membership/lifecycle design описаны как future architecture. Их нельзя выводить из текущих frontend view models или добавлять при закрытии несвязанного hardening work item.
