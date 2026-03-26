---
name: Twitter Clone Build Plan
overview: Build a minimal Twitter clone with Next.js (App Router), PostgreSQL, Prisma, and custom JWT authentication with email verification. Designed for 10K users with documented scaling paths beyond that. Deploy to a VPS.
todos:
  - id: setup
    content: "Phase 1: Initialize Next.js project, Prisma, PostgreSQL, Tailwind CSS, folder structure"
    status: pending
  - id: schema
    content: "Phase 2: Design and migrate database schema with indexes and cascade rules"
    status: pending
  - id: auth
    content: "Phase 3: Build JWT auth system (signup, login, logout, email verification, disposable email filter)"
    status: pending
  - id: layout
    content: "Phase 4: Build classic Twitter 3-column layout shell (Sidebar, MainContent, RightSidebar)"
    status: pending
  - id: tweets
    content: "Phase 5a: Tweet compose, display, and delete"
    status: pending
  - id: timeline
    content: "Phase 5b: Timeline feed with cursor-based pagination"
    status: pending
  - id: profile
    content: "Phase 5c: User profile page with tweets and follow/unfollow"
    status: pending
  - id: follow
    content: "Phase 5d: Follow system (follow/unfollow actions, follower counts)"
    status: pending
  - id: settings
    content: "Phase 5e: Settings page (update name, username, bio, profile picture upload)"
    status: pending
  - id: password-reset
    content: "Phase 6: Password reset flow (JWT reset tokens, email sending)"
    status: pending
  - id: security
    content: "Phase 7: Security hardening (rate limiting, secure headers, input validation, CSRF)"
    status: pending
  - id: polish
    content: "Phase 8: UI polish, error handling, loading states, responsive design"
    status: pending
  - id: deploy
    content: "Phase 9: Dockerize app, set up VPS with Nginx + SSL, deploy"
    status: pending
isProject: false
---

# Twitter Clone - Full Build Plan

## Target Scale

- **Initial target:** 10,000 registered users, ~500 concurrent
- **Scaling notes** are documented inline with a `[SCALE]` tag for future review

---

## Tech Stack

