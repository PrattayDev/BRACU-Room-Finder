-- BRACU Room Finder schema
-- Run this in the Supabase SQL editor once, before the first sync.

create table if not exists semesters (
  code text primary key,              -- e.g. 'summer-2026'
  pdf_url text,
  published_at timestamptz,
  session_count int,
  failed_line_count int,
  last_synced_at timestamptz
);

create table if not exists sessions (
  id bigint generated always as identity primary key,
  semester_code text not null references semesters(code) on delete cascade,
  sl int,
  course text not null,
  faculty text,
  section text not null,
  day text not null,
  start_time text not null,           -- e.g. '02:00PM' (kept as published; parse client-side)
  end_time text not null,
  room_raw text not null,             -- e.g. '07A-08C'
  building text,
  room_no text,
  room_type text
);

create index if not exists sessions_semester_idx on sessions(semester_code);
create index if not exists sessions_room_idx on sessions(room_raw);
create index if not exists sessions_day_idx on sessions(day);

-- Crowdsourced status reports, keyed to a room within a semester.
create table if not exists reports (
  id bigint generated always as identity primary key,
  semester_code text not null references semesters(code) on delete cascade,
  room_raw text not null,
  report_type text not null check (report_type in ('occupied','empty','locked','maintenance')),
  created_at timestamptz not null default now(),
  -- one browser/session shouldn't be able to confirm the same room twice
  -- in a row; enforce that at the application layer using this token.
  reporter_token text
);

create index if not exists reports_room_idx on reports(semester_code, room_raw, report_type);

-- Row Level Security: sessions and semesters are public read-only data;
-- writes only happen from the sync job using the service role key
-- (which bypasses RLS), so anon/public gets read-only access.
alter table semesters enable row level security;
alter table sessions enable row level security;
alter table reports enable row level security;

create policy "public read semesters" on semesters for select using (true);
create policy "public read sessions" on sessions for select using (true);
create policy "public read reports" on reports for select using (true);
create policy "public can insert reports" on reports for insert with check (true);
