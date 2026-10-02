# Plan: friends-and-family accounts + logins (explore/accounts-logins)

Target branch: `explore/accounts-logins`. Audience: Claude Code implementing
the work. Status: plan, not decided, except section 1 settled points which
mirror `docs/adr/0002-friends-family-auth.md` verbatim in intent.

Evidence note: the workflow research agents returned no usable evidence,
so the library decisions were closed afterward by a runtime probe round on
2026-10-01 (Deno 2.9.6, this machine): `node:sqlite` CRUD + WAL +
`VACUUM INTO` verified, `db.backup()` confirmed absent; `npm:argon2@0.44.0`
hash + verify true; `npm:@simplewebauthn/server@13.3.0` options calls return
challenges, plus maintainer-doc confirmation of Deno v2.4+ support and JSR
publishing; OWASP argon2id floor and the Capacitor/WebView WebAuthn limit
confirmed via web sources. Everything else is grounded in inspected repo
files (ADR 0002, server/auth.ts, server/mod.ts, server/sync.ts, server/llm.ts,
server/deno.json, deploy/qala.service, deploy/tailscale-serve.md,
docs/DECISIONS.md S3/S9/S11, docs/rust-core.md sections 4-5, apps/web shells).
No library API is asserted from memory. Section 13 lists what is closed and
the three items still genuinely open (U6/U7/U9).

## 0. Operator inputs

Collect these before phase 0. Placeholders are used everywhere below.

| Input | Placeholder | How it is used |
|---|---|---|
| VPS hostname / IP | `VPS_HOST` | SSH target, Caddy reverse-proxy host, systemd unit host. Example: `qala.example.com` or raw IP for first boot. |
| VPS SSH access | `VPS_SSH` (user + key) | `ssh VPS_SSH` for deploy, invite CLI, backups. Example: `root@VPS_HOST`. |
| Public domain | `PUBLIC_DOMAIN` | The one public name. Caddy automatic HTTPS certificate, WebAuthn RP ID, session cookie Domain (or host-only), PWA origin, backup docs. Must be a real DNS name for Caddy automatic HTTPS (ADR 0002 open question). |
| DNS | A/AAAA `PUBLIC_DOMAIN -> VPS_HOST` | Required before Caddy first run, else TLS issuance fails. |
| Owner login name | `OWNER_LOGIN` | First user row; first invite redeems to owner (ADR 0002). Lowercase, reuse `normalizeLogin` semantics. |
| Session lifetime (policy) | `SESSION_DAYS` | Cookie Max-Age + server-side expiry. Default 30, sliding (section 3.2). |
| Rate-limit budget | `LOGIN_RL` | 10 attempts / 10 min / IP + account (section 3.5). |

How each flows: `VPS_SSH` only for operations (sections 5, 7, 8).
`PUBLIC_DOMAIN` is baked into Caddyfile, RP ID/origin, and cookie flags;
changing it later invalidates passkeys (RP ID bound) so pick it once.
`VPS_HOST` pre-DNS may be an IP; Caddyfile uses `PUBLIC_DOMAIN` only after
DNS resolves.

## 1. Goals, non-goals, settled decisions

### Goals

- Friends and family log in over public HTTPS with password + passkey.
- Invite-only signup, owner-reset recovery, no email, no self-service.
- Sessions through one choke point (`requireUser` resolves session cookie).
- Per-user data stays isolated (S11 per-user SQLite intent).
- Coach and every feature keep working with the model absent (existing
  degrade-gracefully rule, server/llm.ts).

### Non-goals

- No open registration, no OAuth/social, no email/SMS of any kind.
- No Tailscale anything (client, serve, funnel): removed, not kept.
- No migration of sync data: none exists on this machine (S11, ADR 0002).
- No native iOS work, no watch, no social feed (PLAN out of scope stands).
- No new engine/coach-model training; section 9 picks a serving option only.

### Settled decisions (mirror of ADR 0002, owner 2026-10-01)

1. Users are friends and family. They do not join the tailnet.
2. Credentials are passwords plus passkeys (WebAuthn). Both, not either/or:
   password at signup, passkey enrolled later as the convenient path.
3. Signup is invite codes the owner hands out. No open registration.
4. No Tailscale at all. Qala runs on the owner's VPS and everybody, owner
   included, reaches it over public HTTPS with password + passkey. The
   `Tailscale-User-Login` identity path is removed, not kept owner-only.
5. Lockout recovery is owner reset only. No email, no self-service flow.
6. Recommended shape (for review, not settled): session cookie HttpOnly +
   Secure + SameSite=Lax with server-side expiring record; Deno on loopback
   behind Caddy; Argon2id password hashes; single-use expiring invites;
   passkeys enrolled post-login in Settings with password as fallback; owner
   CLI reset in person; owner is a regular user (first invite redeems to the
   owner row); `server/auth.ts` header auth and the loopback-only bind rule
   are replaced; `deploy/tailscale-serve.md` is retired.

## 2. Architecture (VPS + Caddy + Deno loopback, no Tailscale)

```
browser/PWA  --HTTPS-->  Caddy (:443, PUBLIC_DOMAIN)  --HTTP-->
127.0.0.1:8500 Deno (server/mod.ts) --> VPS disk (auth.sqlite + data/users/)
```

