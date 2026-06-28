# travel-friend

Travel Friend is being built as a Telegram Mini App for finding travel companions and planning trips together.

## Current Status

Day 1 foundation is in place:

- Next.js Mini App skeleton is running in `apps/mini-app`
- bottom mobile navigation is set up
- routes exist for `/`, `/chats`, `/trips`, and `/profile`
- Telegram SDK environment detection is wired up
- browser fallback works outside Telegram for local development
- hydration mismatch around Telegram state handling has been addressed

The AI helper is not a separate tab. It will be embedded inside chats and trips when that flow is implemented.

## Local Setup

```bash
cd apps/mini-app
npm install
npm run dev
npm run typecheck
npm run build
```

## Project Structure

```text
travel-friend/
  README.md
  CHANGELOG.md
  docs/
    roadmap.md
    dev-log.md
    team-workflow.md
  apps/
    mini-app/
      app/
        page.tsx
        chats/page.tsx
        trips/page.tsx
        profile/page.tsx
        layout.tsx
      components/
        AppHeader.tsx
        BottomNavigation.tsx
        ProfileDiagnostics.tsx
        TelegramAppShell.tsx
      lib/
        navigation.ts
        telegram.ts
```

## Product Direction

- Telegram Mini App is the MVP surface.
- User profile, trips, chats, and AI assistance are the core product areas.
- AI support will live inside the trip and chat experience, not as a separate assistant screen.