- **Framework:** Next.js 16 (App Router, Server Actions, Server Components)
- **Database:** PostgreSQL 18
- **ORM:** Prisma (with connection pooling configured)
- **Auth:** Custom JWT (bcryptjs for hashing, `jose` for JWT signing/verification, HTTP-only cookie)
- **Styling:** Tailwind CSS (classic Twitter look)
- **Email:** Resend or Nodemailer with SMTP (verification + password reset)
- **Profile pictures:** TBD -- to be decided later (not Cloudflare Images, see AD-7)
- **Deployment:** Docker + VPS (Nginx reverse proxy, Let's Encrypt SSL)

---

## Architectural Decisions Log

> This section documents every non-obvious decision and why it was made. Review before changing anything.

### AD-1: Custom auth instead of NextAuth/Auth.js

- **Decision:** Build authentication from scratch with bcryptjs + JWT.
- **Reason:** Learning project -- building auth teaches JWT mechanics, password hashing, cookie security, token lifecycle, and middleware patterns.
- **Trade-off:** More code to maintain, higher risk of security bugs vs. a battle-tested library.
- **Mitigation:** Follow OWASP guidelines documented in Phase 3 and Phase 7.

### AD-2: Stateless JWT instead of database sessions

- **Decision:** Use stateless JWT tokens stored in HTTP-only cookies. No Session table in the database.
- **Reason:** Learning JWT is a project goal. Stateless auth avoids a DB lookup on every request, which is simpler and faster.
- **How it works:**
  1. On login/signup, sign a JWT containing `{ userId, email, emailVerified }` with a server-side secret.
  2. Store the JWT in an HTTP-only cookie.
  3. On each request, verify the JWT signature and check expiry. No DB call needed for authentication itself.
  4. To get full user data (name, bio, etc.), decode the JWT for the `userId` and fetch from DB.
- **Trade-off:** JWTs cannot be individually revoked. Once issued, a JWT is valid until it expires. This means:
  - **Logout** only clears the cookie on the client. If someone copied the JWT, it's still valid. Acceptable risk for this project.
  - **Password change** needs a mechanism to invalidate all old JWTs. Solved with a `tokenVersion` field on the User model (see below).
- **Token revocation strategy:** The User model has a `tokenVersion` integer field (starts at 0). Every JWT includes the current `tokenVersion`. When the user changes their password or we need to force-logout, increment `tokenVersion`. On sensitive operations (Server Actions), check that the JWT's `tokenVersion` matches the DB value. If it doesn't, reject the request and clear the cookie.
- **Where the DB check happens:** NOT on every request. Only in `getCurrentUser()` which is called in Server Components and Server Actions that need user data. The middleware only verifies the JWT cryptographically (no DB).
- **JWT expiry:** 7 days. Short enough to limit exposure from a stolen token, long enough that users aren't constantly re-logging in.
- **[SCALE]:** Stateless JWT scales horizontally with zero changes -- no shared session store needed across multiple server instances.

### AD-3: Middleware verifies JWT cryptographically (no DB)

- **Decision:** Next.js middleware decodes and verifies the JWT signature + expiry + `emailVerified` claim. It does NOT hit the database.
- **Reason:** Middleware runs on the Edge Runtime. `jose` (the JWT library) is Edge-compatible and does pure cryptographic verification. This means middleware can fully validate the token (not just check cookie existence) without a DB call.
- **What middleware checks:**
  1. JWT exists in cookie
  2. JWT signature is valid (not tampered)
  3. JWT is not expired
  4. `emailVerified` claim is `true` (for protected routes)
- **What middleware does NOT check:** `tokenVersion` (that requires a DB call, done only in `getCurrentUser()`).

### AD-4: Route groups for layout separation

- **Decision:** Use `(auth)`, `(main)`, and `(verify)` route groups.
- **Reason:**
  - `(auth)` -- login, signup, forgot/reset password: centered minimal layout, accessible without auth
  - `(verify)` -- email verification pending page: minimal layout, accessible with JWT but `emailVerified=false`
  - `(main)` -- timeline, profile, settings: 3-column Twitter layout, requires JWT with `emailVerified=true`

### AD-5: Dynamic `[username]` route with reserved word protection

- **Decision:** Profile pages use `app/(main)/[username]/page.tsx`. Static routes (`home`, `settings`) are defined explicitly in the same `(main)` group.
- **Reason:** Next.js matches static routes before dynamic segments, so `/home` resolves to the `home/` folder, not the `[username]` catch.
- **Risk:** A user could register the username "home" or "settings" and their profile would be inaccessible.
- **Mitigation:** Block reserved usernames at signup. See the reserved words list in Phase 3.

### AD-6: Cursor-based pagination instead of offset

- **Decision:** Use cursor-based pagination (keyset pagination) for the timeline.
- **Reason:** Offset pagination (`SKIP 100 LIMIT 20`) gets slower as the offset grows because the DB must scan and discard rows. Cursor pagination (`WHERE createdAt < ?`) is O(1) regardless of page depth.
- **[SCALE]:** This decision means the timeline stays fast even with millions of tweets.

### AD-7: Profile picture storage -- TBD

- **Decision:** Profile picture upload destination is to be decided later.
- **Reason:** The Cloudflare Images account available is a company account, not suitable for a personal learning project.
- **Options to evaluate when we get there:**
  - **Uploadthing** -- free tier, built for Next.js, simple API
  - **AWS S3 + CloudFront** -- more learning, more control, free tier available
  - **Supabase Storage** -- free tier, good DX, PostgreSQL-native
  - **Self-hosted MinIO on VPS** -- maximum learning, S3-compatible API
  - **Local filesystem + Nginx** -- simplest, but files don't survive container rebuilds without a volume
- **Impact on plan:** The upload API route and `profilePicture` field on User are designed to store a URL regardless of provider. The choice only affects the upload implementation in `lib/upload.ts`.

### AD-8: Prisma connection pooling

- **Decision:** Configure Prisma with a connection pool sized for the VPS.
- **Reason:** PostgreSQL has a hard limit on connections (default 100). Each Prisma client instance opens a pool. Without configuration, you can exhaust connections under load.
- **Setting:** `connection_limit=10` in the DATABASE_URL for a single-server deploy. Increase based on VPS resources.
- **[SCALE]:** At higher load, add PgBouncer as an external connection pooler in front of PostgreSQL.

### AD-9: Email verification required from day one

- **Decision:** Users must verify their email before accessing the app. Unverified users are redirected to a verification pending page.
- **Reason:** Prevents fake signups, ensures password reset emails reach the right person, and blocks disposable/spam email addresses from polluting the user base.
- **Flow:** Signup -> verification email sent -> user clicks link -> JWT re-issued with `emailVerified: true` -> access granted.
- **Trade-off:** Adds friction to signup. Users who don't check their email can't use the app.
- **Mitigation:** Allow re-sending verification email from the pending page. Verification link valid for 24 hours.

### AD-11: Zod for all input validation

- **Decision:** Use Zod schemas as the single source of truth for all input validation. Every Server Action and API route parses its input with `schema.safeParse()` before executing any business logic.
- **Reason:** Manual `if (!email || ...)` checks are error-prone, verbose, and don't produce structured field-level errors. Zod gives you type-safe parsed data after validation, eliminating the need to re-assert types inside the happy path.
- **Schema location:** `lib/schemas/` — one file per domain (`auth.ts`, `tweet.ts`, `settings.ts`). This co-locates validation rules with the domain they belong to.
- **Error format:** `result.error.flatten().fieldErrors` returns a `Record<string, string[]>` that maps directly to form field names. Return this object from Server Actions so the client can render inline errors per field.
- **Trade-off:** Adds a dependency and a small runtime overhead for schema parsing. The overhead is negligible (sub-millisecond) compared to any DB call.
- **Disposable email check:** The `isDisposableEmail()` check from `lib/email-validation.ts` is wired into the `SignupSchema` via Zod's `.refine()`, keeping all signup validation in one place.

### AD-12: Playwright for e2e confidence testing

- **Decision:** Use Playwright for end-to-end tests only. No unit test framework (e.g., Vitest) is added at this stage. Tests live in `tests/e2e/`, one spec file per feature phase. Tests run against the local dev server (`http://localhost:3000`).
- **Reason:** For a full-stack Next.js app with Server Actions and server-rendered pages, e2e tests give the highest confidence with the least overhead. A Server Action validation bug, middleware redirect, or database interaction failure will all be caught by an e2e test that literally clicks through the UI. Unit tests for individual functions can be added later if complexity warrants it.
- **Test-after-feature rule:** A feature is not considered complete until its Playwright spec is written and passes. This is enforced by the build order — you do not move to the next phase until the current phase's spec passes.
- **Browser:** Chromium only. Cross-browser testing is not a concern for a personal project at this scale.
- **Trade-off:** e2e tests are slower than unit tests and require a running server. The `webServer` config in `playwright.config.ts` handles starting the dev server automatically.
- **[SCALE]:** When the codebase grows, add Vitest for unit-testing pure functions (Zod schemas, JWT helpers, utility functions) to keep the feedback loop fast.

### AD-10: Disposable email provider filter

- **Decision:** Block signups from known disposable/temporary email providers (mailinator, guerrillamail, tempmail, etc.).
- **Reason:** Disposable emails are used for spam accounts, abuse, and circumventing bans. Blocking them improves data quality and reduces moderation burden.
- **Implementation:** Use the `disposable-email-domains` npm package, which maintains a community-updated list of ~5,000 disposable email domains. Check the email domain against this list during signup validation.
- **Trade-off:** The list may have false positives (blocking a legitimate niche email provider) or false negatives (new disposable providers not yet listed).
- **Mitigation:** If a user reports their email is blocked incorrectly, manually whitelist the domain.

---

## Known Concerns & Future Scaling Paths

> Things that are intentionally deferred. Review this list when scaling beyond 10K users.

### KC-1: Timeline fan-out-on-read

- **Current approach:** When a user loads their timeline, query tweets from all users they follow: `WHERE authorId IN (list of followed user IDs) ORDER BY createdAt DESC`. With proper indexes and cursor pagination, this handles 10K users easily.
- **When it breaks:** If a user follows 10,000+ accounts, the `IN (...)` clause becomes expensive.
- **Future fix:** Fan-out-on-write -- when a user tweets, write a copy of the tweet ID to each follower's pre-computed timeline (stored in Redis). This is what Twitter actually does.

### KC-2: JWT token revocation is eventually consistent

- **Current approach:** The `tokenVersion` check only happens in `getCurrentUser()` (Server Components/Actions), not in middleware. This means a user with a revoked token can still have middleware allow them through to a page, but the page itself will reject them and clear their cookie.
- **Why this is acceptable:** The inconsistency window is the duration of a single page load. The user sees the page layout briefly, then gets redirected to login. No actual data is exposed because the data-fetching Server Components call `getCurrentUser()` which checks `tokenVersion`.
- **Future fix:** If this gap is unacceptable, move to short-lived access tokens (15 min) + longer-lived refresh tokens (stored in DB). The access token is used for most requests; the refresh token is checked against the DB only when the access token expires.

### KC-3: No real-time updates

- **Current approach:** Timeline loads on page visit. No live updates when someone you follow tweets.
- **Future fix:** Add WebSocket or Server-Sent Events (SSE) for real-time timeline updates and notifications.

### KC-4: Single PostgreSQL instance

- **Current approach:** One PostgreSQL container on the VPS.
- **When it breaks:** Very high write volume or if the VPS disk fills up.
- **Future fix:** Managed PostgreSQL (e.g., DigitalOcean Managed DB), read replicas for read-heavy queries, or sharding.

### KC-5: No caching layer

- **Current approach:** Every page load queries PostgreSQL directly.
- **Future fix:** Add Redis for caching hot data (user profiles, follower counts, trending content). Cache invalidation on write.

### KC-6: No search

- **Current approach:** No search functionality.
- **Future fix:** PostgreSQL full-text search with `tsvector` / `tsquery` for tweets and user search. For a more advanced setup, add Meilisearch or Typesense.

---

## Phase 1: Project Setup (Detailed)

### Step 1: Create the Next.js project

From the `twitter project` directory, run:

```bash
npx create-next-app@latest twitter-clone
```

When prompted, select these options:

- **TypeScript:** Yes
- **ESLint:** Yes
- **Tailwind CSS:** Yes
- `**` directory:** Yes
- **App Router:** Yes
- **Turbopack:** Yes
- **Import alias:** Keep the default `@/`*

Then enter the project:

```bash
cd twitter-clone
```

### Step 2: Install dependencies

```bash
npm install prisma @prisma/client bcryptjs jose disposable-email-domains zod
npm install -D @types/bcryptjs prettier eslint-config-prettier @playwright/test
npx playwright install --with-deps chromium
```

- `prisma` -- CLI tool for migrations and schema management
- `@prisma/client` -- auto-generated query client used in code
- `bcryptjs` -- pure JS bcrypt for password hashing (no native compilation issues)
- `jose` -- JWT signing and verification, Edge Runtime compatible (works in Next.js middleware)
- `disposable-email-domains` -- maintained list of disposable email domains for spam filtering
- `@types/bcryptjs` -- TypeScript types for bcryptjs
- `zod` -- schema validation for all Server Action inputs and API routes (see AD-11)
- `prettier` -- code formatter to enforce consistent style (see `.prettierrc`)
- `eslint-config-prettier` -- disables ESLint rules that conflict with Prettier
- `@playwright/test` -- e2e testing framework; `chromium` is the only browser needed for this project (see AD-12)

### Step 3: Initialize Prisma

```bash
npx prisma init
```

This creates:

- `prisma/schema.prisma` -- where you define your database models
- `.env` -- with a placeholder `DATABASE_URL`

### Step 4: Set up PostgreSQL

Run PostgreSQL locally via Docker:

```bash
docker run --name twitter-postgres \
  -e POSTGRES_USER=twitter \
  -e POSTGRES_PASSWORD=twitter123 \
  -e POSTGRES_DB=twitter_clone \
  -p 5432:5432 \
  -d postgres:18
```

Then update `.env`:

```
DATABASE_URL="postgresql://twitter:twitter123@localhost:5432/twitter_clone?connection_limit=10"
JWT_SECRET="your-super-secret-key-change-this-in-production"
```

The `JWT_SECRET` is used to sign and verify JWTs. In production, generate a strong random string (e.g., `openssl rand -base64 64`).

### Step 5: Create the folder structure

```bash
mkdir -p app/\(auth\)/login
mkdir -p app/\(auth\)/signup
mkdir -p app/\(auth\)/forgot-password
mkdir -p app/\(auth\)/reset-password
mkdir -p app/\(verify\)/verify-email
mkdir -p app/\(main\)/home
mkdir -p app/\(main\)/settings
mkdir -p app/\(main\)/\[username\]
mkdir -p components
mkdir -p lib/schemas
mkdir -p tests/e2e
mkdir -p types
```

**Route groups (see AD-4):**

- `(auth)` -- public pages: login, signup, forgot/reset password
- `(verify)` -- email verification pending page (user has JWT but email not yet verified)
- `(main)` -- protected pages: timeline, profile, settings (requires JWT with `emailVerified=true`)

### Step 5b: Create `.prettierrc`

Create `.prettierrc` in the project root:

```json
{
  "semi": false,
  "singleQuote": false,
  "quoteProps": "as-needed",
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100,
  "arrowParens": "always"
}
```

Then extend `eslint.config.mjs` to add `prettier` as the last entry so ESLint and Prettier don't conflict:

```js
import prettierConfig from "eslint-config-prettier"

export default [
  // ... existing Next.js ESLint config entries ...
  prettierConfig,  // must be last — disables ESLint rules that Prettier handles
]
```

### Step 5c: Create `playwright.config.ts`

Create `playwright.config.ts` in the project root:

```typescript
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },
})
```

Add a test script to `package.json`:

```json
"scripts": {
  "test:e2e": "playwright test",
  "test": "playwright test --ui"
}
```

### Step 6: Create the Prisma client singleton

Create `lib/prisma.ts`:

```typescript
import { PrismaClient } from "../app/generated/prisma/client"; 
import { PrismaPg } from "@prisma/adapter-pg"; 
const globalForPrisma = global as unknown as {
  prisma: PrismaClient; 
}; 
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL, 
}); 
const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter, 
  }); 
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma; 
export default prisma; 
```

**Why a singleton?** In development, Next.js hot-reloads your code frequently. Without this pattern, every reload creates a new PrismaClient instance, and you'd quickly exhaust your database connections (see AD-8). This stores the client on `globalThis` so it survives hot reloads.

### Step 7: Create placeholder layout and page files

Create `app/(auth)/layout.tsx`:

```typescript
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      {children}
    </div>
  );
}
```

Create `app/(verify)/layout.tsx`:

```typescript
export default function VerifyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      {children}
    </div>
  );
}
```

Create `app/(main)/layout.tsx`:

```typescript
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen max-w-7xl mx-auto flex">
      {/* Sidebar will go here */}
      <main className="flex-1 border-x border-gray-200">
        {children}
      </main>
      {/* Right sidebar will go here */}
    </div>
  );
}
```

Create `app/(main)/home/page.tsx`:

```typescript
export default function HomePage() {
  return (
    <div className="p-4">
      <h1 className="text-xl font-bold">Home</h1>
      <p className="text-gray-500 mt-2">Your timeline will appear here.</p>
    </div>
  );
}
```

### Step 8: Set up Git

```bash
git init
git add .
git commit -m "Initial project setup: Next.js, Prisma, Tailwind, folder structure"
```

The `.gitignore` from `create-next-app` already covers `.env` and `node_modules`.

### Step 9: Verify everything works

```bash
npm run dev
```

Visit `http://localhost:3000` (default Next.js page) and `http://localhost:3000/home` (your placeholder timeline page).

### Phase 1 Completion Checklist

After completing all steps, your project should look like this:

```
twitter-clone/
  .env                          # DATABASE_URL + JWT_SECRET
  .env.example                  # Committed template showing required env vars (no secrets)
  .gitignore
  .prettierrc                   # Prettier formatting config (Step 5b)
  package.json
  playwright.config.ts          # Playwright e2e test config (Step 5c)
  prisma/
    schema.prisma               # Default schema (models added in Phase 2)
  tests/
    e2e/                        # Playwright specs, one file per feature phase
  
    app/
      layout.tsx                # Root layout (from create-next-app)
      page.tsx                  # Root page (can redirect to /home later)
      (auth)/
        layout.tsx              # Centered layout for auth pages
        login/
        signup/
        forgot-password/
        reset-password/
      (verify)/
        layout.tsx              # Centered layout for verification page
        verify-email/
      (main)/
        layout.tsx              # Twitter 3-column layout shell
        home/
          page.tsx              # Placeholder timeline page
        settings/
        [username]/             # Dynamic profile route (see AD-5)
    components/
    lib/
      db.ts                     # Prisma client singleton
      schemas/                  # Zod validation schemas (one file per domain)
    types/
```

---

## Phase 2: Database Schema

Core models in `prisma/schema.prisma`. Note: there is NO Session model. Auth is fully JWT-based (see AD-2).

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id              String    @id @default(cuid())
  email           String    @unique
  username        String    @unique
  name            String?
  bio             String?   @db.VarChar(160)
  profilePicture  String?
  passwordHash    String
  emailVerified   Boolean   @default(false)
  emailVerifiedAt DateTime?
  tokenVersion    Int       @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  tweets          Tweet[]
  followers       Follow[]  @relation("following")
  following       Follow[]  @relation("follower")
}

