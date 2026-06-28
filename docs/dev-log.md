# Dev Log

## 2026-06-28 - Day 1

### What was done

- Set up the first Next.js Telegram Mini App skeleton in `apps/mini-app`.
- Added a mobile-first bottom navigation and routed the app to `/`, `/chats`, `/trips`, and `/profile`.
- Wired Telegram SDK environment detection so the app can recognize Telegram and read launch parameters when available.
- Added a browser fallback so the project can still be opened and developed outside Telegram.
- Fixed the hydration mismatch path by keeping Telegram state client-side and separating loading, Telegram, and browser states.

### Technical decisions

- Telegram Mini App is the primary MVP surface instead of a standalone mobile app.
- AI help will be embedded inside chats and trips, not exposed as a separate tab.
- Local browser development remains supported so the app can be iterated on without Telegram every time.
- The current build is intentionally a shell: routes, layout, navigation, and environment detection come first, product logic later.

### What remains next

- Telegram bot and public URL setup.
- Telegram auth flow and server-side `initData` validation.
- Supabase schema for users, trips, chats, and membership data.
- Profile MVP, Trips MVP, and Chats/groups flow.
- Embedded AI assistant inside trip and chat contexts.
