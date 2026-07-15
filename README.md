# BRACU Room Finder — full stack

Real, self-updating room availability for BRAC University. No mock data:
the backend fetches BRACU's own published Class Schedule PDF, parses it,
and re-checks automatically every semester.

```
public/index.html   The frontend (static, no build step)
api/rooms.js         GET  — rooms + sessions for the frontend to render
api/report.js        POST — crowdsourced status reports
api/sync.js           the cron job: detects the semester, re-scrapes if changed
lib/semester.js      figures out which semester BRACU is running right now
lib/scraper.js       fetches the schedule page + PDF from bracu.ac.bd
lib/parser.js         turns raw PDF text into structured session rows
lib/db.js             Supabase read/write helpers
supabase/schema.sql   run once in the Supabase SQL editor
```

## 1. Set up Supabase (5 min)

1. Create a free project at [supabase.com](https://supabase.com)
2. Open the **SQL Editor** and run everything in `supabase/schema.sql`
3. Go to **Project Settings → API** and copy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key (not `anon`) → `SUPABASE_SERVICE_ROLE_KEY`

The service role key can write past Row Level Security — that's required
for the sync job. It must **never** be exposed to the frontend; it only
lives in the backend's environment variables.

## 2. Deploy to Vercel

1. Push this folder to a GitHub repo
2. Import it at [vercel.com/new](https://vercel.com/new) — Vercel
   auto-detects the `api/` functions and serves `public/` statically,
   no framework config needed
3. In **Project Settings → Environment Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CRON_SECRET` — any long random string (protects `/api/sync`)
4. Deploy

Vercel reads `vercel.json` and registers the cron job automatically —
by default it runs `/api/sync` daily at 03:00 UTC (~09:00 Dhaka time).
Change the schedule in `vercel.json` if you want it more/less frequent;
BRACU's PDF doesn't change often outside registration periods, so daily
is plenty.

## 3. Run the first sync manually

Don't wait for the cron — trigger it once by hand so the database isn't
empty:

```
curl -X POST https://your-project.vercel.app/api/sync \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Check the response: each semester checked will report `created`,
`updated`, `unchanged`, `not_published`, or `parse_failed`. `created`
means it worked and rows are now in Supabase.

## 4. Open the site

`https://your-project.vercel.app` — the frontend calls `/api/rooms` on
load. If that succeeds you'll see "Live sync active" in the banner at
the top; if the backend isn't deployed yet or the sync hasn't run, it
silently falls back to the embedded offline snapshot instead of
breaking.

---

## How "check the year planner and update every semester" actually works

There's no webhook from BRACU — nothing tells your system "a new
semester just started." So `lib/semester.js` does two things every
time `/api/sync` runs:

1. **A safe heuristic** based on the calendar month (Jan–Apr → Spring,
   May–Aug → Summer, Sep–Dec → Fall). This always works, even if
   bracu.ac.bd is briefly down.
2. **A live check** against `bracu.ac.bd/academic-dates` — the page
   BRACU itself calls the source for "Class schedule PDF" links and
   which mirrors the Year Planner's semester start dates. It scans for
   lines like *"Classes of Summer 2026 begin [date]"* and uses that as
   the real anchor when it can parse it.

`/api/sync` then checks **both the current and the next semester**
every run. Checking "next" matters because BRACU typically publishes a
semester's schedule PDF a few days *before* classes start — checking
only "current" would miss that window and leave the site showing a
stale, just-ended semester until someone noticed.

For each semester checked, the sync compares the **PDF's own URL**
against what's stored (BRACU uploads a new file to a new dated path
every time the schedule changes — `/uploads/2026/06/08/...pdf`, etc.).
A different URL means new content, so it re-downloads, re-parses with
`lib/parser.js`, and replaces that semester's rows in one operation —
old sessions are deleted and the new set inserted together, which
matches how BRACU itself publishes (a whole-file replacement, not a
diff) and avoids ending up with a mix of old and new sections.

If the PDF is genuinely unchanged, the sync is a no-op — it does not
re-write data it doesn't need to.

## Known limitations, stated plainly

- **No live occupancy feed exists.** The published PDF is a semester
  snapshot. A class ending early or a professor being absent won't
  reflect in the schedule — that's what the crowd-confirmation layer
  (`/api/report`, 3 independent confirmations within an hour) is for.
- **Room capacity, AC, and projector info aren't in BRACU's PDF at
  all.** Rather than invent values, those filters were left out of the
  frontend. A real facilities layer would need a second, separately
  maintained table.
- **Faculty appear only as BRACU's internal initials** (e.g. "SHO"),
  since no public name directory is published alongside the schedule.
- **`/api/rooms` has no student-only gate yet.** Add BRACU-email-domain
  checks via Supabase Auth before treating this as production-ready for
  real student use — right now anyone with the URL can read it.