model Tweet {
  id        String   @id @default(cuid())
  content   String   @db.VarChar(280)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@index([authorId, createdAt(sort: Desc)])
}

model Follow {
  id          String   @id @default(cuid())
  followerId  String
  followingId String
  follower    User     @relation("follower", fields: [followerId], references: [id], onDelete: Cascade)
  following   User     @relation("following", fields: [followingId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())

  @@unique([followerId, followingId])
  @@index([followerId])
  @@index([followingId])
}
```

### Schema Design Decisions

- `**cuid()` for IDs:** Non-sequential, URL-safe, collision-resistant. Doesn't leak creation order like auto-increment IDs.
- `**onDelete: Cascade` on all foreign keys:** When a user is deleted, their tweets and follows are automatically deleted.
- **Composite index `[authorId, createdAt(sort: Desc)]` on Tweet:** Lets PostgreSQL retrieve a user's tweets in reverse chronological order without a separate sort step. Used on both the profile page and the timeline query.
- **Separate indexes on `Follow.followerId` and `Follow.followingId`:** The unique constraint on `[followerId, followingId]` creates a composite index that only helps queries filtering by `followerId` first. We need a separate index on `followingId` for "who follows user X?" queries.
- `**bio` capped at 160 chars:** Matches classic Twitter's bio limit.
- `**emailVerified` + `emailVerifiedAt`:** Required from signup (see AD-9). Users cannot access the main app until `emailVerified = true`.
- `**tokenVersion`:** Integer that starts at 0. Included in every JWT. Incremented on password change to invalidate all existing JWTs for this user (see AD-2).
- **No Session model:** Auth is stateless JWT. No session rows to store, query, or clean up.
- **No PasswordReset model:** Password reset tokens are also JWTs (signed with the same secret, short-lived, containing `userId` + `tokenVersion` + `purpose: "password-reset"`). The `tokenVersion` field naturally invalidates used reset tokens because changing the password increments `tokenVersion`, making any previously issued reset JWT invalid. See Phase 6 for details.

### After creating the schema, run:

```bash
npx prisma migrate dev --name init
```

This generates the SQL migration and applies it to your local database.

---

## Phase 3: Authentication (JWT-based, from scratch)

### Files to create:

- `lib/jwt.ts` -- JWT sign, verify, and decode helpers using `jose`
- `lib/password.ts` -- bcrypt hash/compare wrappers
- `lib/auth.ts` -- `getCurrentUser()` helper, `requireUser()` helper
- `lib/email-validation.ts` -- disposable email filter + email format validation
- `lib/constants.ts` -- reserved usernames list, validation rules
- `lib/schemas/auth.ts` -- Zod schemas for signup, login, and password reset (see AD-11)
- `middleware.ts` -- JWT verification + route protection (see AD-3)
- `app/(auth)/signup/page.tsx` -- signup form
- `app/(auth)/login/page.tsx` -- login form
- `app/(verify)/verify-email/page.tsx` -- "check your email" pending page
- Server Actions for signup, login, logout, resend verification

### JWT Helper (`lib/jwt.ts`)

```typescript
import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

interface JWTPayload {
  userId: string;
  email: string;
  emailVerified: boolean;
  tokenVersion: number;
}

export async function signToken(payload: JWTPayload, expiresIn: string = "7d"): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}
```

**Why `jose` instead of `jsonwebtoken`?** `jose` works on the Edge Runtime (used by Next.js middleware). `jsonwebtoken` relies on Node.js `crypto` module which is not available on Edge. `jose` uses the Web Crypto API instead.

### Purpose-specific JWT tokens

All JWT tokens share the same secret but include a `purpose` field to prevent cross-use:

- **Auth token:** `{ userId, email, emailVerified, tokenVersion, purpose: "auth" }` -- 7-day expiry
- **Email verification token:** `{ userId, email, purpose: "email-verification" }` -- 24-hour expiry
- **Password reset token:** `{ userId, tokenVersion, purpose: "password-reset" }` -- 1-hour expiry

The `purpose` field is checked when consuming each token type to prevent a password-reset token from being used as an auth token, etc.

### Disposable Email Filter (`lib/email-validation.ts`)

```typescript
import domains from "disposable-email-domains";

