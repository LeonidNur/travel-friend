# Technical hardening backlog

> Статус: current backlog. Это не roadmap и не specification нового продукта. Он фиксирует известные технические риски persisted backend-backed MVP в порядке их исполнения; completed checkpoint не является active TODO.

## Как использовать

- Текущее реализованное поведение проверяется по code, tests и migrations.
- HTTP-границы сверяются с [backend contracts](backend/backend-contracts.md), данные — с [database schema](database-schema.md) и migrations.
- Roadmap определяет направление; этот документ хранит детальные technical risks и контрольные условия перехода между этапами.
- Historical `CHANGELOG.md` и `dev-log.md` могут объяснять происхождение риска, но не меняют его актуальный статус.

## Current checkpoint / completed baseline (29.10.2026)

- TEAM E2E completed; mega-review / PRE-TEAM work completed.
- Systematic authorization / IDOR review completed.
- Discover requester eligibility completed.
- First-login concurrency completed.
- Least-privileged PostgreSQL role `app_runtime` и authenticated DB context completed: FastAPI устанавливает `app.user_id` только на время transaction.
- RLS/capability boundary completed для всех 17 application tables; основные write flows onboarding, Discover → Match → Direct Chat, Group Chat, Messages и Trip creation используют контролируемые DB capabilities.
- Production database rollout завершён 29.10.2026: ledger=24; пять migrations, runtime grants, privilege verifier и database deployment gate прошли.
- Render `travel-friend-api` live на SHA `67eae892886cabac7408857c8a1b24af1728d2cf`; `/health` и `/ready` = 200, startup errors не обнаружены, Auto-Deploy Off.
- Vercel Production deployment `dpl_DjcqzYmZQhDJS9FFzNSk2Scb7J41` READY на `travel-friend-mini-app.vercel.app`; Mini App snapshot `15c0d761fb54670b3987f743ebaca5df353f3972`, proxy health = 200.
- Инфраструктурный smoke прошёл; авторизованный Telegram E2E не проводился, внешнее тестирование не завершено.
- Auto-Deploy remains Off; успешное ручное исполнение rollout не является решением о включении automation.
- №15 manual production deployment workflow остаётся документированным в runbook; фактический rollout и provider results зафиксированы в active-stage entries ниже.
- P0.5 reliability/observability completed. Это не открывает external test автоматически: перед ним обязателен отдельный External Test Cost Guardrails gate.

## P0 — completed security baseline (historical checkpoint)

1. Telegram `initData` security.
2. Invariant `completed → DELETE active TravelIntent`.
3. Session lifecycle baseline.
4. Backend input/domain limits.
5. Minimal rate limiting.
6. Secrets/env/logging review.

## P0.5 — reliability / observability — COMPLETED (03.10.2026)

7. **Request / correlation ID — COMPLETED.** Backend назначает или принимает валидный `X-Request-ID`, возвращает его клиенту и использует в correlated request logging.
8. **Frontend timeout / retry / states — COMPLETED.** GET/read requests имеют bounded timeout; recoverable error states дают user-initiated Retry и явные loading, empty и error states в затронутых экранах.
9. **Chat → Profile navigation regression — COMPLETED.** Из Chat Room и карточек участников восстановлен переход к public participant profile; доступ проверяется backend boundary.
10. **Controlled multi-user Trip Detail coverage — COMPLETED.** Backend tests покрывают Trip Detail для нескольких участников, включая visibility и persisted detail data.
11. **Reciprocal Match feedback — COMPLETED.** Discover UI показывает результат reciprocal interest и переход к созданному direct Chat.
12. **Active TravelIntent view/edit — COMPLETED.** Profile UI гидрирует active TravelIntent и позволяет валидированно редактировать его через существующий backend contract.
13. **Health / readiness — COMPLETED.** `/health` сохраняет liveness contract, а `/ready` проверяет readiness database dependency и отдаёт controlled `503` при её недоступности.
14. **Minimal error monitoring — COMPLETED.** P0.5 baseline — explicit correlated backend application logging в Render Service Logs и documented operator workflow; внешний error-monitoring provider намеренно не подключён.
14.1. **FinOps / external test guardrails — AUDIT/PLAN COMPLETED; AUTH ADMISSION MODEL SUPERSEDED BY PRODUCT DECISION.** Исторический аудит/план и usage model находятся в [FinOps runbook](finops-external-test-guardrails.md). Продуктовое решение: любая валидная Telegram `initData` может зарегистрироваться; core/tester списков и tester pause в backend нет. Рост публичного auth ingress остаётся cost/abuse risk и покрывается существующими rate limits, provider monitoring и emergency stop controls; они не дают per-user admission. Актуальные billing controls и deployment/schema compatibility остаются отдельными preflight gates.

