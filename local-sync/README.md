# Local browser sync (free workaround for Cloudflare)

`bracu.ac.bd` sits behind Cloudflare, and Cloudflare serves a
JavaScript challenge ("Just a moment...") to any request that isn't a
real browser — this affects Vercel's servers *and* a plain script
running on your own PC equally, because the check isn't about where
the request comes from, it's about whether the client can execute
JavaScript like a browser does. That ruled out the original
Vercel-cron approach entirely.

This folder uses [Puppeteer](https://pptr.dev/) — a free, open-source
tool that drives a real headless Chrome — to actually pass that
challenge, then reuses the same parser and Supabase-writing code as
the rest of the project.

## One-time setup

```powershell
cd local-sync
npm install
```

This downloads a real (but headless, i.e. invisible) copy of Chromium
for Puppeteer to control — expect this install to take a few minutes
and ~200MB, that's normal.

## Running it manually

```powershell
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"
npm run sync
```

Watch the console output — it prints progress per semester and ends
with the same JSON summary format the old `/api/sync` endpoint gave
you (`status: created / updated / unchanged / not_published`).

## Automating it for free with Windows Task Scheduler

Since this needs to run on an actual machine (not Vercel), the free
way to make it "automatic" is scheduling it on your own PC:

1. Create a `.bat` file, e.g. `run-sync.bat`, in this folder:
   ```bat
   @echo off
   set SUPABASE_URL=https://your-project.supabase.co
   set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   cd /d "%~dp0"
   node sync-with-browser.js >> sync-log.txt 2>&1
   ```
   (Replace the two values with your real ones. Keep this file out of
   git — it has your service role key in plain text. It's already
   covered by `.gitignore` alongside `node_modules/`, but double check
   before committing.)

2. Open **Task Scheduler** (search for it in the Windows Start menu)

3. **Create Basic Task** → name it something like "BRACU Room Finder Sync"

4. **Trigger**: pick "Weekly" (BRACU only republishes a few times a
   semester, so daily is overkill — weekly is plenty, and you can
   always run it manually right after you know a new semester's
   schedule was posted)

5. **Action**: "Start a program" → Program/script: browse to
   `run-sync.bat` in this folder

6. Finish, then right-click the new task → **Run** once to confirm it
   works before trusting the schedule

7. Check `sync-log.txt` in this folder afterward to see the output

This runs whether or not your PC is doing anything else, as long as
it's on. If it's usually off, check "Wake the computer to run this
task" in the task's Conditions tab, or just run it manually every so
often — BRACU's actual publish frequency is low enough that this
doesn't need to be airtight.

## Why the rest of the app doesn't need this

Only the *scraping* step hits Cloudflare's challenge. Everything else
— `/api/rooms`, `/api/report`, the frontend, the Admin dashboard —
talks to Supabase directly and works exactly as before, fully live on
Vercel. This tool's only job is getting fresh data *into* Supabase;
once it's there, the rest of the stack neither knows nor cares how it
arrived.

`/api/sync` on Vercel can stay as-is (it'll keep returning
`not_published` due to the 403s) or you can remove its cron trigger in
`vercel.json` since it'll never succeed — up to you; leaving it is
harmless, it just won't do anything useful anymore.