const disposableDomains = new Set(domains);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return disposableDomains.has(domain);
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!isValidEmail(email)) {
    return { valid: false, error: "Invalid email format" };
  }
  if (isDisposableEmail(email)) {
    return { valid: false, error: "Disposable email addresses are not allowed" };
  }
  return { valid: true };
}
```

The `disposable-email-domains` package contains ~5,000 known disposable email domains. The list is loaded once at startup and checked as a Set lookup (O(1)).

### Reserved Usernames (AD-5)

Block these usernames at signup to prevent route collisions:

```typescript
export const RESERVED_USERNAMES = [
  "home", "settings", "login", "signup", "logout",
  "forgot-password", "reset-password", "verify-email",
  "api", "admin", "about", "help", "support",
  "terms", "privacy", "search", "explore",
  "notifications", "messages",
];
```

### Zod Schemas (`lib/schemas/auth.ts`)

All Server Action inputs are validated with Zod before any business logic runs. The schemas also serve as the single source of truth for validation rules — the same constraints (min length, regex, etc.) used server-side can be mirrored in the client for UX, but the server-side Zod check is the authoritative one.

```typescript
import { z } from "zod"
import { RESERVED_USERNAMES } from "@/lib/constants"
import { isDisposableEmail } from "@/lib/email-validation"

