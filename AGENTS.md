# Travel Friend — Codex Rules

We are building a Telegram Mini App MVP for finding travel companions.

ChatGPT is used for product thinking, architecture, planning, and task decomposition.
Codex is used for implementation only.

## Product MVP

The MVP includes:

- Telegram Mini App frontend
- User profile
- Trip creation
- Trip discovery
- Joining or requesting to join a travel group
- Basic group/chat entry point
- AI travel helper for route, logistics, prices, and recommendations

## Expected stack

- TypeScript
- Next.js
- React
- Telegram Mini Apps SDK / Telegram WebApp API
- Supabase Postgres
- API routes or server actions for backend logic
- Playwright for E2E tests

## How Codex should work

Before changing code:

1. Read the existing files.
2. Explain what files need to change.
3. Make a short implementation plan.
4. Wait only if the task is ambiguous or dangerous.
5. Prefer small, focused diffs.

When implementing:

1. Keep code simple.
2. Do not over-engineer.
3. Do not add unnecessary abstractions.
4. Do not introduce new libraries unless needed.
5. Use TypeScript types.
6. Validate all API inputs.
7. Keep frontend, backend, database, and AI logic separated.

After changing code:

1. Run lint.
2. Run typecheck.
3. Run tests if available.
4. Run build if available.
5. Summarize what changed.
6. Mention remaining risks or TODOs.

## Security rules

Never expose secrets to the client.

Never commit or modify:

- .env
- .env.local
- .env.production
- API keys
- bot tokens
- Supabase service role key
- OpenAI / Anthropic / Mistral keys

Telegram Mini App auth must be validated on the server.

Never trust initDataUnsafe for authentication.

Use raw Telegram initData and server-side validation.

## Preferred ECC skills

Use these skills when relevant:

- coding-standards
- frontend-patterns
- backend-patterns
- api-design
- tdd-workflow
- e2e-testing
- verification-loop
- security-review
- documentation-lookup
- nextjs-turbopack

## Preferred agent behavior

Use explorer mode when the task is about understanding the project.

Use implementation mode only after the task is clear.

Use reviewer mode after code changes.

Use docs_researcher mode before working with:

- Telegram Mini Apps
- Supabase
- Next.js
- Vercel
- Auth
- Payments
- external APIs

## Code quality rules

Prefer this structure:

- components for UI
- lib for shared helpers
- services for business logic
- db or database for database access
- app/api for API routes
- types for shared TypeScript types
- tests for unit and E2E tests

Avoid:

- huge files
- duplicated logic
- business logic inside UI components
- hardcoded secrets
- direct database calls from client components
- unvalidated request bodies