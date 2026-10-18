# Manual production deployment runbook

> **Статус:** операторский порядок для текущего MVP. Runbook не выполняет и не разрешает production rollout сам по себе. Каждый production rollout требует отдельного подтверждения оператора непосредственно перед запуском.

## Границы и источники

Production состоит из backend-контура Render, frontend Mini App на Vercel и Supabase/PostgreSQL. Реальные project/service IDs, production URLs, provider settings, health-check configuration и точные команды ручного deploy в репозитории не заданы. Оператор сверяет target и использует поддерживаемый ручной механизм в текущем provider UI/CLI; не подставляет guessed IDs, URLs, команды или настройки.

Auto-Deploy остаётся **Off**. До rollout оператор проверяет в provider settings, что выбранные production services не начнут deploy автоматически от Git события. Не включать Auto-Deploy в рамках этого workflow. Фактическое состояние frontend deployment automation должно быть проверено в provider: репозиторий его не подтверждает.

Этот документ задаёт порядок для нового изменения и не является повтором [завершённого security cutover](production-security-migrations-runbook.md). Там зафиксированы exact исторические SHA, migration suffix, grants, preconditions и failure boundary; их нельзя переносить на новое изменение или повторять как универсальные команды. Источники истины: текущие migrations в `supabase/migrations/`, grants/verifier/gate в `apps/backend/scripts/`, backend HTTP contracts и выбранный target commit.

## 0. Release provenance record

Для каждого выпуска оператор сохраняет короткую запись до и после rollout. Запись должна связывать **intended revision** с **фактически deployed revision**; текущая ветка, локальный `HEAD`, имя deployment и время сами по себе не заменяют Git SHA.

До rollout заполнить intended Vercel/Render SHA, подтверждённые project/service/environment, ожидаемый production migration ledger и проверенный backend↔DB/frontend↔backend contract. После каждого provider deployment открыть детали именно выбранного production deployment и записать его фактический Git SHA (или отметить `UNKNOWN`, если provider его не показывает), deployment ID/URL и timestamp в UTC. Для DB записать Supabase project identity, observed PostgreSQL version и migration version/name inventory с временем наблюдения. Не включать secrets, DSN, пользовательские записи или PII.

Если provider не раскрывает SHA, release provenance для этого компонента остаётся `UNKNOWN`: остановить rollout или получить подтверждение из другого независимого deployment record, привязанного к тому же deployment ID. Не выводить SHA из даты, alias, текущего branch HEAD или соседнего компонента. Проверить, что после rollout production alias указывает на ожидаемый deployment. Сохранить запись в принятом operator release record; отдельное хранилище для MVP не вводится.

Минимальные поля записи:

| Поле | До rollout | После rollout |
|---|---|---|
| Target | provider, project/service, environment, подтверждённый production URL | фактически выбранный provider target и production alias |
| Frontend | intended Git SHA и contract expectations | deployed SHA либо `UNKNOWN`, deployment ID, timestamp |
| Backend | intended Git SHA и contract expectations | deployed SHA либо `UNKNOWN`, deployment ID, timestamp |
| Database | ожидаемые migration versions, schema/grants gates | observed project identity, PostgreSQL version, migration inventory и timestamp |
| Validation | CI/review, compatibility evidence, known-good candidate | HTTP smoke, ручные основные flows, verifier/gate results, решение и остаточные риски |

Release считается provenance-complete только когда intended и actual SHA каждого изменённого приложения совпадают с approved SHA, target подтверждён, а schema/API совместимость проверена. `UNKNOWN` нельзя трактовать как совпадение. Запись о прошлом успешном deployment — кандидат на known-good только после проверки его SHA, совместимости с **текущей** DB/API и доступности у провайдера; rollback не возвращает schema, grants, secrets или provider settings.

### Read-only production snapshot — 2026-10-18

Ниже зафиксированы наблюдения аудита на указанную дату. Это снимок, а не гарантия последующего состояния и не разрешение на rollout.