export const SignupSchema = z.object({
  email: z
    .string()
    .email("Invalid email format")
    .refine((email) => !isDisposableEmail(email), "Disposable email addresses are not allowed"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(15, "Username must be at most 15 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores")
    .refine((u) => !RESERVED_USERNAMES.includes(u.toLowerCase()), "That username is reserved"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
})

export const LoginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
})

export const ResetPasswordSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
})

export type SignupInput = z.infer<typeof SignupSchema>
export type LoginInput = z.infer<typeof LoginSchema>
```

**Server Action pattern — always parse first, then proceed:**

```typescript
export async function signupAction(formData: FormData) {
  const result = SignupSchema.safeParse({
    email: formData.get("email"),
    username: formData.get("username"),
    password: formData.get("password"),
  })

  if (!result.success) {
    return { error: result.error.flatten().fieldErrors }
  }

  const { email, username, password } = result.data
  // ... happy path continues here
}
```

### Phase 3 Playwright Tests (`tests/e2e/auth.spec.ts`)

Write and pass these tests before moving to Phase 4:

- Signup with valid data redirects to `/verify-email`
- Signup with a disposable email shows a field error
- Signup with a taken username shows a field error
- Signup with a weak password shows a field error
- Login with wrong password shows "Invalid email or password"
- Login with correct credentials redirects to `/home`
- Unauthenticated visit to `/home` redirects to `/login`
- Unverified user visiting `/home` redirects to `/verify-email`

### Signup Flow

1. User submits email, password, and username
2. **Server-side validation (via Zod `SignupSchema.safeParse`):**
  - Email: valid format, not a disposable provider, not already registered
  - Password: minimum 8 characters, at least one uppercase, one lowercase, one number
  - Username: 3-15 characters, alphanumeric and underscores only, not in reserved list, not already taken
3. Hash password with bcryptjs (salt rounds: 12)
4. Create User row in DB (`emailVerified: false`, `tokenVersion: 0`)
5. Sign an auth JWT: `{ userId, email, emailVerified: false, tokenVersion: 0, purpose: "auth" }`
6. Set JWT in HTTP-only cookie (see cookie configuration below)
7. Sign an email verification JWT: `{ userId, email, purpose: "email-verification" }` with 24-hour expiry
8. Send verification email with link: `/verify-email?token=...`
9. Redirect to `/verify-email` (pending page)

### Login Flow

1. User submits email + password
2. Look up user by email
3. **Security:** If user not found, still run a dummy bcrypt compare to prevent timing attacks that reveal whether the email exists
4. Compare submitted password with stored hash
5. On success: sign auth JWT with current `emailVerified` and `tokenVersion` values, set cookie
6. On failure: return generic error "Invalid email or password" (never reveal which field is wrong)
7. Redirect to `/home` if `emailVerified`, or `/verify-email` if not

### Email Verification Flow

1. User clicks the verification link in their email: `/verify-email?token=...`
2. Verify the JWT: valid signature, not expired, `purpose === "email-verification"`
3. Look up user by `userId` from the JWT payload
4. If user exists and email matches: set `emailVerified = true`, `emailVerifiedAt = now()`
5. Issue a **new** auth JWT with `emailVerified: true` (replace the old cookie)
6. Redirect to `/home`

**Verification pending page (`/verify-email`):**

- Shows "We've sent a verification email to [your@email.com](mailto:your@email.com)"
- "Resend verification email" button (rate-limited: max 3 per hour)
- "Check your spam folder" hint
- Logout link

### Cookie Configuration

```typescript
cookies().set("auth_token", jwt, {
  httpOnly: true,     // JS cannot read the cookie (prevents XSS token theft)
  secure: process.env.NODE_ENV === "production",  // HTTPS-only in production
  sameSite: "lax",    // Sent on top-level navigations, not on cross-site POST
  path: "/",          // Available on all routes
  maxAge: 60 * 60 * 24 * 7,  // 7 days, matches JWT expiry
});
```

### Middleware (`middleware.ts`) -- JWT verification on Edge (AD-3)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

const PUBLIC_ROUTES = ["/login", "/signup", "/forgot-password", "/reset-password"];
const VERIFY_ROUTES = ["/verify-email"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("auth_token")?.value;

  // No token: allow public routes, redirect everything else to login
  if (!token) {
    if (PUBLIC_ROUTES.some(r => pathname.startsWith(r))) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Verify JWT (cryptographic check, no DB)
  let payload;
  try {
    const result = await jwtVerify(token, secret);
    payload = result.payload;
  } catch {
    // Invalid or expired JWT -- clear cookie, redirect to login
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("auth_token");
    return response;
  }

  const emailVerified = payload.emailVerified as boolean;

  // Authenticated user trying to access public auth routes -> redirect to home
  if (PUBLIC_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  // Unverified email: only allow verify routes
  if (!emailVerified && !VERIFY_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL("/verify-email", request.url));
  }

  // Verified email trying to access verify routes -> redirect to home
  if (emailVerified && VERIFY_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
```