Residual observability risks после закрытия P0.5 уже ведутся без дубля в [backend security](backend/security.md#minimal-error-monitoring--incident-workflow): ordinary business DB connection timeout policy, сохранение `X-Request-ID` frontend, централизованный сбор frontend runtime errors и logging path для future streaming/post-response exceptions.

## Active stage — deployment / CI / reproducibility

15. **Production deployment workflow — EXECUTED (2026-10-29).** Manual DB → Render → Vercel sequence зафиксирован в [production deployment runbook](backend/production-deployment-runbook.md). Auto-Deploy остаётся Off. Для будущих rollout всё равно нужны свежий preflight и отдельное разрешение.
16. **Production deployment provenance / schema drift — ROLLOUT COMPLETE; AUDIT PARTIALLY VERIFIED / OPEN.** На 2026-10-29 production ledger=24; пять migrations, runtime grants, privilege verifier и database gate прошли. Render deployment `dep-dbhk59om7kps73f4e39g`, live SHA `67eae892886cabac7408857c8a1b24af1728d2cf`; Vercel Production `dpl_DjcqzYmZQhDJS9FFzNSk2Scb7J41` READY, snapshot SHA `15c0d761fb54670b3987f743ebaca5df353f3972`, API proxy проверен. Rollout подтверждён, но общий schema-drift/provenance backlog остаётся открытым: Supabase API-role grants шире необходимого, default EXECUTE ACL требует hardening, перед будущими изменениями нужен новый targeted drift review. Подробности — в [production deployment runbook](backend/production-deployment-runbook.md).

   В текущем на дату audit `develop` inventory было 24 migrations: 19 подтверждены в production ledger на 2026-10-18, ещё пять после Render SHA отсутствовали в том snapshot. Migration SQL и порядок пяти файлов отдельно reviewed; архив 19 migrations восстановлен и все пять migrations, 26 migration-declared `PUBLIC EXECUTE` revokes, текущие `app_runtime` grants и verifier прошли только в network-isolated disposable PostgreSQL 17.11. Это локальная репетиция, не новое production observation. Production snapshot также подтвердил 17 application tables с RLS, 17 policies, 18 functions; `app_runtime` — `LOGIN`, `NOINHERIT`, `NOBYPASSRLS`, имеет EXECUTE на 16 функциях, `PUBLIC EXECUTE` отсутствует. Для deployed Render SHA проверено наличие его 12 используемых функций и `app_runtime` EXECUTE. На source snapshot требовались отсутствовавшие в production шестипараметрическая `bootstrap_telegram_login` и `chat_participant_public_profile(uuid,uuid)`; сохранённый `resolve_bearer_session_with_identity(text)` был частью DB verifier/gate contract, но не нужен приложению для admission. Никакие production migrations не применялись в рамках audit 18.10.2026.

   Frontend↔backend compatibility и фактический `BACKEND_API_ORIGIN` остаются **UNKNOWN**. Попытка read-only smoke завершилась timeout на `GET /health`, поэтому `/ready` не запускался, а live health/readiness не подтверждены. Полный schema drift audit не завершён; совпадение migration ledger не доказывает schema parity. Перед rollout обязателен повторный production ledger/schema/ACL preflight, включая legacy blank value precheck для migration 3 и default/effective ACL check для новых функций 6-arg login и Chat profile; verifier также проверяет сохранённый versioned session resolver capability. Vercel SHA/origin, live health и frontend/backend flows остаются неподтверждёнными. Точный SQL review, compatibility matrix и локальный replay приведены в [production deployment runbook](backend/production-deployment-runbook.md). №16 остаётся открытой; production rollout не готов.
17. **Deployment smoke chain — IMPLEMENTED; production infrastructure smoke PASS (2026-10-29).** `GET /health` и `/ready` вернули 200, Vercel `/api/backend/health` и `/openapi.json` — 200, защищённые endpoints без Bearer — ожидаемый 401. Скрипт [deployment_smoke.py](../apps/backend/scripts/deployment_smoke.py) остаётся read-only; авторизованный Telegram E2E не проводился и внешнее тестирование не завершено.
18. **CI with disposable PostgreSQL — IMPLEMENTED.** Backend job запускает существующий `./scripts/local-test-db.sh test`, затем отдельный `if: always()` step вызывает существующий `./scripts/local-test-db.sh stop`; управление локальной БД не менялось. Workflow не передаёт `DATABASE_URL` или secrets; test script использует loopback disposable PostgreSQL, а backend guards проверяют target `travel_friend_test` на `127.0.0.1:55432` и отдельные test roles. Статический regression test проверяет порядок шагов, отсутствие `continue-on-error`, unconditional cleanup и отсутствие DB/secrets references в backend job. Обычная ошибка pytest остаётся failed job result. Граница проверки: hosted GitHub Actions и Docker cleanup при принудительном завершении runner здесь не запускались; `always()` не может очистить контейнер после потери runner.
19. **Local test DB hygiene — IMPLEMENTED.** Перед `reset` и `stop` `local-test-db.sh` проверяет точное имя контейнера, label `com.travel-friend.disposable-test-db=true`, единственные ожидаемые `POSTGRES_DB` / `POSTGRES_USER` и единственный binding `127.0.0.1:55432 → 5432/tcp`. Несовпадение или ошибка Docker inspect завершают команду до schema reset или удаления контейнера. `test` продолжает использовать только сформированные локальные loopback DSN; существующие backend guards проверяют разрешённые test targets. Regression tests используют Docker CLI stub и проверяют отказ без destructive calls. Реальные PostgreSQL/Docker destructive operations в этих тестах не запускались.
20. **Backend runbook/README — IMPLEMENTED (documentation).** `apps/backend/README.md` проверен по текущим runtime/scripts/CI и существующим backend runbooks; описание disposable DB guard обновлено для exact name, label, DB/user settings и loopback binding. Добавлены safe troubleshooting steps для Docker availability, stopped/mismatched container, `/ready` 503 и PostgreSQL test connection failures. README разделяет local/test/production и ссылается на manual deployment и historical security migration runbooks; rollout procedure не дублируется. Ограничение: provider runtime settings и direct backend ingress подтверждаются только в текущем provider environment.
21. **MVP BACKUP/RESTORE POLICY SET; LOCAL RESTORE + APPLICATION GRANTS VERIFIED; FULL PROVIDER RECOVERY OPEN.** Production archive и encrypted offsite copy существуют; локальная disposable PostgreSQL 17 schema/data restore, structural/RLS checks и runtime grants/verifier проверены. Weekly manual policy, retention 4, RPO target ≤7 days (при соблюдении schedule), RTO target 24h (не измерен) описаны в [backup/restore runbook](backend/backup-restore-runbook.md). Полное Supabase-managed recovery и production ACL restore не подтверждены.
22. **Rollback / forward-fix readiness — OPERATOR RUNBOOK READY; NO ROLLBACK EXECUTED.** [Production deployment runbook](backend/production-deployment-runbook.md) separates frontend/backend rollback, failed-migration forward-fix and potential data-corruption recovery, with exact-target/version checks, compatibility gates, approval boundaries and post-recovery validation. Production deployment completed 2026-10-29 (see rollout record); no rollback or production restore was performed. Full Supabase recovery and production ACL restore remain unverified.

## Mandatory gate — External Test Cost Guardrails

Внешнее тестирование не считать завершённым: авторизованный Telegram E2E после rollout не проводился. Полный inventory, модель нагрузки, provider-level emergency controls и account-specific open questions находятся в [FinOps & external test guardrails](finops-external-test-guardrails.md). Регистрация допускает любой валидный Telegram `initData`; allowlists/tester pause отсутствуют, cohort planning не является auth gate. До внешнего теста остаются отдельное cost/abuse readiness decision и согласованный авторизованный E2E.

### Application-side review

- публичный Telegram registration/auth ingress и его rate/cost exposure;
- публичный `/ready` открывает unauthenticated DB connection/query без endpoint rate cap;
- expensive или unbounded reads, включая `GET /chats` N+1;
- рост Messages history/write;
- рост session creation/replay;
- TravelIntent archive/create churn;
- public `/ready`, `/health` и unauthenticated auth ingress;
- необходимость pagination и hard response caps определяется конкретным cost risk, а не вводится по умолчанию;
- пригодность process-local rate limiter проверяется для фактической production topology.

### Provider-side review

- Vercel: pricing, quota, overage, budget и hard-cap semantics;
- Render: pricing, topology, autoscaling, bandwidth, budget, hard-cap и pause semantics;
- Supabase: compute, DB, storage, egress, pool, budget, hard-cap и pause semantics;
- budget alert не равен hard spending cap;
- проверка direct backend exposure;
- проверка deployed SHA/schema parity.

### Operational review

- подтвердить account-level plan/payment method/usage и реальные spend/pause controls;
- определить допустимый maximum test loss;
- планировать размер и темп приглашений как организационные cost guardrails, не как backend admission policy;
- определить baseline usage и monitoring cadence;
- определить stop thresholds;
- зафиксировать точный и проверенный manual stop procedure; пока он не испытан, считать его unverified.

Ни размер cohort, ни длительность теста, ни процентные stop thresholds этим backlog не утверждаются.

## Residual TODO / risks

- TravelIntent updates используют last-write-wins; optimistic concurrency остаётся отдельным решением.
- `destination_country_code` и `destination_place_ref` остаются вне owner UI/API.
- `GET /chats` требует отдельного review N+1 поведения.
- Supabase API-role grants шире необходимого; default EXECUTE ACL для будущих функций требует hardening. Это не отменяет PASS verifier/gate на применённых capabilities.
- Production rollout revisions подтверждены 29.10.2026; полный schema drift audit остаётся отдельным открытым риском перед будущими schema changes.
- Авторизованный Telegram E2E не проводился; внешнее тестирование не завершено.
- Render Free и Supabase Free ограничивают ресурсы/возможности; открытая Telegram-регистрация требует контроля abuse и будущих AI-расходов.
- Backup/restore и encrypted offsite copy проверены, но полное Supabase-managed recovery и production ACL restore не подтверждены.
- Render Suspend останавливает весь API service, а не доступ конкретного пользователя; Vercel pause не закрывает прямой Render API.

## Control exit

1. Deployment / CI / reproducibility rollout completed 2026-10-29; preserve residual risks above.
2. Complete External Test Cost Guardrails gate and its separately approved implementation scope.
3. Run authorized Telegram E2E and controlled multi-user E2E before external testing.
4. Only then decide whether to proceed to a small external user test.

## P1 — post-test backlog

### Chats: realtime / unread / pagination

- Incoming messages require refresh; это P1 realtime finding из TEAM E2E.
- Unread и pagination остаются отдельными P1 Chat work items.

### Group Chat membership lifecycle / invitations

- Group Chat has no invitation/accept lifecycle; это P1 finding из TEAM E2E.

### Data lifecycle / privacy

- Отдельный post-test backlog block для data lifecycle и privacy.

### Backend architecture / concurrency cleanup

- Отдельный post-test backlog block для architecture и concurrency cleanup.
- Stronger stolen-runtime-credential threat model — post-MVP; transaction-local `app.user_id` не предназначен для per-user containment при прямом произвольном SQL скомпрометированной credential `app_runtime`.

### Test architecture cleanup

- Отдельный post-test backlog block для test architecture cleanup.

### DB / performance

- Отдельный post-test backlog block для DB/performance.

### Trips lifecycle

- Trip write/lifecycle, stop editor, `start/complete/cancel/leave` и invitations остаются отдельным P1 work item.

### Operations / reproducibility

- Отдельный post-test backlog block для operations/reproducibility.

### Documentation cleanup

- Отдельный post-test backlog block для documentation cleanup.

## P2 — AI / Proposal

- AI/RAG boundary with second developer.
- Proposal persistence / decisions / version invariants.
- Atomic Proposal → Trip apply without AI.
- AI as Proposal producer/facilitator, never Trip owner.
- Later RAG/providers/background jobs/cost controls.
- Uploads/audit events only when justified by later scope.

### Mandatory Pre-AI FinOps gate

До включения AI требуется отдельный gate с per-user quota, global budget/usage guard, model/token/context/output limits, concurrency, bounded retries, tool/provider-call limits, accounting/anomaly monitoring, kill switch и worst-case cost model. AI implementation этим gate не начинается.

## Consciously deferred / do not do now

Прематурная архитектура и post-MVP work остаются отдельно от active MVP hardening: сложный Group Chat membership lifecycle сверх P1 invitation/accept, расширенный Trip lifecycle, transport/external offers, full moderation, provider integrations, AI/RAG implementation и прочие product expansions. Их нельзя выводить из frontend view models, добавлять «заодно» при закрытии hardening work item или принимать за текущий HTTP/physical-data contract.
