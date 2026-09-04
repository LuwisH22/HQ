# LFG HQ

Private internal operating system for an esports organization — messages,
projects, calendar, roster and files in one desktop application.

Built as a **desktop app first** (Tauri v2 + React + TypeScript), with the same
frontend serving a responsive web/PWA companion. Supabase provides the entire
backend: Postgres, Auth, Realtime and Storage. There are no other servers.

> **Status: Phase 1 (Foundation) complete.**
> Authentication, organizations, profiles, roles, permissions, Row Level
> Security, the dashboard and the application shell are built and working.
> Chat, projects, calendar, files and notifications arrive in Phases 2–6; their
> navigation entries exist and lead to pages that say so.

---

## Table of contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Supabase setup](#supabase-setup)
- [Running the desktop app](#running-the-desktop-app)
- [Testing](#testing)
- [Building for release](#building-for-release)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Project structure](#project-structure)

---

## Requirements

| Tool             | Version          | Needed for                     |
| ---------------- | ---------------- | ------------------------------ |
| Node.js          | 20.19+ or 22.12+ | everything                     |
| npm              | 10+              | everything                     |
| Rust + Cargo     | 1.77.2+          | the desktop app only           |
| MSVC Build Tools | 2019+ (Windows)  | the desktop app only           |
| Docker Desktop   | any recent       | local Supabase only            |
| Supabase CLI     | 1.200+           | migrations, types, local stack |

The web/PWA build, the type checker, the linter and the unit tests need **only
Node**. Rust is required exclusively to compile the Tauri binary.

### Installing the Rust toolchain (Windows)

```bash
winget install --id Rustlang.Rustup -e
```

```bash
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Open a new terminal afterwards so `cargo` is on `PATH`. WebView2 ships with
Windows 11; on Windows 10 the installer bundles a bootstrapper for it.

---

## Quick start

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see
[Supabase setup](#supabase-setup)), then:

```bash
npm run dev
```

The web app runs at <http://localhost:1420>. If the environment is missing or
malformed the app renders a setup screen naming exactly what is wrong rather
than failing with network errors.

---

## Environment variables

Everything the frontend reads is in `.env` and validated at startup by
`src/lib/env.ts`.

### Safe for the frontend

These are compiled into the bundle and are **public by design**. The anon key is
only useful in combination with Row Level Security, which is why RLS is
mandatory on every table in this project.

| Variable                 | Required | Description                                 |
| ------------------------ | -------- | ------------------------------------------- |
| `VITE_SUPABASE_URL`      | yes      | Project URL, e.g. `https://abc.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | yes      | Anon / publishable key                      |
| `VITE_APP_NAME`          | no       | Display name (default `LFG HQ`)             |
| `VITE_PUBLIC_SITE_URL`   | no       | Where auth emails redirect back to          |

### Server-only — never expose

`SUPABASE_SERVICE_ROLE_KEY` must **never** be given a `VITE_` prefix and is
never imported anywhere under `src/`. It exists only as an Edge Function secret.
Anything prefixed `VITE_` is visible to anyone who has the app.

---

## Demo mode (development only)

The app can run end to end with **no Supabase project at all**, against a local
sample dataset. This exists so Phase 1 can be exercised while a backend is
unavailable — it is a development tool, not an authentication system.

```bash
npm run dev
```

With no credentials in `.env`, the sign-in screen says so and offers
**Continue as Demo Admin**. That signs you in as the seeded Owner, so every
implemented screen and every permission-gated action is reachable. A **DEMO
MODE** badge sits in the header for as long as the session lasts.

What works: the dashboard, the member directory, role changes, suspend and
restore, removal, invitations (create, revoke), profile and organization
settings, and the permission matrix. Changes persist in `localStorage` for the
session and survive a reload; the badge's reset button restores the seed.

The demo backend reproduces the _authorization rules_ the database enforces —
rank guards, the last-owner rule, permission checks — so behaviour learned here
matches the real backend. `src/services/demo/demo.test.ts` asserts that.

### Why it cannot reach production

- `isDemoModeAvailable()` starts with `import.meta.env.DEV`, which Vite replaces
  with the literal `false` in any production build, including
  `npm run desktop:build`.
- `vite.config.ts` aliases the whole `@/services/demo` module to a stub for
  non-development builds, so the implementation, its seed data and its fictional
  accounts are **not present in the shipped bundle** at all.
- There is no environment variable or runtime toggle that turns it on. The
  `verify` script asserts the production bundle is free of demo code.

### Switching to the real backend

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env` and restart. The
normal sign-in form returns; the demo button can be hidden entirely with
`VITE_DEMO_MODE=false`. **No application code changes** — every component talks
to `src/services/*`, which dispatches to Supabase or the demo store per call.

---

## Supabase setup

### Option A — local stack (recommended for development)

Requires Docker.

```bash
npx supabase start
```

```bash
npx supabase db reset
```

`db reset` applies every migration in `supabase/migrations/` and then runs
`supabase/seed/seed.sql`, which creates a demo organization with six members.

Point `.env` at the local stack using the URL and anon key that `supabase start`
prints:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<the anon key printed by supabase start>
```

**Demo accounts** (local only — the password is in the seed file):

| Email              | Role    |
| ------------------ | ------- |
| `owner@lfg.test`   | Owner   |
| `admin@lfg.test`   | Admin   |
| `manager@lfg.test` | Manager |
| `coach@lfg.test`   | Coach   |
| `player@lfg.test`  | Player  |
| `staff@lfg.test`   | Staff   |

Password for all six: `LfgHq!Dev2025`

Outgoing mail is captured locally at <http://localhost:54324>, so invitation and
password-reset flows can be tested end to end without sending real email.

### Option B — hosted project

Create a free project at <https://supabase.com/dashboard>, then:

```bash
npx supabase link --project-ref <your-project-ref>
```

```bash
npx supabase db push
```

Then, in the dashboard, **turn off public signups** — this is the single most
important setting in the project:

> Authentication → Providers → Email → **Disable "Enable Sign Ups"**

Do **not** run the seed file against a hosted project; it writes directly into
`auth.users`.

#### Creating the first organization

Organizations are provisioned by an operator, not self-served — there is no
"create organization" button anywhere in the UI, deliberately. After the first
account exists (invite yourself from the dashboard, or create a user under
Authentication → Users), run this in the SQL editor:

```sql
select public.bootstrap_organization(
  'lfg',                       -- slug: lowercase, hyphens
  'LFG Esports',               -- display name
  '<the auth user id>',        -- becomes the Owner
  'Competitive since day one.',
  'Europe/Berlin'
);
```

That creates the organization, materialises the six system roles with their
permissions, and installs you as Owner. Everyone else joins by invitation from
inside the app.

### Deploying the invite function

Inviting a member requires the service-role key to create the auth account, so
it runs in an Edge Function rather than the client:

```bash
npx supabase functions deploy invite-user
```

```bash
npx supabase secrets set PUBLIC_SITE_URL=https://your-app-url ALLOWED_ORIGINS=https://your-app-url
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform automatically.

### Regenerating database types

`src/types/database.types.ts` is hand-maintained to match the migrations.
After changing the schema, regenerate it:

```bash
npx supabase gen types typescript --local > src/types/database.types.ts
```

---

## Running the desktop app

```bash
npm run desktop:dev
```

This starts Vite and launches the Tauri window against it, with hot reload. It
requires the Rust toolchain.

---

## Testing

```bash
npm run verify
```

Runs typecheck → lint → unit tests → production build. Use this before every
commit; it is the same sequence CI should run.

Individually:

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run test:coverage
```

### End-to-end

```bash
npm run e2e
```

`e2e/auth.spec.ts` needs no seeded data — it covers the unauthenticated
boundary, form validation and keyboard accessibility.

`e2e/workspace.spec.ts` covers the signed-in application and **skips itself**
unless credentials are supplied:

```bash
E2E_EMAIL=owner@lfg.test E2E_PASSWORD='LfgHq!Dev2025' npm run e2e
```

If Playwright cannot download its own browsers (locked-down networks), point it
at an installed one:

```bash
PW_CHANNEL=chrome npm run e2e
```

---

## Building for release

### Web / PWA

```bash
npm run build
```

Outputs a static bundle to `dist/`, deployable to Vercel, Netlify or any static
host. The app uses hash routing, so **no server rewrite rules are needed**.

### Windows desktop

```bash
npm run desktop:build
```

Produces an NSIS installer and an MSI under
`src-tauri/target/release/bundle/`. Requires Rust and MSVC Build Tools.

macOS and Linux targets are configured in `src-tauri/tauri.conf.json` and build
from those platforms without further changes.

---

## Architecture

```
┌─────────────────────────────┐   ┌──────────────────────────┐
│  Tauri shell (Rust)         │   │  Browser / installed PWA │
│  window · tray · notifs     │   │                          │
│  deep links · window state  │   │                          │
└────────────┬────────────────┘   └────────────┬─────────────┘
             └───────────────┬─────────────────┘
                             ▼
              React 19 + TypeScript (strict)
   TanStack Query (server state) · Zustand (UI state only)
                             │
                    supabase-js (anon key)
                             ▼
   ┌──────────────────────────────────────────────────┐
   │  Supabase                                        │
   │  Postgres + Row Level Security  ← the boundary   │
   │  Auth (invitation-only)                          │
   │  Edge Function: invite-user (service-role key)   │
   └──────────────────────────────────────────────────┘
```

Deliberate choices:

- **No backend server.** For six users, Supabase covers auth, data, realtime and
  storage. No Kubernetes, no Redis, no microservices, no WebSocket server.
- **Hash routing.** Tauri serves from a custom protocol and the PWA is a static
  deployment; hash routes need no rewrite rules in either, so deep links behave
  identically on desktop and web.
- **Permissions are data, not code.** A `permissions` catalogue plus a
  `role_permissions` matrix, resolved per member on load. Changing what a Coach
  can do is a database change, not a deployment.
- **Thin native shell.** All product logic lives in the web layer, so the
  desktop app and the PWA never diverge. The Rust side owns only the window,
  tray, notifications and deep links — which is also what keeps a future
  voice/video layer additive rather than a rewrite.

### State management

| Kind of state  | Home                | Why                                          |
| -------------- | ------------------- | -------------------------------------------- |
| Server data    | TanStack Query      | one cache, one invalidation story            |
| UI preferences | Zustand (persisted) | sidebar, theme, last organization            |
| Session        | `AuthProvider`      | exactly one `onAuthStateChange` subscription |
| Permissions    | `WorkspaceProvider` | resolved server-side, mirrored to the UI     |

Server data is never mirrored into Zustand — that is how caches drift.

---

## Security model

Row Level Security is the security boundary. The frontend's permission checks
decide what to _show_; Postgres decides what is _allowed_. Deleting every check
in the UI would make the app confusing, not insecure.

- **Every table has RLS enabled** with `to authenticated` policies, plus table
  grants, so a missing policy fails closed. The `anon` role reaches nothing.
- **Policies never recurse.** They route through `SECURITY DEFINER` helpers
  (`is_org_member`, `has_org_permission`, `my_role_rank`) with a pinned empty
  `search_path`, so a policy never re-queries the table it protects.
- **No public signup.** Disabled in the project settings; `signInWithOtp` passes
  `shouldCreateUser: false`; there is no `signUp` call in the codebase.
- **Invitation tokens are hashed.** Only a SHA-256 digest is stored. Redeeming
  one also requires the signed-in address to match the invited address, so a
  leaked link is useless to anyone else.
- **Privilege escalation is blocked in the database.** A trigger enforces that
  nobody grants a role above their own rank, nobody modifies a member with equal
  or greater authority, and an organization always keeps one active owner.
- **The audit log is append-only.** No client `INSERT`, `UPDATE` or `DELETE`
  policy exists; entries are written only from `SECURITY DEFINER` routines.
- **The service-role key never reaches a client.** It exists only as an Edge
  Function secret. The invite function verifies the caller's permission through
  Postgres _before_ using it.
- **Errors are normalised.** `src/lib/errors.ts` maps SQLSTATE codes to
  sentences and refuses to surface anything containing schema details.
- **Content Security Policy** is set in `tauri.conf.json` — no inline scripts,
  no remote script sources.

---

## Keyboard shortcuts

| Shortcut         | Action                            |
| ---------------- | --------------------------------- |
| `Ctrl`/`⌘` + `K` | Open the command palette          |
| `Ctrl`/`⌘` + `B` | Collapse or expand the sidebar    |
| `↑` `↓`          | Move through palette results      |
| `Enter`          | Open the selected result          |
| `Esc`            | Close a dialog, palette or drawer |

Shortcuts do not fire while a text field has focus, so typing `k` in a message
box never opens search.

---

## Project structure

```
src/
  components/
    ui/          shadcn-style primitives on Radix
    layout/      AppShell, Sidebar, Topbar, MobileNav, CommandPalette
    common/      Can, FormField, ErrorBoundary, empty/error/loading states
  features/
    auth/        sign-in, reset, invite acceptance, route guards
    organization/workspace context, presence heartbeat
    dashboard/   HQ dashboard and its widgets
    members/     directory, role management, invitations
    settings/    profile, organization, permission matrix
    placeholder/ sections awaiting their phase
  hooks/         useAuth, useWorkspace, usePermission, shortcuts, connection
  lib/           supabase client, env, errors, permissions, query config
  services/      all Supabase access — no component queries directly
  stores/        Zustand UI state
  types/         database types
  utils/         date and presence helpers
src-tauri/       Rust shell, capabilities, icons, bundler config
supabase/
  migrations/    schema, permissions catalogue, authorization, RLS
  functions/     invite-user Edge Function
  seed/          local development data
e2e/             Playwright specs
```

Two rules hold throughout: components never query Supabase directly (that is
what `services/` is for), and nothing branches on a role _name_ (that is what
`usePermission` and `<Can>` are for).
