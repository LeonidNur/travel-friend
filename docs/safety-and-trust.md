# Safety and Trust

Короткий обзор security и safety-подхода Travel Friend. Актуальная архитектурная версия находится в [docs/backend/security.md](./backend/security.md).

## Почему это важно

Travel Friend — социальный продукт, где незнакомые люди ищут компанию для поездки. Поэтому доверие, moderation и backend-security должны быть встроены в архитектуру с самого начала.

## Реализованный security baseline

- backend проверяет raw Telegram `initData` и использует Bearer sessions;
- backend authorization опирается на серверную identity и RLS/capability boundary; подробности реализации приведены в [security documentation](./backend/security.md).

## Принципы безопасности и доверия

- Telegram Mini App client недоверенный: решение о доступе и другие security-решения принимает backend.
- Будущие AI и внешние provider-ы рассматриваются как недоверенные источники данных, а не источники авторизации или финальных доменных решений.
- Будущие внешние переходы должны проверяться backend policy, включая allowlist.

## Планируемые safety-capabilities — не реализованы

- `UserBlock` как серверное ограничение на взаимодействие пользователей;
- `UserReport` как backend-канал жалоб и moderation;
- `Audit` как журнал security-значимых действий;
- ручная модерация как операционный процесс;
- backend redirect и allowlist для внешних provider/affiliate-переходов.

Для этих возможностей сейчас не заявляются готовые UI, API или persistence workflows.

## Ограничения ответственности

Приложение помогает найти компанию и обсудить поездку, но не гарантирует:

- безопасность участников;
- достоверность всех пользовательских данных;
- качество поездки;
- выполнение договорённостей.