| Компонент | Подтверждённое наблюдение | Уверенность / ограничение |
|---|---|---|
| Vercel frontend | Project `travel-friend-mini-app`, production deployment `dpl_Di21ceCkxg4poxD2Udyfeanar4En`, READY, created `2026-09-02T17:26:08Z`; alias `travel-friend-mini-app.vercel.app`. | Environment и deployment identity — VERIFIED. Deployment record показывает source `cli`, не содержит Git SHA или Git source; фактический frontend SHA — **UNKNOWN**. |
| Render backend | Service `travel-friend-api`, branch `develop`, manual deployment, Auto-Deploy Off. Live deployment `dep-dapvgnlg1s2s73dicitg`, SHA `b25e08dce158b7fe7ea6d17b40d96c3e893330fa`, завершён `2026-09-23T16:04:41Z`. | Service settings и deployed SHA — VERIFIED по provider history. |
| Supabase | Project `travel-friend-dev` (`tlgprfsecdasloqnuyjo`), `ACTIVE_HEALTHY`; PostgreSQL `17.6.1.165`. Production ledger содержит 19 migrations. | Project identity/status/version/ledger — VERIFIED в read-only provider inventory на 2026-10-18. |

На commit Render `b25e08d…` находится 19 migration-файлов; эти 19 соответствуют production ledger. В текущем обследованном repository inventory есть ещё четыре более поздние migrations, отсутствующие в production ledger: `20260924090000_completed_onboarding_active_travel_intent_invariant.sql`, `20260924100000_session_lifecycle_baseline.sql`, `20260924110000_backend_field_domain_limits.sql`, `20261003090000_chat_participant_public_profile.sql`. Это наблюдаемое migration drift, а не подтверждение, что все остальные schema objects совпадают.

Read-only function/permission comparison подтверждает для Render SHA `b25e08d…` наличие и `app_runtime` EXECUTE для его 12 используемых public functions, включая восьмиаргументную `bootstrap_telegram_login` и `chat_participant_profile_projection(uuid)`. Следовательно, проверенная backend↔DB compatibility для этого SHA ограничена его наблюдаемым migration/function/runtime-permission surface; полный schema drift audit не завершён. На текущем repository source используются шестипараметрическая версия `bootstrap_telegram_login` и `chat_participant_public_profile(uuid,uuid)`, которых в production на дату проверки нет. Без применения соответствующих migrations текущий source **не совместим с production**: Telegram login и просмотр профиля участника чата затронуты. Перед выпуском такого source нужны отдельная migration review/preflight, grants verification и явное разрешение на production migration; migrations не применялись в этом аудите.

Frontend↔backend compatibility — **UNKNOWN**: frontend deployed SHA не раскрыт provider record, фактическое `BACKEND_API_ORIGIN` не проверялось/не раскрывалось, а source-level frontend tests не подтверждают deployed pair. Текущий read-only HTTP smoke Render URL завершился network timeout на `GET /health`; `GET /ready` не запускался, поскольку smoke останавливается на первой ошибке. Поэтому свежие live health/readiness и основные production flows этим аудитом не подтверждены.

Известный backend deployment SHA `b25e08d…` — reference для анализа совместимости, но не автоматическое разрешение rollback: перед выбором known-good нужно заново удостовериться, что deployment доступен в Render history и подходит текущим DB/API state. Более ранний SHA из истории предшествует security cutover и не считается безопасным rollback candidate без отдельного доказательства.

**Текущий итог №16: PARTIALLY VERIFIED / OPEN.** Для закрытия остаются: получение frontend deployed SHA, подтверждение фактического backend origin без раскрытия credentials, повторяемая полная сверка production schema drift, live health/readiness и проверка основных flows после устранения timeout, а также явное решение о порядке миграций и grants для текущего repository source. Не объявлять полную frontend/backend/DB совместимость или полную production provenance.

## 1. Preflight и Git SHA