### `getCurrentUser()` helper (`lib/auth.ts`)

Called in Server Components and Server Actions to get the full user object and validate `tokenVersion`:

```typescript
export async function getCurrentUser(): Promise<User | null> {
  const token = cookies().get("auth_token")?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload || payload.purpose !== "auth") return null;

  const user = await db.user.findUnique({
    where: { id: payload.userId },
  });

  if (!user) return null;

  // Check tokenVersion -- if password was changed, this JWT is stale
  if (user.tokenVersion !== payload.tokenVersion) {
    cookies().delete("auth_token");
    return null;
  }

  return user;
}
```

### Logout

1. Clear the `auth_token` cookie
2. Redirect to `/login`

**Note:** Since JWTs are stateless, logout only removes the cookie from the client. The JWT itself remains cryptographically valid until it expires. This is an accepted trade-off of stateless JWT (see AD-2 and KC-2). If the user changes their password, `tokenVersion` is incremented, which invalidates all JWTs on the next `getCurrentUser()` call.

---

## Phase 4: Layout & UI Shell

### Classic Twitter 3-Column Layout

```
+------------------+--------------------+-----------------+
|   Left Sidebar   |    Main Content    |  Right Sidebar  |
|   (w-64, fixed)  |   (flex-1, scroll) | (w-80, fixed)   |
|                  |                    |                 |
|  - Logo (bird)   |  - Page content    |  - Who to      |
|  - Home link     |  - Varies by route |    follow       |
|  - Profile link  |                    |  - (placeholder |
|  - Settings link |                    |    for future)  |
|  - Logout button |                    |                 |
+------------------+--------------------+-----------------+
```

### Responsive Behavior

- **Desktop (>1024px):** Full 3-column layout
- **Tablet (768-1024px):** 2 columns (sidebar collapses to icons, no right sidebar)
- **Mobile (<768px):** Single column with bottom navigation bar

### Styling

- Twitter blue: `#1DA1F2` (configure in `tailwind.config.ts` as a custom color)
- System font stack or Inter from Google Fonts
- Border-based dividers between sections (classic Twitter feel)

### Components to build:

