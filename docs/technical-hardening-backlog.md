# Technical hardening backlog

> Статус: current backlog. Это не roadmap и не specification нового продукта. Он фиксирует известные технические риски persisted backend-backed MVP в порядке их исполнения; completed checkpoint не является active TODO.

## Как использовать

- Текущее реализованное поведение проверяется по code, tests и migrations.
- HTTP-границы сверяются с [backend contracts](backend/backend-contracts.md), данные — с [database schema](database-schema.md) и migrations.
- Roadmap определяет направление; этот документ хранит детальные technical risks и контрольные условия перехода между этапами.
- Historical `CHANGELOG.md` и `dev-log.md` могут объяснять происхождение риска, но не меняют его актуальный статус.

## Current checkpoint / completed baseline (03.10.2026)

- TEAM E2E completed; mega-review / PRE-TEAM work completed.
- Systematic authorization / IDOR review completed.
- Discover requester eligibility completed.
- First-login concurrency completed.
- Least-privileged PostgreSQL role `app_runtime` и authenticated DB context completed: FastAPI устанавливает `app.user_id` только на время transaction.
- RLS/capability boundary completed для всех 17 application tables; основные write flows onboarding, Discover → Match → Direct Chat, Group Chat, Messages и Trip creation используют контролируемые DB capabilities.
- Production security cutover completed; production DB применена до `20260901280000`.
- Production grants verifier, runtime deployment gate, production `/health` и Telegram smoke passed; совместимый security backend deployed.
- Auto-Deploy remains Off; ручной production deployment workflow описан в №15 и не является решением о включении automation.
- №15 подготовлен как manual production deployment runbook; это закрывает документационный workflow, но не включает Auto-Deploy и не подтверждает provider settings.
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
14.1. **FinOps / external test guardrails — AUDIT/PLAN COMPLETED; SERVER-SIDE ADMISSION IMPLEMENTED LOCALLY; EXTERNAL TEST GATE OPEN (18.10.2026).** Единая production/development/operations карта, локальные ресурсы, billing unknowns, модель 5/10/25/50/100 участников и operator preflight находятся в [FinOps runbook](finops-external-test-guardrails.md). Admission проверяется до создания session и на каждом Bearer request; additive resolver, grants/verifiers и локальные tests подготовлены. Production migration/config/deploy не выполнялись. Внешний тест **STOP** до отдельного migration/grants rollout, безопасной Render allowlist configuration, защиты публичного `/ready` от DB amplification, проверки billing controls и актуального deployment/schema compatibility.