1. Получить отдельное подтверждение оператора на конкретный production rollout. Зафиксировать, какие backend/frontend изменения и DB изменения входят в него.
2. В чистом deployment checkout проверить repository, branch, commit и рабочее дерево. Зафиксировать полный target Git SHA; он должен совпадать с reviewed/approved revision. Не деплоить локальные незакоммиченные изменения.
3. Проверить GitHub Actions CI/review результата именно для этого SHA и наличие требуемых lockfiles. Текущий `.github/workflows/ci.yml` запускает frontend `npm run check` и backend tests с disposable PostgreSQL на `push`/`pull_request`; это проверка кода, не production deployment. Не считать локальный build заменой CI результата. Настроенные branch-protection/required-check rules из репозитория не подтверждаются и проверяются оператором отдельно.
4. В provider вручную выбрать подтверждённые production project/service/environment и тот же SHA. До подтверждения target ничего не запускать.
5. Проверить Auto-Deploy Off и доступность заранее согласованного способа quiesce/maintenance, если он требуется матрицей ниже. Репозиторий не задаёт универсальный maintenance toggle или его команду.

**STOP:** неизвестный target, dirty checkout, несовпадающий SHA, failed CI или незавершённый review, который обязателен по release policy, включённый или непроверенный Auto-Deploy, неподтверждённая production environment, либо отсутствие нужного quiesce/restore способа.

## 2. Проверить production schema и grants

До выбора порядка deployment сравнить фактическую production migration history и effective runtime contract с состоянием, нужным target SHA:

- определить применённый migration version и точный набор ожидаемых pending migrations; пропуски, неожиданные версии или history drift требуют остановки и отдельного разбора;
- для изменений grants/RLS подтвердить ожидаемую схему, ownership, policies, capability functions и privileges read-only verifier-ами из `apps/backend/scripts/`;
- когда изменён runtime contract, использовать production runtime gate с подтверждённой runtime identity и только после того, как DB contract/grants подготовлены;
- если DB не меняется, подтвердить, что существующая schema/grants совместимы с target backend.

Любое подключение выполняет оператор к независимо проверенному production target и с соответствующей least-privileged/provisioning identity. Не передавать DSN/keys в Git, shell history или отчёт. Имена переменных и примерный порядок из исторического cutover не означают, что его privileged команды подходят новой миграции.

**STOP:** production identity/target не подтверждены; migration history неожиданна; verifier или runtime gate не прошёл; или нужный schema/grants state невозможно проверить. Не исправлять drift через `migration repair`, ручное редактирование migration history, ad-hoc SQL или возврат broad grants.

## 3. Оценить DB/API compatibility и выбрать порядок

Для каждой migration и backend/API change определить, могут ли одновременно работать текущие и целевые backend instances на старой/новой schema, и может ли текущий frontend работать с целевым backend API (и наоборот на время переключения). Проверить SQL, migration comments, backend contracts и реальные call sites; слово «additive» само по себе не доказывает совместимость.

| Класс изменения | Предпочтительный порядок | Maintenance/quiesce и условие остановки |
|---|---|---|
| Только backend/frontend или полностью backward-compatible DB/API изменение | Deploy backend, затем frontend, если frontend требует новый API; иначе frontend/backend в порядке, проверенном совместимостью. | Обычно можно без quiesce только после подтверждения overlap compatibility и provider rollout behavior. Остановиться при несовпадении SHA или несовместимом ответе/ошибке health/smoke. |
| Additive DB migration, совместимая со старым и новым backend | DB-first: применить и проверить расширенную schema, затем deploy backend и при необходимости frontend. | Quiesce не нужен только если доказано, что миграция не ломает активные старые instances и apply не требует остановки. Любая неопределённость, lock/latency concern или недоказанная совместимость требует maintenance-плана/операторского решения до apply. |
| Breaking DB contract, API contract или grants/RLS change | Не делать одноступенчатый rollout. Сначала спроектировать expand/contract либо согласованный coordinated cutover; определить совместимые промежуточные версии и точный recovery path. | Quiesce/maintenance требуется, если старый и новый runtime не могут безопасно сосуществовать или это требует migration. Если его безопасный способ не подтверждён, rollout не начинать. Grants/RLS failure означает STOP; не ослаблять ограничения как workaround. |
| Change, требующий expand/contract | Expand schema/capability backward-compatibly → deploy backend, работающий со старым и расширенным контрактом → deploy frontend/API callers → подтвердить, что старые instances/callers больше не используют legacy contract → отдельно согласовать contract migration/removal. | Contract phase — отдельный rollout с повторным preflight и явным подтверждением. Не удалять legacy overload/column/policy в том же шаге, что впервые переключает callers, если coexistence не доказана. |