- `Sidebar` -- navigation links, user avatar, tweet button, logout
- `RightSidebar` -- "Who to follow" suggestions (random users the current user doesn't follow)
- `TweetCard` -- displays a single tweet (avatar, name, @username, relative timestamp, content, delete button if own tweet)
- `TweetComposer` -- textarea with character counter, submit button
- `ProfileHeader` -- banner area, avatar, name, bio, follow/unfollow button, follower/following counts
- `FollowButton` -- toggles follow/unfollow state
- `UserAvatar` -- reusable avatar component with fallback initials

---

## Phase 5: Core Features

### 5a: Tweets (compose, display, delete)

**Zod Schema (`lib/schemas/tweet.ts`):**

```typescript
import { z } from "zod"

export const CreateTweetSchema = z.object({
  content: z
    .string()
    .min(1, "Tweet cannot be empty")
    .max(280, "Tweet cannot exceed 280 characters")
    .transform((s) => s.trim()),
})

export type CreateTweetInput = z.infer<typeof CreateTweetSchema>
```

**Compose:**

- Textarea with 280 character limit
- Live character counter (changes color: gray -> yellow at 260 -> red at 280)
- Server Action to create tweet — validate with `CreateTweetSchema.safeParse` before hitting the DB
- **Security:** Sanitize tweet content -- escape HTML entities to prevent stored XSS. React's JSX auto-escapes by default, but validate on the server too. Never use `dangerouslySetInnerHTML` with user content.

**Display:**

- `TweetCard` component: avatar, display name, @username, relative time ("2m", "1h", "Mar 15"), content
- Relative time formatting: use a lightweight formatter (or write one: <1min="just now", <1h="Xm", <24h="Xh", else "Mon DD")

**Delete:**

- Delete button (trash icon) visible only on your own tweets
- Server Action: verify the tweet belongs to the current user before deleting
- **Security:** Always check `tweet.authorId === currentUser.id` server-side. Never trust the client.
- Optimistic UI: remove the tweet from the list immediately, revert if the server action fails

**Phase 5a Playwright Tests (`tests/e2e/tweets.spec.ts`):**

Write and pass before moving to 5b:

- Composing a tweet makes it appear on the timeline
- Submitting an empty tweet shows a validation error
- A tweet over 280 characters cannot be submitted (button disabled client-side; server also rejects)
- Clicking delete on own tweet removes it from the list
- Delete button is not visible on another user's tweet

### 5b: Timeline (`/home`)

**Query strategy (Prisma):**

```typescript
const tweets = await db.tweet.findMany({
  where: {
    authorId: {
      in: [...followingIds, currentUser.id],
    },
    createdAt: cursor ? { lt: cursor } : undefined,
  },
  include: {
    author: {
      select: { id: true, username: true, name: true, profilePicture: true },
    },
  },
  orderBy: { createdAt: "desc" },
  take: 20,
});
```

- **Cursor pagination (AD-6):** The `cursor` is the `createdAt` of the last tweet on the current page. "Load more" sends this cursor to fetch the next page.
- **Empty state:** If the user follows nobody, show a "Follow some users to see their tweets here" message with suggestions.
- **[SCALE]:** This query uses the composite index `[authorId, createdAt DESC]` on Tweet. For 10K users it's fast. See KC-1 for scaling beyond that.

**Phase 5b Playwright Tests (`tests/e2e/timeline.spec.ts`):**

Write and pass before moving to 5c:

- Timeline shows tweets from followed users in reverse chronological order
- Timeline shows the logged-in user's own tweets
- Empty timeline shows the "Follow some users" prompt
- "Load more" button loads the next page of tweets

### 5c: User Profile (`/[username]`)

- Fetch user by username (unique indexed lookup -- fast)
- Display: profile picture, display name, @username, bio, joined date
- Show follower count and following count
- Show the user's tweets (same cursor-paginated query, filtered by single `authorId`)
- If viewing someone else's profile: show Follow/Unfollow button
- If viewing own profile: show "Edit profile" link to `/settings`
- **404 handling:** If username doesn't exist, show a proper 404 page with `notFound()` from Next.js

**Phase 5c Playwright Tests (`tests/e2e/profile.spec.ts`):**

Write and pass before moving to 5d:

- Profile page displays the correct name, username, and bio
- Profile page shows the user's tweets
- Visiting a non-existent username shows a 404 page
- Own profile shows "Edit profile" link instead of Follow button

### 5d: Follow System

- **Follow:** Server Action creates a Follow row. Validates: user exists, not self-follow, not already following.
- **Unfollow:** Server Action deletes the Follow row. Validates: follow relationship exists.
- **Counts:** Displayed on profile. Query with `_count`:

```typescript
const user = await db.user.findUnique({
  where: { username },
  include: {
    _count: { select: { followers: true, following: true } },
  },
});
```

- **FollowButton component:** Client Component with optimistic state toggle. Shows "Follow" or "Following" (with hover state changing to "Unfollow").
- **"Who to follow" sidebar:** Query 3 random users the current user doesn't follow. Refresh on page load.

**Phase 5d Playwright Tests (`tests/e2e/follow.spec.ts`):**

Write and pass before moving to 5e:

- Clicking Follow on a profile increments follower count and changes button to "Following"
- Clicking Following (hover -> "Unfollow") unfollows and decrements follower count
- Cannot follow yourself (Follow button not shown on own profile)
- Followed user's tweets appear on the timeline

### 5e: Settings (`/settings`)

**Zod Schema (`lib/schemas/settings.ts`):**

```typescript
import { z } from "zod"
import { RESERVED_USERNAMES } from "@/lib/constants"

export const UpdateProfileSchema = z.object({
  name: z.string().max(50, "Display name must be at most 50 characters").optional(),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(15, "Username must be at most 15 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores")
    .refine((u) => !RESERVED_USERNAMES.includes(u.toLowerCase()), "That username is reserved"),
  bio: z.string().max(160, "Bio must be at most 160 characters").optional(),
})

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>
```

- **Form fields:** Display name, username, bio (160 char limit)
- **Username change validation (enforced by `UpdateProfileSchema`):**
  - 3-15 characters, alphanumeric + underscores
  - Not in reserved usernames list
  - Not already taken (check with `db.user.findUnique` after Zod passes)
  - **Security:** Run all validation server-side in the Server Action, not just client-side
- **Profile picture upload:**
  - Client-side: file input with image preview, max file size 2MB, only allow jpg/png/webp
  - Upload flow: Client sends file to a Next.js API route (`/api/upload-avatar`), which uploads to the chosen storage provider (TBD, see AD-7), returns the URL, then a Server Action updates the user's `profilePicture` field
  - **Security:** Validate file type and size on the server, not just the client. Check MIME type, not just extension.

**Phase 5e Playwright Tests (`tests/e2e/settings.spec.ts`):**

Write and pass before moving to Phase 6:

- Updating display name and bio saves successfully and reflects on the profile page
- Changing to an already-taken username shows a field error
- Changing to a reserved username shows a field error
- Uploading a valid profile picture updates the avatar across the UI

---

## Phase 6: Password Reset Flow

Password reset uses purpose-specific JWTs instead of a database table (see Phase 2 schema decisions).

### Flow:

1. User enters email on `/forgot-password`
2. **Security:** Always respond with "If an account exists with that email, we've sent a reset link" regardless of whether the email exists. This prevents user enumeration.
3. If user exists: sign a password reset JWT: `{ userId, tokenVersion, purpose: "password-reset" }` with 1-hour expiry
4. Send email with reset link: `/reset-password?token=...`
5. On `/reset-password`: verify JWT signature, check expiry, check `purpose === "password-reset"`
6. Fetch user from DB by `userId` from JWT payload
7. **Critical check:** Verify that `user.tokenVersion === payload.tokenVersion`. If they don't match, the token has already been used (or the password was changed by another means). Show "This reset link has already been used or has expired."
8. User enters new password (same validation rules as signup)
9. Hash new password, update User's `passwordHash`
10. Increment `tokenVersion` by 1. This simultaneously:
  - Invalidates this reset JWT (tokenVersion no longer matches)
    - Invalidates ALL existing auth JWTs (they contain the old tokenVersion)
    - Forces re-login on all devices
11. Clear the `auth_token` cookie
12. Redirect to `/login` with a success message

### Why this works without a PasswordReset table:

The JWT contains the `tokenVersion` at the time it was issued. After the password is changed, `tokenVersion` is incremented. Any attempt to reuse the same reset JWT will fail the `tokenVersion` check in step 7. This gives us single-use semantics without storing anything in the database.

### Implementation files:

- `app/(auth)/forgot-password/page.tsx` -- email input form
- `app/(auth)/reset-password/page.tsx` -- new password form (reads `?token=` from URL)
- `lib/schemas/auth.ts` -- `ResetPasswordSchema` already defined here (see Phase 3)
- Server Actions for submitting the email and resetting the password
- Email sending utility in `lib/email.ts`

### Phase 6 Playwright Tests (`tests/e2e/password-reset.spec.ts`)

Write and pass before moving to Phase 7:

- Submitting the forgot password form always shows the generic success message (no user enumeration)
- A valid reset link leads to the new password form
- An expired or tampered reset token shows an error
- Successfully resetting the password redirects to `/login`
- The old password no longer works after a reset
- An already-used reset link is rejected

### Email provider options:

- **Resend:** Free tier covers 100 emails/day (3,000/month). Simple API. Good for this project.
- **Nodemailer + SMTP:** More setup, but works with any SMTP provider (Gmail, SendGrid, Mailgun).

---

## Phase 7: Security Hardening

### 7a: Rate Limiting

Implement rate limiting on sensitive endpoints to prevent abuse.

**Approach:** In-memory rate limiter using a `Map<string, { count: number, resetAt: number }>` keyed by IP address. Simple, no external dependencies. Resets on server restart (acceptable for a single-server deploy).

**Limits:**

- `/login`: 5 attempts per 15 minutes per IP
- `/signup`: 3 attempts per hour per IP
- `/forgot-password`: 3 attempts per hour per IP
- Resend verification email: 3 per hour per user
- `/api/upload-avatar`: 10 uploads per hour per user
- Tweet creation: 30 tweets per hour per user

**Implementation:** Create `lib/rate-limit.ts` with a reusable `rateLimit(key, limit, windowMs)` function. Call it at the top of each Server Action.

**[SCALE]:** At multiple server instances, in-memory rate limiting doesn't work (each instance has its own Map). Switch to Redis-based rate limiting with a sliding window algorithm.

**Production addition:** Also rate-limit at the Nginx level as a first line of defense:

```nginx
limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;

location /login {
    limit_req zone=auth burst=3 nodelay;
    proxy_pass http://nextjs_app;
}
```

### 7b: Input Validation & Sanitization

- **All user input** is validated server-side in Server Actions, never trust client-only validation
- **Tweet content:** Escape HTML entities. React's JSX does this by default, but also validate max length on the server
- **Usernames:** Strict regex: `/^[a-zA-Z0-9_]{3,15}$/`
- **Emails:** Valid format + disposable email domain check (see AD-10)
- **Bio:** Max 160 characters, strip leading/trailing whitespace
- **File uploads:** Validate MIME type on the server (not just file extension), enforce 2MB max

### 7c: Secure HTTP Headers

Set these headers via `next.config.js` `headers()` or Nginx:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 0
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-'self'; img-'self' [image-host-tbd]; style-'self' 'unsafe-inline';
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Note: The `img- CSP directive will be updated once the profile picture storage provider is chosen (see AD-7).

### 7d: CSRF Protection

- `SameSite=Lax` on the auth cookie prevents CSRF on POST requests from other origins
- All state-changing operations use Server Actions (which are POST requests) or API routes with proper method checks
- **Decision:** No additional CSRF token needed because `SameSite=Lax` + Server Actions provide sufficient protection for this architecture

### 7e: Password Security

- **Hashing:** bcryptjs with salt rounds of 12 (~250ms to hash -- intentionally slow to resist brute force)
- **Requirements:** Minimum 8 characters, at least one uppercase letter, one lowercase letter, one number
- **Storage:** Only the hash is stored. The plaintext password never touches the database or logs.
- **Password change:** Increment `tokenVersion` to invalidate all existing JWTs (force re-login everywhere)

### 7f: JWT Security

- **Signing algorithm:** HS256 (HMAC-SHA256). Symmetric key stored in `JWT_SECRET` env var.
- **Secret strength:** Must be at least 256 bits (32+ characters). Generate with `openssl rand -base64 64`.
- **Token expiry:** Auth tokens expire in 7 days. Verification tokens in 24 hours. Reset tokens in 1 hour.
- **Purpose field:** All JWTs include a `purpose` field to prevent cross-use attacks (e.g., using a reset token as an auth token).
- **Cookie-only:** JWTs are never exposed to client-side JavaScript (httpOnly cookie). Never returned in API response bodies.
- **No localStorage:** JWTs are NOT stored in localStorage or sessionStorage (vulnerable to XSS). HTTP-only cookies only.
- **[SCALE]:** Stateless JWTs scale horizontally with zero changes. No shared session store needed.

---

## Phase 8: Polish

- **Loading states:** Use Next.js `loading.tsx` files for route-level loading skeletons
- **Error handling:** Use `error.tsx` files for route-level error boundaries. Show user-friendly messages, log details server-side.
- **Toast notifications:** For actions like "Tweet posted", "Profile updated", "Followed @user"
- **Form validation UX:** Show inline errors below fields, disable submit button while processing
- **Responsive design:** Test and fix the 3 breakpoints (mobile, tablet, desktop)
- **Empty states:** Meaningful messages for empty timeline, no followers, no tweets
- **Accessibility:** Proper semantic HTML, ARIA labels, keyboard navigation, focus management

---

## Phase 9: Deployment to VPS

### Dockerfile (multi-stage build)

```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "server.js"]
```

**Requires** `output: "standalone"` in `next.config.js`.

### docker-compose.yml

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://twitter:${DB_PASSWORD}@db:5432/twitter_clone?connection_limit=10
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:18-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=twitter
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=twitter_clone
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U twitter"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

### VPS Setup Steps

1. Provision a VPS (recommended: 2 vCPU, 4GB RAM for 10K users)
2. Install Docker and Docker Compose
3. Set up Nginx as reverse proxy
4. Configure SSL with Let's Encrypt (Certbot)
5. Add security headers in Nginx config (Phase 7c)
6. Add Nginx-level rate limiting (Phase 7a)
7. Point domain/subdomain DNS to VPS IP
8. Clone repo, create `.env` with production `JWT_SECRET` and `DB_PASSWORD`, run `docker compose up -d`
9. Run migrations: `docker compose exec app npx prisma migrate deploy`
10. Set up automated backups for PostgreSQL data volume

### CI/CD (optional)

- GitHub Actions: on push to main, SSH into VPS, pull latest code, rebuild containers, run migrations
- **Security:** Use GitHub Secrets for SSH keys and env vars. Never commit `.env` files.

---

## Build Order (recommended)

The features should be built in this order since each one builds on the previous:

1. Project setup + Prisma schema + DB migration (Phase 1 + 2)
2. JWT auth: signup, login, logout, email verification, disposable email filter (Phase 3)
3. Basic layout: sidebar, main content area (Phase 4)
4. Tweet compose + display + delete (Phase 5a)
5. Timeline with cursor pagination (Phase 5b)
6. User profile page (Phase 5c)
7. Follow/unfollow (Phase 5d)
8. Settings page + profile picture upload (Phase 5e)
9. Password reset flow + email setup (Phase 6)
10. Security hardening: rate limiting, headers, input validation (Phase 7)
11. Polish: loading states, error handling, responsive design (Phase 8)
12. Dockerize and deploy (Phase 9)

