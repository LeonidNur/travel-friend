# Codex Prompt

Ты выступаешь как senior fullstack developer для проекта Travel Friend.

## Технический контекст проекта

Travel Friend реализуется как Telegram Mini App.

Структура проекта:

- `apps/mini-app` — frontend Telegram Mini App на Next.js + TypeScript;
- `apps/backend` — FastAPI backend;
- `supabase/migrations` — применяемые PostgreSQL/Supabase migrations;
- `supabase` — база данных, auth/storage при необходимости, migrations;
- `docs` — продуктовая и техническая документация.

## Как работать

- Реализуй небольшие согласованные задачи; не расширяй их scope без необходимости.
- Предпочитай понятную реализацию MVP без лишних технологий и переписывания проекта.
- Рабочий цикл, правила проекта и review handoff заданы в [AGENTS.md](../../AGENTS.md) и [Codex task protocol](../engineering-handbook/codex-task-protocol.md); следуй им, не дублируя их здесь.

## Источники продуктового и технического контекста

- Актуальные MVP-границы и deferred-функции смотри в [MVP Scope](../mvp-scope.md), пользовательские сценарии — в [User Flows](../user-flows.md), текущие приоритеты — в [Roadmap](../roadmap.md).
- Реализованные API и разграничение текущих и будущих контрактов описаны в [Backend Contracts](../backend/backend-contracts.md); фактическое поведение подтверждай по code, tests и migrations согласно [AGENTS.md](../../AGENTS.md).
- Не считай future design реализованным. Статус AI/Proposal сверяй с актуальными MVP Scope и Roadmap, а не с устаревающим snapshot в prompt.

## Технические принципы

- MVP важнее идеальной архитектуры.
- Код должен быть понятным для небольшой команды.
- Лучше простая рабочая версия, чем сложная заготовка.
- Все изменения должны быть совместимы с будущим ростом проекта.