**DB-first или backend-first не является постоянным правилом.** DB-first допустим лишь для проверенной additive/backward-compatible миграции. Backend-first допустим только если target backend работает на текущей production schema и rollout не направит requests на несовместимую смешанную версию. API и frontend sequencing определяется проверенным контрактом и фактическим переключением instances.

## 4. Выполнить ручной rollout

1. Непосредственно перед изменением production оператор повторно подтверждает target service/environment, Git SHA, schema/grants preconditions, порядок из decision matrix, Auto-Deploy Off и необходимость quiesce. Это отдельный approval gate; наличие этого runbook или прохождение CI не является разрешением.
2. Если требуется quiesce, применить заранее проверенный оператором механизм и подтвердить прекращение соответствующего traffic до DB/API несовместимого шага. Runbook не выдумывает provider-specific maintenance command.
3. Применить только согласованные migrations/grants в выбранном порядке по отдельной проверенной инструкции для конкретного изменения. Для migration apply сверить точный pending suffix до применения. Не использовать исторические one-off команды как общий шаблон.
4. Ручным provider механизмом развернуть backend SHA и затем frontend SHA в порядке, установленном выше. Подтвердить фактически deployed SHA после каждого service rollout. Не менять secrets, DATABASE_URL, network rules, providers или Auto-Deploy как часть этого шага без отдельного scoped approval.
5. Проверить readiness/smoke. Traffic восстанавливать только после выполнения критериев ниже.

Поскольку provider settings и deployment CLIs не подтверждены в репозитории, конкретные нажатия в UI, `render`/`vercel` команды, target URLs и env values должны быть вписаны/проверены оператором для выбранного проекта перед фактическим rollout. Не угадывать их.

## 5. Smoke и критерии остановки

### Автоматический read-only HTTP smoke

Перед запуском оператор должен:

1. Убедиться, что deployment завершён для подтверждённого backend service/environment, а его фактически deployed SHA совпадает с approved SHA.
2. Проверить CI/review, Auto-Deploy Off и все применимые к изменению migration, schema, grants и runtime gates из разделов выше.
3. Независимо подтвердить backend base URL выбранного target. Не брать URL из непроверенного deployment output и не сохранять секретные значения в команде или отчёте.
4. Запустить из корня репозитория, подставив только подтверждённый backend base URL:

   ```sh
   cd apps/backend
   uv run --group dev python scripts/deployment_smoke.py --base-url "$CONFIRMED_BACKEND_BASE_URL"
   ```

`deployment_smoke.py` последовательно выполняет только `GET /health` и `GET /ready`, с timeout 5 секунд на каждый запрос и без перехода по redirects. Ожидаются HTTP 200 и точные тела `{"status":"ok"}` и `{"status":"ready"}`; при успехе команда завершается с кодом 0. Любая ошибка соединения/timeout, redirect, иной HTTP status или тело ответа даёт `FAIL` и non-zero exit code; цепочка останавливается на первой ошибке. Запросы не создают и не меняют пользовательские данные.

`/health` подтверждает только liveness процесса. `/ready` подтверждает доступность минимальной DB dependency через `SELECT 1`; этот smoke не проверяет deployed schema parity, grants/RLS, Telegram authentication или бизнес-сценарии. Schema/grants проверяются отдельными verifier-ами; HTTP health их не заменяет.

