# coffee.justin06lee.dev

a booking page. pick a reason, pick a time, done.

```bash
bun install
bun run dev        # http://localhost:3000
bun run test       # slot math, timezone math, ics
bun run typecheck
bun run build
```

## what's where

| path | purpose |
|---|---|
| `src/lib/time.ts` | timezone primitives — instants, date keys, minutes past midnight |
| `src/lib/availability.ts` | pure slot engine: rules + overrides + busy → bookable instants |
| `src/lib/bookings.ts` | commit path, availability queries, admin stats |
| `src/lib/db.ts` | schema for the `coffee_*` tables |
| `src/components/chrome/` | vendored chrome components — owned code, edit freely |
| `src/app/[slug]/` | the public booking flow |
| `src/app/admin/` | availability, meeting types, bookings |
| `design/favicon/` | the icon generator and its SVG output |

## the icon

`design/favicon/generate.py` raymarches a cup and samples it onto a character
grid, the way the donut icons on the sibling sites work. It emits two variants,
and the tuning is aimed at 16px rather than at the artboard — at tab size the
ascii texture has averaged away and only the silhouette and the coarse
light-to-dark structure survive.

| variant | output | why |
|---|---|---|
| `--variant adaptive` | `src/app/icon.svg` | transparent; recolours the ink under `prefers-color-scheme` |
| `--variant opaque` | `design/favicon/apple-icon.svg` | black disc baked in; feeds the PNG |

The adaptive one swaps ink colour rather than inverting the opacity ramp. A
correct inversion is what a light ground would physically call for, and it
fails here: the rim term makes the silhouette the *brightest* part of the mark,
so inverting erases the outline. Note that this trick needs SVG-favicon support
to land — Chrome, Firefox and Edge honour it; Apple platforms fall back to the
touch icon, which is why that one keeps its disc.

Only SVG is committed. `src/app/apple-icon.png` is derived by
`scripts/build-icons.mjs` (sharp) and gitignored, so the binary cannot drift
from the drawing:

```sh
bun run icons     # also runs automatically before dev and build
```

Regenerate the SVGs after editing the generator:

```sh
python3 design/favicon/generate.py --variant adaptive > src/app/icon.svg
python3 design/favicon/generate.py --variant opaque > design/favicon/apple-icon.svg
```

## the three time types

Booking is the one domain where "what time is it" has two right answers at
once, so the code never mixes these:

- **instant** — epoch milliseconds. What the database stores. Unambiguous.
- **date key** — `"YYYY-MM-DD"`, a calendar day *in a named zone*.
- **minutes** — 0–1440, minutes past midnight *in a named zone*.

Availability rules are stored as minutes, not offsets, so 9am stays 9am to the
host on both sides of a daylight-saving change. No `Date` method that reads the
host machine's zone (`getHours`, `getDate`, …) may be used anywhere — the
server's zone is an accident of deployment.

Slots reach the browser as instants and are grouped into days *in the zone
being displayed*. A 5pm Los Angeles slot is 9am the next day in Tokyo, and a
Tokyo guest should find it under tomorrow.

## double-booking

Guarded twice. `createBooking` re-derives availability from the rules instead
of trusting the slot the client posted, which catches a stale page. A partial
unique index on `start_at where status = 'confirmed'` catches the narrower race
where two guests pass that check concurrently — the loser is told the slot went
away rather than getting a 500.

## database

The shared Turso instance every justin06lee.dev site talks to, so every table
is namespaced `coffee_`. Sessions get their own table rather than reusing the
shared one: the sites share an `ADMIN_KEY`, but a token lifted from one
shouldn't unlock another.

`initDb()` is idempotent and memoized per worker; it creates tables and seeds
first-run content (weekday 9–5 hours, three meeting types) only into genuinely
empty tables.

```bash
# apply the schema and print what came back
bun --conditions=react-server run scripts/db-check.ts

# book the next open slot, assert it disappears, then clean up after itself
bun --conditions=react-server run scripts/smoke-booking.ts
```

The `--conditions=react-server` flag is required: the lib modules import
`server-only`, which throws unless the resolver picks its react-server entry
the way Next does.

### env

```
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
ADMIN_KEY=            # the admin password
NEXT_PUBLIC_SITE_URL=
```

None of these are needed to build. The libsql client connects on first use
rather than at import, so `next build` succeeds with an empty environment and a
misconfigured deploy fails per-request naming the variable it wants, instead of
failing the build with `URL_INVALID: The URL 'undefined' is not in a valid
format`. A missing `ADMIN_KEY` disables admin login and warns once rather than
throwing, so the public booking flow stays up.

## admin

`/login`, then `/admin`. The layout under `/admin` redirects when there is no
session, but that is not the only guard — every mutating server action calls
`requireAdmin()` itself, since actions are reachable by POST without ever
rendering the layout that "protects" them.

There is no email on this site. A booking's confirmation page is its record,
reachable by an unguessable cancel token, and cancelling from the admin side
does not notify the guest.

## components

UI comes from [chrome](https://chrome.justin06lee.dev). Thirteen components
were written for this site and contributed back to the registry: `field`,
`radio-group`, `switch`, `callout`, `empty-state`, `skeleton`, `detail-list`,
`stepper`, `slot-picker`, `date-strip`, `timezone-select`,
`availability-grid`, `add-to-calendar`.

They are vendored from the local monorepo rather than installed with the CLI —
the deployed registry is behind it, so `chrome add slot-picker` 404s until
chrome.justin06lee.dev redeploys. After that, the CLI works normally:

```bash
bunx @justin06lee/chrome@latest add <name>
```

Installed components are owned code: edit them in place. If a change would be
useful elsewhere, make it in the chrome registry and re-vendor rather than
letting the copies drift.
