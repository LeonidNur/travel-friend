# Выбор Codex skills

Этот документ помогает выбрать только релевантные skills. Жизненный цикл задачи и проверки заданы в [Codex task protocol](codex-task-protocol.md).

## Доступность

Перед применением проверь каталог skills и tools, доступный в текущем Codex runtime. Упоминание skill в этом документе, предыдущей задаче или внешнем ECC-репозитории не означает, что он установлен или доступен локально. Не утверждай наличие repo-local skills без подтверждённого каталога. Если подходящего skill нет, продолжай по проектным инструкциям и доступным источникам; если без него нельзя выполнить обязательную часть задачи, сообщи, чего не хватает.

## Выбор по типу задачи

| Задача | Выбирай при доступности | Подключай по необходимости |
|---|---|---|
| Frontend / Mini App | `frontend-patterns`, `coding-standards` | `e2e-testing` для критичного UI flow; `nextjs-turbopack` для dev/build поведения |
| Telegram auth / trust boundary | `security-review` вместе с релевантным frontend/backend skill | `e2e-testing` для согласованного auth flow |
| Backend / API contract | `backend-patterns`, `api-design`, `coding-standards` | `security-review` для auth/access/input; `tdd-workflow` для нового или изменённого поведения |
| Supabase / database | `supabase`, `backend-patterns` | `security-review` для RLS/grants; `tdd-workflow` для проверяемых schema/repository changes |
| Docs-only | `git-workflow` для Git/PR вопросов | `documentation-lookup`, только если требуется актуальная внешняя техническая документация |
| Bugfix / integration | skill затронутого домена | `e2e-testing` для user flow; другие skills только для конкретного соседнего контракта или риска |
| Review | skill соответствующей области | `security-review` для security review; `api-design` для API contract |

Skills помогают выполнить задачу, но не расширяют её scope, approval или обязательные проверки. Выбирай минимальный достаточный набор; не загружай общий набор «на всякий случай».