**STOP:** не запускать smoke при неподтверждённых target/base URL/SHA или незавершённых обязательных preflight gates. При любом non-zero результате, неожиданном redirect/ответе или transport error остановить rollout, оставить traffic quiesced, если он был quiesced, и расследовать причину. Не продолжать traffic restore до успешных обязательных проверок.

### Ручной Telegram E2E

Полный сценарий Telegram Auth → Profile/TravelIntent → Discover/Match → Chat/Messages → Trips остаётся отдельной ручной проверкой. Его выполняют только по отдельно согласованному сценарию, с разрешённым test account и определёнными правилами тестовых данных. Автоматический read-only smoke не аутентифицируется, не создаёт пользователей/сообщения/чаты/поездки и не заменяет Telegram E2E.

Зафиксировать observed SHA, migration version, результаты verifier/gate, HTTP smoke и решение о traffic restore в operator deployment record. Provenance самого deployment относится к №16.

Немедленно остановиться и оставить traffic quiesced, если target SHA не совпал, migration history/schema/grants не соответствуют плану, любой verifier/gate/health/readiness/smoke падает, появляются неожиданные ошибки или выясняется, что старая и новая версии несовместимы. Не переключать сервис обратно на старый backend после breaking DB/API/grants change без доказанной совместимости; использовать отдельно согласованный rollback/forward-fix procedure задачи №22. Если миграция изменила данные/схему, допустимость восстановления зависит от заранее проверенного backup/restore плана №21. Не импровизировать с ручным SQL, `migration repair`, credential changes или provider settings.

## 6. Recovery после неудачного deployment или DB change (№22)

Этот раздел готовит operator procedure, но сам не выполняет и не разрешает
production action. Перед rollback, traffic isolation, migration или restore
оператор получает отдельное явное подтверждение на выбранное действие.

### 6.1 Общий recovery preflight

Сначала зафиксировать время инцидента (UTC), симптомы, затронутые компоненты,
последний успешный и текущий deployment IDs/SHA, фактические migration records,
выполненные operator actions и результаты проверок. Не помещать в запись
credentials, пользовательские сообщения или PII.

Перед любым действием независимо сверить target в provider dashboard:

- Vercel project `travel-friend-mini-app`, Production environment и домен,
  фактически назначенный production deployment;
- Render service `travel-friend-api`, ветку `develop`, текущий и целевой deploy
  SHA; Auto-Deploy должен оставаться Off;
- при DB-проверке — Supabase project `travel-friend-dev`
  (`tlgprfsecdasloqnuyjo`) и ожидаемую базу `postgres`.

Имена подтверждены, но точные provider IDs, production URLs, history/retention
доступных deploys, frontend automation и доступные operator permissions в Git не
зафиксированы. Сверить их в provider UI для конкретного инцидента; при
неоднозначности — **STOP**. Не считать rollback приложения возвратом DB schema,
DB data, secrets, environment variables, domains или provider configuration.
Известный migration drift production↔Git остаётся отдельным риском задачи №16;
rollback приложения или новый forward-fix сам по себе этот drift не разрешает.

«Известная рабочая версия» — это конкретный успешный deployment, для которого
можно независимо подтвердить deployment ID, полный Git SHA и соответствующую
DB/API compatibility. Последний по времени deploy сам по себе не является
известным рабочим. Проверить, что SHA доступен в repository и deployment history,
а настройки/окружение target остаются ожидаемыми. Не создавать платный plan и не
менять provider settings, чтобы расширить доступную историю rollback.