- One Deno process on the VPS, still bound to loopback (`BIND_HOSTNAME`
  127.0.0.1, `BIND_PORT` 8500, server/mod.ts). What changes is who fronts
  it: Caddy over public HTTPS replaces `tailscale serve` over the tailnet.
- Caddy terminates TLS (automatic HTTPS needs the real `PUBLIC_DOMAIN`),
  proxies `/` to loopback, and owns HTTPS redirects + HSTS. No app TLS code.
- Deno owns: session auth on every route, static PWA, `/api/*` (auth,
  sync, blobs, llm proxy, elevation, tiles). Every route that serves user
  data calls the new session `requireUser`; `/health` stays open.
- Storage on VPS disk: one `auth.sqlite` (users, invites, sessions,
  credentials) plus S11 per-user sync stores. Backed up to callisto
  (section 8).
- No tailnet, no identity header, no Funnel. The phone PWA and desktop PWA
  are the same origin (`https://PUBLIC_DOMAIN`), so one session cookie and
  one WebAuthn RP cover both. Capacitor/native shells are out of scope for
  this plan except the device gates in section 11.

## 3. Auth design

All endpoints below are PROPOSED (no auth-route evidence in repo; current
server has no /api/auth/*). Status codes follow the existing
`authErrorResponse` shape `{ error }` (server/auth.ts L86-91).

### 3.1 Endpoints (proposed)

| Method + path | Authed? | Request body | Success | Errors |
|---|---|---|---|---|
| POST /api/auth/invite/redeem | no | `{ code, login, password }` | 201 `{ userId }` + Set-Cookie session | 400 bad code/login/password, 404 unknown code, 410 used/expired |
| POST /api/auth/login/password | no | `{ login, password }` | 200 `{ userId }` + Set-Cookie | 401 wrong credentials (generic), 429 rate-limited |
| POST /api/auth/logout | yes | `{}` | 204 + clear cookie | 401 no session |
| GET /api/auth/me | yes | - | 200 `{ userId, login, passkeys: [{id, name, createdAt}], createdAt }` | 401 no session |
| POST /api/auth/webauthn/register/options | yes | `{ name? }` | 200 PublicKeyCredentialCreationOptions JSON | 401, 429 |
| POST /api/auth/webauthn/register/verify | yes | attestation response JSON | 201 `{ credentialId }` | 400 verification failed, 401, 429 |
| POST /api/auth/webauthn/login/options | no | `{ login? }` (empty = discoverable) | 200 PublicKeyCredentialRequestOptions JSON | 429 |
| POST /api/auth/webauthn/login/verify | no | assertion response JSON | 200 `{ userId }` + Set-Cookie | 401 failed, 429 |
| DELETE /api/auth/webauthn/:id | yes | - | 204 | 401, 404 not yours |
| GET /sync, POST /api/sync, PUT/GET /api/blobs/*, POST /api/llm/chat, GET /api/elevation, /tiles/* | yes (change) | as today + S11 | as today | 401 without valid session cookie (new; today only /sync checks identity, docs/rust-core.md section 5) |

WebSocket `/sync` (if it survives S11; S11 proposes replacing ws.ts with
POST /api/sync): authenticate by cookie at upgrade time via the same
session lookup. UNCLOSED: exact upgrade-cookie plumbing; S11 replacement
may delete this row entirely.

### 3.2 Session cookie spec (proposed, follows ADR 0002 line 28-30)

- Name: `qala_session` (new; no cookie exists today).
- Value: 256-bit random token (32 bytes, base64url), generated with
  `crypto.getRandomValues`. Stored only as a hash server-side.
- Flags: `HttpOnly; Secure; SameSite=None; Path=/; Max-Age=SESSION_DAYS`.
  Host-only (no Domain attribute) on `https://PUBLIC_DOMAIN`. `None` (not
  Lax) because the Capacitor phone shell's origin is `https://localhost`
  (server/auth.ts `CAPACITOR_ORIGIN`) calling `https://PUBLIC_DOMAIN`
  cross-site; Lax cookies would not be sent. The browser PWA uses the
  same cookie, one code path.
- Server record: `sessions(token_hash, user_id, created_at, expires_at,
  last_seen_at, ip, user_agent)`. Lookup hashes the presented token with
  SHA-256 and compares; expiry enforced server-side, not just Max-Age.
- Lifetime (CLOSED, closes U4): `SESSION_DAYS` default 30, sliding:
  refresh `expires_at`/`last_seen_at` on use, re-issue the cookie when
  < 7 days remain. Second device = separate session row; no forced
  single-device (S11 sync is already multi-device, ADR 0002). Owner can
  override the default without a code change (env, section 0).
- CSRF (CLOSED, closes the U10 CSRF item): `SameSite=None` forces an
  explicit token. Double-submit: login/redeem responses also set a
  readable `qala_csrf` cookie (Secure, NOT HttpOnly, same Max-Age);
  every POST/DELETE must carry its value in `X-CSRF-Token`, and the
  server rejects mismatches with 403. No server-side CSRF store needed.
  The Capacitor shell reads the cookie via its WebView cookie jar and
  echoes the header like the browser does.
- Logout deletes the row and clears the cookie (`Max-Age=0`).

### 3.3 Password hashing (CLOSED by probe 2026-10-01, closes U1)

- Choice: Argon2id server-side (ADR 0002 recommended shape).
- Library: `npm:argon2` pinned (probe used 0.44.0; re-pin to latest at
  implement time). Verified on Deno 2.9.6 on this machine: `argon2.hash`
  with `{ type: argon2.argon2id }` returns a PHC string
  (`$argon2id$v=19$m=65536,t=3,p=4$...`) and `argon2.verify` returns true.
  Deno handles it via `nodeModulesDir: auto` (probe printed that hint, no
  config change needed). Native prebuilds assume glibc: VPS runs
  Debian/Ubuntu (section 7), never Alpine/musl, or the install falls back
  to building from source. Fallback if the native binding ever fails:
  `npm:hash-wasm` argon2id (pure WASM, slower, same PHC output).
- Params (explicit, do not rely on library defaults): memory 65536 KiB
  (64 MiB), iterations 3, parallelism 4. This exceeds the OWASP Password
  Storage floor (m=19456, t=2, p=1, confirmed via OWASP cheat-sheet
  mirrors 2026-10-01); family-scale login volume makes the extra cost
  irrelevant. Params live in the PHC string, so a future bump does not
  invalidate stored hashes.
- No pepper in v1. Password policy (server-enforced): 12+ chars, no
  composition rules, max 256 (DoS cap on hashing input, not a UX limit).
- Verify path must be constant-time on the comparison the library gives,
  and login failure messages must not distinguish unknown login from wrong
  password.

### 3.4 WebAuthn flows (CLOSED by probe + docs 2026-10-01, closes U2)

- Library: `@simplewebauthn/server` v13 pinned (probe used 13.3.0;
  re-pin to latest v13 at implement time). Verified two ways: (1) runtime
  probe on Deno 2.9.6, `npm:@simplewebauthn/server@13.3.0` —
  `generateRegistrationOptions` and `generateAuthenticationOptions` both
  return challenges; (2) maintainer docs list Deno v2.4+ as supported and
  publish `jsr:@simplewebauthn/server` (`deno add jsr:@simplewebauthn/server`).
  Prefer the JSR specifier (Deno-native, no npm compat layer); npm is the
  verified fallback. Client side: `@simplewebauthn/browser` v13 in the PWA.
  Confirm exact `registrationInfo.credential` field names against the
  installed v13.x source at implement time; the storage mapping below
  follows the v13 shape (id base64url, publicKey COSE bytes, counter,
  transports).
- RP ID: `PUBLIC_DOMAIN` exactly (no port, eTLD+1 registrable domain).
  Origin: `https://PUBLIC_DOMAIN` exactly. One-way door (section 0).
- Registration (authed, in Settings): client calls register/options ->
  `navigator.credentials.create()` -> register/verify; persist
  `{ credentialId, publicKeyCOSE_b64u, counter, transports, name }`.
  Request `residentKey: preferred`, `userVerification: preferred` (so
  PIN-less platform keys work), `attestation: none` (no trust store in
  v1), `excludeCredentials` = user's existing ids, timeout 60 s.
- Authentication (login page, passwordless path): login/options (with
  login -> `allowCredentials` from stored ids; without -> discoverable,
  empty allow list) -> `navigator.credentials.get()` -> login/verify ->
  session cookie on success, timeout 60 s. Counter updated on each use;
  counter regression = 401 + flag credential for owner review.
- Password stays as fallback always (ADR settled point 2); deleting the
  last passkey is allowed and leaves password login intact.
- Platform scope v1: passkeys work in the BROWSER PWA only. The Capacitor
  Android shell (origin `https://localhost`) cannot do WebAuthn directly:
  embedded WebViews need a Credential Manager bridge plugin plus Digital
  Asset Links binding the app signature to PUBLIC_DOMAIN (verified via
  passkeys.dev Android reference + field reports, 2026-10-01). So v1
  native uses password + the 30-day sliding session; the bridge plugin
  (or the native-Android Credential Manager path in docs/android-native.md)
  is a later phase, same RP ID, no re-enrollment needed.

### 3.5 Rate limits (CLOSED, closes U5; values adopted as specified)

Enforce server-side, in-memory timestamp buckets in v1 (single Deno
process per section 7.3, so no shared store needed; a restart resets
budgets, acceptable). Budgets below are final unless load testing says
otherwise:

| Scope | Proposed budget |
|---|---|
| password login + webauthn verify, per IP | 10 fails / 10 min, then 429 |
| same, per account login | 10 fails / 10 min, then 429 (still generic 401 body until limit) |
| invite redeem, per IP | 20 / hour, then 429 |
| webauthn options, per IP | 30 / 10 min |
| /api/sync + blobs, per session | none in v1 beyond auth |

429 body: `{ error, retryAfterMs }`. Log IP + login + route on 401/429
without logging passwords or tokens.

## 4. Storage

### 4.1 SQLite driver choice (CLOSED by probe 2026-10-01, closes U3)

- Driver: `node:sqlite` (`DatabaseSync`), verified on Deno 2.9.6 on this
  machine: open, `exec`, `prepare(...).all()` all work against `:memory:`
  and file DBs. No fallback needed; the append-only-JSONL branch in
  docs/rust-core.md section 4 is not taken.
- Pragmas: `PRAGMA journal_mode=WAL` (verified settable) and
  `PRAGMA foreign_keys=ON` (for the ON DELETE CASCADE clauses in 4.2) on
  every open.
- Handles: one long-lived `DatabaseSync` per DB file (auth.sqlite plus one
  per user). `node:sqlite` is synchronous and Deno runs it on the main
  thread; at friends-and-family write volume this is fine, no pool.
- Backup API: `db.backup()` is UNDEFINED on Deno 2.9.6's `node:sqlite`
  (probed `typeof db.backup === "undefined"`), so snapshots use
  `VACUUM INTO '<snapshot path>'`, verified working with a WAL DB (probe
  wrote a row, snapshotted, read it back from the snapshot). Section 8
  builds on this.
- Remaining phase-0 gate (narrowed): kill -9 mid-write then reopen +
  `PRAGMA integrity_check` on WAL files. Pass = clean. This is a gate,
  not a driver decision.

### 4.2 Auth schema (proposed, one file `data/auth.sqlite`)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,            -- uuid v4, also S11 user id
  login TEXT NOT NULL UNIQUE,     -- normalizeLogin(login)
  password_hash TEXT NOT NULL,    -- Argon2id PHC string
  created_at TEXT NOT NULL,       -- ISO 8601
  is_owner INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE invites (
  code TEXT PRIMARY KEY,          -- sha256 hex of the 128-bit base32 code, single-use
  prefix TEXT NOT NULL,           -- first 6 chars, for owner lookup
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  redeemed_by TEXT REFERENCES users(id),
  redeemed_at TEXT,
  label TEXT                     -- "for X", owner bookkeeping
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,    -- hex sha256 of cookie token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip TEXT, user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE webauthn_credentials (
  id TEXT PRIMARY KEY,            -- base64url credential id
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,       -- base64url COSE bytes (SimpleWebAuthn v13 credential.publicKey)
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                -- JSON array or NULL
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX idx_webauthn_user ON webauthn_credentials(user_id);
```

### 4.3 Per-user S11 data layout (proposed, extends inspected code)

- Today: `data/users/<login>.json` record + `data/users/<login>/chunks`
  (server/sync.ts L118-124, L184). S11 (proposed) replaces this with
  per-user SQLite and record sync; no data exists to migrate.
- Proposed S11-on-VPS layout: `data/users/<userId>.sqlite`, one file per
  user id (not login, so renames are free), holding record rows
  `(record_id, type, deleted)`, field rows
  `(record_id, field, hlc_wall, hlc_counter, hlc_node, value_json, seq)`,
  a `cursors(seq)` counter, and blob refcounts; blobs at
  `data/blobs/<sha256>` content-addressed (docs/rust-core.md section 5).
- Auth tables (4.2) stay in the separate shared `data/auth.sqlite`; sync
  files never hold hashes or tokens. `requireUser` maps session -> userId
  -> `<userId>.sqlite` path; path traversal impossible since userId comes
  from the session row, never the URL.
- UNCLOSED: exact sync/blob table DDL (owned by the S11 track, not this
  plan); this plan only constrains auth mapping + file-per-user + no
  cross-user reads (test: session A cannot read user B file, 403/404).

### 4.4 Secrets handling

- No secrets in the repo, no `.env` checked in. VPS secrets live in
  `/etc/qala/env` (root-only, mode 600): currently nothing required in v1
  (no pepper, no mail keys); reserve for future `SESSION_PEPPER` if added.
- Invite codes are bearer secrets: shown once at creation (section 5),
  stored HASHED (CLOSED, closes the U10 hash-at-rest item): `invites.code`
  holds the `sha256(code)` hex digest, plus a `prefix TEXT` column with the
  first 6 chars for owner lookup (`invite-list` shows prefix + label only).
  Redeem hashes the presented code and compares against the indexed digest
  column (no full scan). File mode 600 on auth.sqlite and root-only backups
  stay as defense in depth.
- Password hashes: never logged, never returned in any API (GET /me
  excludes them), never included in backups sent off-VPS unencrypted
  (section 8 encrypts at rest on callisto).
- Owner CLI runs over `VPS_SSH` with no remote password entry: reset
  prints a one-time password that the owner hands over in person.

## 5. Invite + owner-reset runbooks (exact CLI commands, proposed)

No CLI exists in the repo today; commands below are the proposed contract
for a new `server/cli.ts` (Deno, same `node:sqlite` driver as section 4).
Implement exactly these verbs; flag names are part of the contract.

```sh
# Create one invite (prints the code ONCE):
ssh VPS_SSH 'deno run --allow-all /srv/qala/server/cli.ts invite-create --label "for X" --days 14'
# -> invite code=<CODE> expires=<ISO>

# List invites (code prefixes only, no full codes):
ssh VPS_SSH 'deno run --allow-all /srv/qala/server/cli.ts invite-list'

# Revoke an invite:
ssh VPS_SSH 'deno run --allow-all /srv/qala/server/cli.ts invite-revoke --code <CODE>'

# Owner bootstrap (first user; run once; <CODE> from invite-create):
# redeem happens in the browser at https://PUBLIC_DOMAIN/#/signup?code=<CODE>

# Lockout reset: set a one-time password AND clear passkeys (in person):
ssh VPS_SSH 'deno run --allow-all /srv/qala/server/cli.ts user-reset --login <LOGIN>'
# -> one-time password=<OTP> (user changes it at next login; all sessions revoked)

# Clear passkeys only (keep password):
ssh VPS_SSH 'deno run --allow-all /srv/qala/server/cli.ts user-clear-passkeys --login <LOGIN>'

# Revoke all sessions for a user:
ssh VPS_SSH 'deno run --allow-all /srv/qala/server/cli.ts user-revoke-sessions --login <LOGIN>'

# Delete a user (auth row + their <userId>.sqlite + blobs kept; confirm prompt):
ssh VPS_SSH 'deno run --allow-all /srv/qala/server/cli.ts user-delete --login <LOGIN> --yes-i-know'
```

Runbook rules: invites single-use + 14-day default expiry (proposal);
redeem creates the user row + empty per-user store + initial password and
logs the user in (201 + cookie). Owner reset is the ONLY recovery path
(ADR settled point 5): no email, no self-service, nothing remote. Every
CLI verb logs to stdout only; invite codes and OTPs are shown once on
stdout and never written to disk. The owner runs the CLI over their own
SSH session, so VPS shell history is the only exposure surface: prefix
sensitive invocations with a space (HISTCONTROL=ignorespace, set it in the
qala user's .bashrc during phase 4) and prefer `--code-file -` (stdin)
over `--code` for redeem-by-CLI if that verb ever exists.

## 6. PWA/UX screen inventory

Hash routes today: `#/` landing, `#/desktop/*`, `#/phone/*` (app.tsx).
Auth adds the smallest set that covers the flows; existing shells unchanged
except a session gate + Settings additions.

| # | Screen / route (proposed) | Shell | Purpose |
|---|---|---|---|
| A1 | `#/login` | shared, unauthed | password login + passkey login button + link to signup |
| A2 | `#/signup?code=` | shared, unauthed | invite redeem: login + password + code -> creates user, logs in |
| A3 | auth gate wrapper | both shells | unauthed visit to any `#/desktop/*` or `#/phone/*` redirects to `#/login?next=`; authed visit to `#/login` redirects to last shell |
| S1 | Settings -> Passkeys section | `SettingsPage.tsx` (shared by both shells today) | list credentials (name, created, last used), enroll new (name prompt + platform picker), delete per key |
| S2 | Settings -> Password section | same file | change password (current + new), shows fallback note |
| S3 | Settings -> Sessions section | same file | list sessions (device UA, last seen), revoke one / revoke others |
| S4 | Settings -> Account section | same file | login name, owner-reset instructions ("ask the owner in person"), logout button |
| E1 | 401/expired handling | all fetch paths | expired session -> redirect to `#/login?next=` with "signed out" notice, no data loss (offline queue intact) |

Existing inventory left untouched (verified in repo): desktop has
Overview, Lifts, LiftDetail, Running, RunDetail, Body, MuscleDetail,
History, SessionDetail, ProgramEditor, ExerciseDb, CoachMemory,
Calibration, Settings; phone has Plan, Today, Checkin, Warmup, Workout,
AllExercises, Rest, SessionComplete, Body, Progress, Coach, PlateCalc,
Settings, History, StartRun, LiveRun, GuidedRun, RunSummary. PWA manifest
(`start_url /`, standalone, icons) needs no change for auth.

Device notes: passkey enrollment must work in the installed PWA on
Android/Chrome and desktop Chrome/Safari; iOS lift-only PWA gets password
login first, passkey where the OS supports it (device gates, section 11).

## 7. VPS deploy + Caddyfile + systemd + hardening checklist

### 7.1 Layout on the VPS (proposed)

```
/srv/qala/            git checkout (branch explore/accounts-logins, then main)
  server/             Deno server (mod.ts entry)
/srv/qala/data/       auth.sqlite + users/ + blobs/ (mode 700, qala:qala)
/etc/qala/env         private env (mode 600, root:root), see section 4.4
/etc/caddy/Caddyfile  section 7.2
/etc/systemd/system/qala.service  section 7.3
```

### 7.2 Caddyfile (proposed; replace PUBLIC_DOMAIN before use)

```caddy
PUBLIC_DOMAIN {
    encode gzip
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        X-Frame-Options "DENY"
        Content-Security-Policy "frame-ancestors 'none'"
    }
    handle /health {
        uri strip_prefix /health
        reverse_proxy 127.0.0.1:8500
    }
    handle {
        reverse_proxy 127.0.0.1:8500
    }
    log {
        output file /var/log/caddy/qala.log {
            roll_size 100mb
            roll_keep 5
        }
    }
}
```

Caddy owns ports 80/443 + automatic HTTPS. Deno stays on 127.0.0.1:8500
and is never reached directly from outside the VPS.

### 7.3 systemd unit (proposed; extends deploy/qala.service)

```ini
[Unit]
Description=Qala workout server
After=network.target

[Service]
User=qala
Group=qala
WorkingDirectory=/srv/qala
ExecStart=/home/qala/.deno/bin/deno serve --allow-all /srv/qala/server/mod.ts
Environment=PORT=8500
Environment=HOST=127.0.0.1
EnvironmentFile=-/etc/qala/env
Restart=on-failure
RestartSec=5
# Hardening (proposed; verify each on the VPS distro before ship):
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/srv/qala/data /tmp
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
```

Deploy steps: `ssh VPS_SSH`, install Deno 2.9.x + Caddy, create `qala`
user, clone, `deno task build`, `systemctl enable --now qala`, install
Caddyfile, `systemctl reload caddy`, `curl https://PUBLIC_DOMAIN/health`.

### 7.4 Hardening checklist (do all before first invite)

- [ ] UFW/firewall: allow 22, 80, 443 only; deny 8500 from outside.
- [ ] SSH keys only, no password auth; fail2ban or equivalent on 22.
- [ ] Auto security updates enabled on the VPS distro.
- [ ] `/srv/qala/data` mode 700 `qala:qala`; `auth.sqlite` mode 600.
- [ ] Caddy TLS valid + HSTS header present (`curl -I` check).
- [ ] Deno process actually on 127.0.0.1 (`ss -tlnp | grep 8500`).
- [ ] `/health` reachable publicly; no other unauthed data route (section 11).
- [ ] Rate limits live (section 3.5 probe: 11 bad logins -> 429).
- [ ] Backups running (section 8) before the owner invite is redeemed.
- [ ] Log rotation live: Caddy `log { output file ... { roll_size 100mb
  roll_keep 5 } }`, Deno via journald (`SystemMaxUse=1G`); 401/429 lines
  kept 90 days, no passwords/tokens/cookies in any log (closes the U10
  logging item).

## 8. Backup/restore runbook

What: `auth.sqlite` + `data/users/*.sqlite` + `data/blobs/` (VPS) -> callisto.
Why callisto: ADR 0002 recommended shape ("backed up to callisto").

```sh
# Step 1, ON THE VPS (systemd timer, qala user): snapshot every sqlite db
# with VACUUM INTO (CLOSED mechanism, closes U8; db.backup() does not exist
# on Deno 2.9.6's node:sqlite, VACUUM INTO verified working, section 4.1).
# Blobs are immutable content-addressed files, copied as-is.
/srv/qala/scripts/snapshot.sh  # writes /srv/qala/data-snap/auth.sqlite etc.

# Step 2, on callisto (cron, pulls the staging dir; keys already set up):
rsync -a --delete VPS_SSH:/srv/qala/data-snap/ /srv/backups/qala/data/
# Snapshot with date (simple rotation, 7 daily):
cp -al /srv/backups/qala/data /srv/backups/qala/data-$(date +%F)  # hardlink snapshot
ls -dt /srv/backups/qala/data-* | tail -n +8 | xargs -r rm -rf

# Integrity spot-check after pull (auth db + one user db):
sqlite3 /srv/backups/qala/data/auth.sqlite 'PRAGMA integrity_check;'
```

`snapshot.sh` (runs on the VPS, app keeps running, no stop-the-world):

```sh
#!/bin/sh
# Snapshot each live sqlite db to the staging dir. VACUUM INTO takes a
# read-consistent copy even under WAL writers; never rsync live -wal files.
set -eu
STAGE=/srv/qala/data-snap
mkdir -p "$STAGE/users"
sqlite3 /srv/qala/data/auth.sqlite "VACUUM INTO '$STAGE/auth.sqlite'"
for db in /srv/qala/data/users/*.sqlite; do
  [ -e "$db" ] || continue
  sqlite3 "$db" "VACUUM INTO '$STAGE/users/$(basename "$db")'"
done
rsync -a --delete /srv/qala/data/blobs/ "$STAGE/blobs/"
```

Rules: backups on callisto are mode 700 and age-encrypted at rest (CLOSED,
closes the U8 encryption item): after the pull, `tar -C /srv/backups/qala
-cf - data-$(date +%F) | age -r <OWNER_AGE_PUBKEY> -o
/srv/backups/qala/data-$(date +%F).tar.age`, keep the .age files, prune
plaintext older than 2 days. Owner holds the age private key; the VPS never
sees it. They contain password hashes, hence encryption even though callisto
disk is the trust root.

Restore:

```sh
# Restore to VPS (downtime window; stop app first):
age -d -i ~/.age/qala.key -o /tmp/qala-restore.tar /srv/backups/qala/data-YYYY-MM-DD.tar.age
mkdir -p /tmp/qala-restore && tar -C /tmp/qala-restore -xf /tmp/qala-restore.tar
ssh VPS_SSH 'systemctl stop qala'
rsync -a /tmp/qala-restore/data-YYYY-MM-DD/ VPS_SSH:/srv/qala/data/
ssh VPS_SSH 'systemctl start qala && curl -sf http://127.0.0.1:8500/health'
```

Test restore quarterly on callisto itself (sqlite opens + row counts match).
Point-in-time granularity stays daily in v1; blob dedup across snapshots
rides the hardlinks until proven otherwise.

## 9. Coach LLM decision

Fact: `/api/llm/chat` (server/llm.ts) proxies to llama-server on
`http://127.0.0.1:8080` (callisto-local, model `gemma-4-E4B_q4_0-it`,
60 s timeout, degrade-gracefully 502 + `{degraded:true}`).
With no tailnet the VPS cannot reach callisto, so that proxy target is
dead on arrival (ADR 0002 open question; docs/PLAN.md llama-server is a
callisto systemd user unit, not portable by config).

Options from ADR 0002: (a) CPU inference of a small model on the VPS, or
(b) coach goes quiet until a hosted path exists.

RECOMMENDATION: (b) coach goes quiet, and do it by keeping the existing
degrade-gracefully contract, not by deleting the coach.

- `/api/llm/chat` on the VPS returns the same 502 `{degraded:true}`
  shape it returns today when llama-server is down. No client rewrite:
  Coach tab, check-in words, and bounded nudges already treat degraded as
  "feature works without words" (server/llm.ts header, PLAN section 11).
- PWA copy change only: Coach tab shows "Coach is resting" empty state
  when degraded persists (one string, no logic fork).
- Why not (a): no evidence in repo for VPS CPU/RAM sizing, no measured
  tokens/sec for any small model on that box, and a second model means a
  second prompt/behavior contract to maintain. Revisit only with a named
  VPS SKU + a measured latency gate (proposal: p50 first token < 5 s on
  CPU or stay quiet).
- UNCLOSED (carried to section 13): hosted-LLM path (provider, key
  handling, per-user cost cap) if quiet turns out unacceptable.

## 10. Migration/retirement (remove Tailscale auth, docs, loopback rule)

No data migrates (nothing on this machine per S11/ADR). This is code + doc
removal, in this order (each step keeps the tree green):

1. `server/auth.ts`: delete `IDENTITY_HEADER`, `CAPACITOR_ORIGIN` special
   case (keep the constant only if PWA still needs the literal; else
   delete), `userIdFromRequest` header read, `requireUser(req)` header
   form. Replace with `requireUser(req, sessionStore)` resolving the
   `qala_session` cookie -> sessions row -> userId (401 `{error}` on
   miss/expiry, same `AuthError` shape). Keep `normalizeLogin`,
   `requireDocOwnership` (S11 path check stays), `authErrorResponse`.
2. `assertLoopbackBind` / `isLoopbackHost`: delete the refuse-non-loopback
   rule as an auth boundary (ADR: replaced by session auth). KEEP binding
   loopback in practice (section 2/7: Caddy fronts it), but as a deploy
   fact, not a `throw`. Update the comment that says "Tailscale serves
   this port" in both auth.ts and mod.ts.
3. `server/mod.ts`: `startServer` drops the assert; every data route
   (`/api/llm/chat`, `/api/elevation`, `/tiles/*`, sync, blobs) gains
   `requireUser`. `/health` stays open.
4. `server/ws.ts` + `checkWsUpgrade`: rework to cookie-at-upgrade or
   delete with the S11 `POST /api/sync` replacement (whichever lands
   first; do not maintain both).
5. `deploy/tailscale-serve.md`: DELETE. Replace with `deploy/caddy.md`
   (section 7.2 content + DNS steps).
6. `deploy/qala.service`: rewrite to section 7.3 (system unit, `qala`
   user, `/srv/qala`, hardening).
7. Tests: `server/auth_test.ts` header cases -> cookie cases;
   `mod_test.ts`/`ws_test.ts` upgrade-with-`Origin:https://localhost`
   cases -> cookie-present vs cookie-absent cases. No test may send the
   Tailscale header afterward (grep gate: `tailscale-user-login` appears
   nowhere except this plan + ADR history).
8. Docs sweep: docs/PLAN.md auth-v1 row, docs/DECISIONS.md S3 intent line
   ("Tailscale identity"), docs/rust-core.md sections 4-5 auth sentences,
   docs/android-native.md `requireUser` notes: all change "Tailscale
   identity through requireUser" to "session cookie through requireUser".
   ADR 0002 stays as history (superseded-by note if the shape changes).

## 11. Test plan (deno tests, device gates)

Repo gate today: `deno task test` =
`deno test --allow-all packages/ server/ apps/web/src/logic/` (root
deno.json) plus `deno task test` in server/deno.json. All new tests join
these; no new runner.

Deno tests (new/extended, all in server/):

- auth units: redeem happy path (201 + cookie + user row + empty store);
  redeem twice with same code (410); redeem unknown code (404); expired
  code (410); password login ok (200 + cookie) / wrong password (401,
  generic body) / unknown login (401, identical body); logout (204 +
  row gone); GET /me authed (200, no hash) / unauthed (401).
- session units: expired row -> 401; tampered token -> 401; sliding
  refresh re-issues cookie when < 7 days left; revoke-all kills every row.
- isolation: session A cannot GET/POST user B sync file or blob (401/404);
  DELETE /webauthn/:id of another user -> 404.
- rate limits: 11th bad login per IP and per account -> 429 with
  retryAfterMs; redeem flood -> 429.
- webauthn: register/verify with a fixture attestation (SimpleWebAuthn
  repo test vectors), login/verify happy + counter regression ->
  401; delete last key leaves password login working.
- every data route without cookie -> 401 (`/api/llm/chat`,
  `/api/elevation`, `/tiles/*`, sync, blobs); `/health` without cookie
  -> 200.
- CLI: invite-create/list/revoke, user-reset (OTP works once, sessions
  revoked, passkeys cleared), user-delete (auth row + sqlite gone).
- driver probe (section 4.1) as a checked-in test, kill -9 step manual.

Device gates (all on `https://PUBLIC_DOMAIN`, installed PWA where noted):

- Desktop Chrome: signup -> login -> enroll passkey -> logout -> passkey
  login -> change password -> revoke session; second-device session list
  shows two rows.
- Android Chrome PWA installed: same loop incl. platform passkey;
  airplane-mode offline queue survives a 401-expired redirect (E1).
- iOS Safari home-screen PWA (lift-only): password login + signup work;
  passkey attempted, absence recorded as supported/unsupported (no fail).
- Phone shell (Capacitor/native, if in scope when this lands): session
  cookie persists across restart; GPS run upload authed (S9/S11 blobs).

## 12. Phased rollout with verification gates per phase

- Phase 0, probes + inputs (no behavior change): collect section 0 inputs
  (DNS resolving); re-run the section 4.1 probes on the VPS itself
  (`node:sqlite` + `npm:argon2` + WebAuthn import) and pin versions in
  server/deno.json; run the kill -9 + integrity_check gate. Libraries are
  already chosen (3.3/3.4), this phase only confirms them on the target
  box. GATE: probe script + pins committed; `deno task test` green.
- Phase 1, auth core on callisto (VPS untouched): auth.sqlite schema,
  all section 3 endpoints, session `requireUser`, rate limits,
  section 5 CLI. GATE: all section 11 Deno tests pass; no Tailscale
  header in any new code path.
- Phase 2, route lockdown + retirement: section 10 steps 1-4 + 7 (every
  data route authed, header auth deleted, tests converted). GATE:
  unauthed sweep green (every data route 401, /health 200); grep gate
  `tailscale-user-login` clean; `deno task test` green.
- Phase 3, PWA screens: section 6 A1-A3 + S1-S4 + E1. GATE: desktop
  Chrome + Android PWA loops from section 11 pass against callisto-local
  Deno (PUBLIC_DOMAIN stubbed via /etc/hosts; RP ID exception documented
  for the stub only).
- Phase 4, VPS deploy + hardening: sections 7-8 (Caddy, systemd,
  firewall, backups running, restore drilled once). GATE: section 7.4
  checklist complete; backup + restore runbook executed once for real.
- Phase 5, owner bootstrap + first family invite: redeem OWNER_LOGIN,
  enroll owner passkey, hand out one invite, second user redeems on their
  own device. GATE: two users, two devices each, sessions isolated,
  owner reset drilled once (OTP + in-person handoff).
- Phase 6, docs + retirement: section 10 steps 5-6 + 8 (delete
  tailscale-serve.md, rewrite qala.service, docs sweep), coach-quiet copy
  (section 9). GATE: repo grep for `tailscale` returns only ADR history
  + this plan; PLAN/DECISIONS/rust-core/android-native auth sentences
  updated; final `deno task test` green.

## 13. Open questions

Closed by the 2026-10-01 probe round (runtime probes on Deno 2.9.6 on
callisto + doc verification; no library API asserted from memory):

- U1 CLOSED (3.3): `npm:argon2` pinned, argon2id m=65536/t=3/p=4, PHC
  strings. Probe: hash + verify true.
- U2 CLOSED (3.4): `@simplewebauthn/server` v13 (JSR preferred, npm
  verified), userVerification preferred, 60 s timeouts, attestation none.
  Probe: both options calls return challenges; maintainer docs confirm
  Deno v2.4+ support. Browser-PWA-only scope in v1 (native needs a
  Credential Manager bridge later).
- U3 CLOSED (4.1): `node:sqlite` DatabaseSync, WAL + foreign_keys pragmas,
  one handle per file. Probe: CRUD works; `db.backup()` undefined.
- U4 CLOSED (3.2): SESSION_DAYS default 30, sliding, re-issue under 7 days.
- U5 CLOSED (3.5): budgets adopted as specified.
- U8 CLOSED (8): `VACUUM INTO` snapshot script on the VPS (WAL-safe,
  probed) + rsync pull + age-encrypted 7-daily rotation on callisto.
- U10 CLOSED: SameSite=None + double-submit CSRF (3.2, forced by the
  Capacitor cross-site origin); X-Frame-Options DENY + frame-ancestors
  (7.2); invite codes stored as sha256 + prefix (4.2/4.4); Caddy
  roll_size/roll_keep + journald, 90-day auth-line retention (7.4).

Still open (genuinely need owner input or the S11 track):

- U6 PUBLIC_DOMAIN pick (one-way door for RP ID) + DNS cutover date.
  Blocks phase 0; everything else can proceed against a stub.
- U7 Sync/blob DDL (S11 track owns it) + ws-upgrade-vs-POST decision.
  This plan only constrains the auth mapping (4.3).
- U9 Hosted-LLM path if coach-quiet (section 9) is unacceptable.
  Deferrable past v1.