Residual observability risks после закрытия P0.5 уже ведутся без дубля в [backend security](backend/security.md#minimal-error-monitoring--incident-workflow): ordinary business DB connection timeout policy, сохранение `X-Request-ID` frontend, централизованный сбор frontend runtime errors и logging path для future streaming/post-response exceptions.

## Active stage — deployment / CI / reproducibility

15. **Production deployment workflow — DOCS READY.** Операторский manual rollout, compatibility decision matrix, stop criteria и зависимости зафиксированы в [production deployment runbook](backend/production-deployment-runbook.md). Auto-Deploy остаётся Off; этот статус не является разрешением на rollout или включение automation.
16. **Production deployment provenance/compatibility — PARTIALLY VERIFIED / OPEN (read-only audit, 18.10.2026).** Подтверждены Vercel project `travel-friend-mini-app`; Render `travel-friend-api`, branch `develop`, manual deployment, Auto-Deploy Off; Supabase `travel-friend-dev` (`tlgprfsecdasloqnuyjo`), `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.165`. Render live deployment — `dep-dapvgnlg1s2s73dicitg`, SHA `b25e08dce158b7fe7ea6d17b40d96c3e893330fa`; его 19 migrations совпадают с production ledger. У Vercel READY deployment `dpl_Di21ceCkxg4poxD2Udyfeanar4En` Git SHA отсутствует (`source=cli`, no `gitSource`), поэтому frontend SHA — **UNKNOWN**.

   В текущем `develop` inventory 24 migrations: 19 подтверждены в production ledger на 2026-10-18, ещё пять после Render SHA отсутствуют в том snapshot. Migration SQL и порядок пяти файлов отдельно reviewed; архив 19 migrations восстановлен и все пять migrations, 26 migration-declared `PUBLIC EXECUTE` revokes, текущие `app_runtime` grants и verifier прошли только в network-isolated disposable PostgreSQL 17.11. Это локальная репетиция, не новое production observation. Production snapshot также подтвердил 17 application tables с RLS, 17 policies, 18 functions; `app_runtime` — `LOGIN`, `NOINHERIT`, `NOBYPASSRLS`, имеет EXECUTE на 16 функциях, `PUBLIC EXECUTE` отсутствует. Для deployed Render SHA проверено наличие его 12 используемых функций и `app_runtime` EXECUTE. Текущий source требует отсутствующие в том snapshot шестипараметрическую `bootstrap_telegram_login`, `chat_participant_public_profile(uuid,uuid)` и новый `resolve_bearer_session_with_identity(text)`: выпуск до migration/grants/runtime-gate — блокер. Никакие production migrations не применялись.

   Frontend↔backend compatibility и фактический `BACKEND_API_ORIGIN` остаются **UNKNOWN**. Попытка read-only smoke завершилась timeout на `GET /health`, поэтому `/ready` не запускался, а live health/readiness не подтверждены. Полный schema drift audit не завершён; совпадение migration ledger не доказывает schema parity. Перед rollout обязателен повторный production ledger/schema/ACL preflight, включая legacy blank value precheck для migration 3 и default/effective ACL check для новых функций 6-arg login и Chat profile: существующий verifier отдельно проверяет API role EXECUTE только для admission resolver. Vercel SHA/origin, live health и frontend/backend flows остаются неподтверждёнными. Точный SQL review, compatibility matrix и локальный replay приведены в [production deployment runbook](backend/production-deployment-runbook.md). №16 остаётся открытой; production rollout не готов.
17. **Deployment smoke chain — IMPLEMENTED (read-only HTTP).** Скрипт [deployment_smoke.py](../apps/backend/scripts/deployment_smoke.py) требует явно указанный backend base URL, последовательно проверяет `GET /health` и `GET /ready` с bounded timeout и fail-closed exit code. Тестируется только через mock HTTP responses. Предварительные проверки, ожидаемые ответы, STOP criteria и ручная граница Telegram E2E зафиксированы в [production deployment runbook](backend/production-deployment-runbook.md). Скрипт не создаёт и не меняет production data; schema/grants checks и Telegram E2E остаются отдельными проверками.
18. **CI with disposable PostgreSQL — IMPLEMENTED.** Backend job запускает существующий `./scripts/local-test-db.sh test`, затем отдельный `if: always()` step вызывает существующий `./scripts/local-test-db.sh stop`; управление локальной БД не менялось. Workflow не передаёт `DATABASE_URL` или secrets; test script использует loopback disposable PostgreSQL, а backend guards проверяют target `travel_friend_test` на `127.0.0.1:55432` и отдельные test roles. Статический regression test проверяет порядок шагов, отсутствие `continue-on-error`, unconditional cleanup и отсутствие DB/secrets references в backend job. Обычная ошибка pytest остаётся failed job result. Граница проверки: hosted GitHub Actions и Docker cleanup при принудительном завершении runner здесь не запускались; `always()` не может очистить контейнер после потери runner.
19. **Local test DB hygiene — IMPLEMENTED.** Перед `reset` и `stop` `local-test-db.sh` проверяет точное имя контейнера, label `com.travel-friend.disposable-test-db=true`, единственные ожидаемые `POSTGRES_DB` / `POSTGRES_USER` и единственный binding `127.0.0.1:55432 → 5432/tcp`. Несовпадение или ошибка Docker inspect завершают команду до schema reset или удаления контейнера. `test` продолжает использовать только сформированные локальные loopback DSN; существующие backend guards проверяют разрешённые test targets. Regression tests используют Docker CLI stub и проверяют отказ без destructive calls. Реальные PostgreSQL/Docker destructive operations в этих тестах не запускались.
20. **Backend runbook/README — IMPLEMENTED (documentation).** `apps/backend/README.md` проверен по текущим runtime/scripts/CI и существующим backend runbooks; описание disposable DB guard обновлено для exact name, label, DB/user settings и loopback binding. Добавлены safe troubleshooting steps для Docker availability, stopped/mismatched container, `/ready` 503 и PostgreSQL test connection failures. README разделяет local/test/production и ссылается на manual deployment и historical security migration runbooks; rollout procedure не дублируется. Ограничение: provider runtime settings и direct backend ingress подтверждаются только в текущем provider environment.
21. **MVP BACKUP/RESTORE POLICY SET; LOCAL RESTORE + CURRENT APPLICATION GRANTS VERIFIED; FULL PROVIDER RECOVERY OPEN (2026-10-18).** Production archive и зашифрованная offsite copy в Google Drive подтверждены; локальная disposable PostgreSQL 17 schema/data restore, structural/RLS checks и current `app_runtime` grants/verifier прошли после локального replay repository migrations. Еженедельная ручная политика, хранение последних четырёх недельных копий, цели RPO ≤7 дней при соблюдении расписания и RTO 24 часа (не измерен) зафиксированы в [backup/restore runbook](backend/backup-restore-runbook.md). Supabase-managed recovery и production ACL не подтверждены; production restore не выполнялся. Migration drift остаётся отдельным риском №16.
22. **Rollback / forward-fix readiness — OPERATOR RUNBOOK READY (2026-10-18; no production execution).** [Production deployment runbook](backend/production-deployment-runbook.md) now separates frontend rollback, backend rollback, failed-migration forward-fix and potential data-corruption recovery, with exact-target/version checks, backend/DB compatibility gates, explicit approval boundaries and post-recovery validation. Existing backend read-only smoke is documented; provider history/permissions, maintenance/quiesce mechanism, Mini App smoke and full Supabase/production ACL recovery remain UNKNOWN or unverified. No production rollback/deploy/migration/restore was performed.

## Mandatory gate — External Test Cost Guardrails

External test нельзя открывать только потому, что P0.5 или документационный audit завершены. Полный inventory, модель нагрузки, admission/emergency policy и account-specific open questions находятся в [FinOps & external test guardrails](finops-external-test-guardrails.md). Findings не меняют application/provider configuration автоматически; каждый P0 implementation scope утверждается отдельно.

### Application-side review

- tester admission boundary / Telegram-ID allowlist;
- отсутствие серверного admission/pause mechanism сейчас блокирует внешние invites;
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
- размер первой tester cohort определить после provider review;
- определить baseline usage и monitoring cadence;
- определить stop thresholds;
- зафиксировать точный и проверенный manual stop procedure; пока он не испытан, считать его unverified.

Ни размер cohort, ни длительность теста, ни процентные stop thresholds этим backlog не утверждаются.

## Residual TODO / risks

- TravelIntent updates используют last-write-wins; optimistic concurrency остаётся отдельным решением.
- `destination_country_code` и `destination_place_ref` остаются вне owner UI/API.
- `GET /chats` требует отдельного review N+1 поведения.
- Production backend direct exposure требует проверки в External Test Cost Guardrails gate.
- Production deployed SHA/schema parity требует проверки в External Test Cost Guardrails gate.

## Control exit

1. Complete active deployment / CI / reproducibility stage.
2. Complete External Test Cost Guardrails gate and its separately approved implementation scope.
3. Repeat controlled multi-user E2E as required by those gates.
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