Применимость и ограничения механизмов сверены с официальной документацией:
[Vercel production rollback](https://vercel.com/docs/deployments/rollback-production-deployment),
[Vercel rollback CLI](https://vercel.com/docs/cli/rollback) и
[Render rollback](https://render.com/docs/rollbacks). Их наличие не подтверждает
настройки или разрешения конкретного project/service. Для Mini App автоматической
проверки основных UI flows в репозитории нет; существующий
[`deployment_smoke.py`](../../apps/backend/scripts/deployment_smoke.py) проверяет
только backend HTTP health/readiness.

Rollback Vercel/Render возвращает deployment artifact или переключает traffic на
другой artifact и в общем случае повторяем как provider operation, но не откатывает
DB schema/data, migration ledger, environment variables или secrets. DB DDL и
изменения данных считать необратимыми, пока обратимость конкретной операции не
доказана. Forward-fix предпочтительнее слепого reverse SQL; restore может удалить
корректные более новые данные и всегда требует отдельного решения.

### A. Неудачный frontend deployment (Vercel)

**Признаки:** production build/deployment завершился ошибкой; Mini App не
открывается или отдает явную ошибку; после нового frontend SHA нарушился ранее
работавший flow при здоровом backend.

1. В Vercel проверить правильные project, Production environment/domain, failed
   deployment ID/SHA, build/runtime logs и назначенный сейчас production
   deployment. Уточнить, затронут только frontend ли это: проверить backend
   `/health` и `/ready` по независимо подтверждённому base URL.
2. Найти предыдущий успешный production deployment. Сверить его полный SHA,
   frontend API contract и build-time environment requirements с текущим backend.
   Rollback UI/routing может вернуть только frontend artifact; он не возвращает
   environment variables или backend deployment.
3. Если кандидат доступен текущему плану/проекту и совместим с текущим backend,
   оператор отдельно подтверждает rollback и выполняет его через Vercel
   deployment UI/доступный аккаунту механизм. Vercel ограничивает rollback
   доступной deployment history и plan; если предыдущий подходящий deployment
   недоступен без upgrade — **STOP**, не менять тариф. Не выполнять guessed CLI
   command или выбирать deployment только по времени.
4. Дождаться завершения и проверить, что production domain назначен ожидаемому
   deployment ID/SHA. Убедиться, что environment/configuration не менялись.
5. Проверить загрузку Mini App, доступность статических ресурсов и вызовы
   backend. Запустить backend read-only smoke из §5. Telegram Auth/профиль и
   основные пользовательские flows проверять только вручную с разрешённой
   тестовой учётной записью; auth и часть flow создают/изменяют DB state, поэтому
   без отдельного разрешения и согласованных тестовых данных их не выполнять.

**Успех:** ожидаемый frontend deployment активен, Mini App открывается, backend
health/readiness проходят, разрешённые проверки интерфейса проходят и нет новых
связанных ошибок. **STOP:** нет точного известного рабочего deployment; frontend
SHA не совместим с текущим backend; rollback entitlement/history не позволяет
выбрать target; domain/environment изменились; smoke/UI проверка не проходит.
При неуспехе не переключаться вслепую на другой deployment; сохранить состояние
и подготовить reviewed fix/forward deployment.

### B. Неудачный backend deployment (Render)

**Признаки:** deploy failed/canceled, экземпляр не становится healthy, `/health`
или `/ready` падает после rollout, либо коррелированные ошибки показывают
несовместимость backend/API.

1. В Render подтвердить `travel-friend-api`, production service, branch `develop`,
   фактический deploy SHA/status и logs. Сверить `/health` и `/ready` с exact
   operator-confirmed backend URL. Не менять `DATABASE_URL`, secrets или service
   configuration для «починки» rollback.
2. До выбора старой версии установить, менялась ли production DB, migration
   ledger, grants/RLS, functions или API contract после версии-кандидата.
   Сопоставить конкретные call sites старого backend с текущими tables, columns,
   functions, policies и grants. Проверить migration SQL и runtime verifier/gate
   по применимости. Совместимость не выводить только из того, что миграция
   называлась additive.
3. Если DB contract не менялся либо доказана обратная совместимость текущей DB
   со старым SHA, выбрать exact ранее успешный Render deployment/SHA из history.
   Render Dashboard предоставляет rollback к предыдущему успешному deploy; также
   допускается manual deploy конкретного commit, если target SHA и deployment
   method подтверждены в текущем service. Отдельно подтвердить действие, затем
   проверить фактический active SHA. Auto-Deploy оставить Off.
4. После возврата запустить `deployment_smoke.py` по подтверждённому backend
   origin. При успехе проверить только согласованные основные flows с разрешённой
   тестовой учётной записью; smoke не доказывает schema parity и Telegram
   business-flow correctness.

Пользовательский checklist для разрешённой ручной проверки: запуск Mini App и
Telegram Auth → Profile/TravelIntent → Discover → Chats/Messages → Trips
List/Detail. Auth создаёт session state; interest decisions, сообщения и создание
Trip меняют production data. Их выполнять только при наличии отдельно
разрешённой тестовой учётной записи и согласованного порядка очистки/сохранения
test data; иначе ограничиться запуском и read-only экранами и отметить write flows
как непроверенные.

**Успех:** Render показывает ожидаемый known-good SHA, `/health`=`ok`,
`/ready`=`ready`, применимые verifier checks проходят; разрешённые flow checks
успешны. **STOP:** текущая DB schema/grants появились после rollback target и
совместимость не доказана; migration ledger неясен; нужных deploy artifacts/SHA
нет; readiness/verifier падает. В этом случае оставить deployment как есть или
остановить traffic только подтверждённым способом и перейти к forward-fix
разбору; не применять обратные миграции.

### C. Неудачная database migration

**Признаки:** migration command завершился ошибкой, появился неизвестный
ledger/schema state, verifier/grants gate не проходит, либо backend после DB
change видит отсутствующие объекты/ошибки запросов.

1. **STOP: автоматический rollback migrations запрещён.** Не запускать reverse
   SQL, `db reset`, `migration repair`, ручные правки `supabase_migrations` или
   повторный blind `db push`. Не предполагать, что весь batch был атомарным:
   установить фактический результат и транзакционные границы конкретной
   migration по логам и read-only состоянию.
2. Подтвердить project/database identity и ограничить дальнейшие deployment и
   DB changes. Способ остановки/изоляции traffic для текущего Render service
   отдельно не подтверждён; использовать его только если оператор заранее
   проверил способ и дал отдельное разрешение. Сохранить sanitized logs и exact
   failed migration version.
3. Read-only проверками определить: какие migration records записаны; какие
   ожидаемые tables/columns/functions/policies/grants присутствуют; затронуты ли
   data или только schema; работают ли текущий и target backend с этим состоянием.
   При migration drift, частично применённой migration или неизвестных data
   effects — **STOP** и эскалировать review.
4. Проверить применимый verified backup по [№21](backup-restore-runbook.md), его
   timestamp/data window, checksum и проверенный локальный restore путь. Это
   входные данные оценки, а не разрешение на production restore. Full Supabase
   recovery и production ACL не подтверждены; production restore автоматически
   не выполнять.
5. Подготовить минимальный новый forward-fix migration на отдельной reviewed
   revision. Воспроизвести состояние и fix только в disposable PostgreSQL;
   проверить migration order, повторное чтение из исходной/target schema,
   `app_runtime` grants verifier и backend tests. Не менять уже применённый SQL
   migration и не редактировать production ledger для прохождения проверки.
6. До production apply получить отдельное разрешение на точный migration SHA,
   target, SQL scope, backup decision и maintenance plan. Применять только по
   проверенной для данного change инструкции из §1–4; после — сверить migration
   history, schema/grants verifier, `/health`, `/ready` и разрешённые flow checks.

**Успех:** согласованный forward-fix завершён без неожиданных schema/data
effects, ledger соответствует фактическому применению, verifier/gate и smoke
проходят, operator record содержит итог и residual risks. **STOP:** невозможно
доказать target, состояние миграции или совместимость; fix требует неутверждённых
DDL/grants, данных, credentials/provider changes; или требуется automatic
rollback/production restore. Если forward-fix не проходит, не импровизировать
следующий SQL: оставить изменения и traffic в безопасном подтверждённом состоянии
и запросить отдельный recovery decision.

### D. Потенциальное повреждение данных

**Признаки:** некорректные/пропавшие записи, неожиданный массовый update/delete,
нарушенные инварианты, несоответствие данных в пользовательских flows или
инцидентная метрика/жалоба.

1. Немедленно прекратить новые deployment и DB changes. Оценить, продолжают ли
   приложение или job писать данные. Quiesce/maintenance механизм не
   подтверждён в проектной конфигурации: не изобретать toggle или команду;
   применить только заранее проверенный оператором способ с отдельным
   разрешением. Не останавливать service способом, последствия которого
   неизвестны.
2. Сохранить временной интервал, affected tables/операции, deployment/migration
   SHA и sanitized logs. Оценить масштаб и границу данных только безопасными
   read-only средствами; не собирать PII в incident report и не выполнять
   корректирующие SQL-записи наугад.
3. Сравнить предполагаемый affected window с verified backup/offsite copy и
   текущей политикой №21. Еженедельная копия не гарантирует отсутствие потери
   данных за прошедший интервал; точное сравнение counts без общего snapshot не
   является доказательством. Проверить отдельно зависимости схемы, runtime
   grants и production ACL; последние не полностью проверены.
4. Предпочесть минимальный reviewed forward-fix/repair, если он безопасно
   восстанавливает инварианты без потери корректных новых данных. Если обсуждается
   restore, сначала потребовать отдельный анализ data loss, проверенный restore
   на disposable target и явное отдельное утверждение recovery procedure.
   **Автоматический production restore запрещён.** Ни backup runner, ни local
   restore smoke не выполняют его.

**Успех:** scope инцидента установлен; согласованная repair/recovery операция
завершена; integrity/constraints, migration ledger, runtime grants/verifier,
health/readiness и разрешённые flows проверены; остаточная потеря и риски
зафиксированы. **STOP:** scope неясен, есть продолжающиеся writes без безопасного
quiesce, backup может перезаписать корректные данные, отсутствует разрешение или
не доказана возможность восстановления. Не выполнять production restore для
«проверки».

### Post-recovery record и обязательные проверки

После любого recovery записать incident UTC time, environment/target, исходный и
итоговый deployment IDs/SHA, migration records, действия/подтверждения,
результаты `/health`, `/ready`, применимых schema/grants checks и разрешённых
flow checks, а также UNKNOWN/BLOCKED items. Не отмечать recovery успешным, если
обязательная для изменения проверка не выполнялась; указать, почему.

Общий **STOP** действует при любой неопределённости target, известной рабочей
версии, backend/DB compatibility или data effects; при необходимости платного
upgrade; при запросе provider/secrets changes; либо если действие необратимо и
для него нет отдельного разрешения и проверенной процедуры.

## Связанные задачи

- **№16 — provenance/environments:** фиксирует/автоматизирует доказательство environment, commit/deployed SHA и schema parity; этот runbook требует сверять их вручную.
- **№17 — deployment smoke:** read-only HTTP chain `/health` → `/ready` документирован в этом разделе и реализован скриптом `apps/backend/scripts/deployment_smoke.py`; Telegram E2E остаётся ручным.
- **№21 — backup/restore:** MVP backup policy, production archive/encrypted offsite copy и локальный schema/data + application-grants restore smoke зафиксированы в [backup/restore runbook](backup-restore-runbook.md). Full Supabase recovery и production ACL не подтверждены.
- **№22 — rollback/forward-fix:** operator procedure описана в этом документе, §6. Она не является автоматизацией или разрешением на production action; старый backend не считается допустимым rollback target без проверки compatibility с текущей DB.

Завершение №15 как docs-ready не закрывает №16, №17 или №21, не подтверждает текущие provider settings и не означает, что следующий production deployment уже одобрен. №22 описывает процедуру, но не подтверждает, что реальные rollback или recovery уже выполнялись.
