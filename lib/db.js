const { createClient } = require('@supabase/supabase-js');

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (service role key, not anon — sync writes need it).');
  }
  return createClient(url, key);
}

/**
 * Replaces all sessions for a semester in one transaction-like sequence:
 * delete the old rows for that semester_code, then bulk-insert the new
 * ones. Simpler and safer than diffing row-by-row, and matches how
 * BRACU actually updates the document (whole-file replacement).
 */
/**
 * Sessions have a foreign key to semesters(code), so a semester row
 * must exist before any of its sessions can be inserted. This creates
 * a minimal placeholder row if one doesn't already exist yet — full
 * metadata (pdf_url, session_count, etc.) gets filled in afterward by
 * upsertSemesterMeta once the sessions are actually written.
 */
async function ensureSemesterRow(supabase, semesterCode) {
  const { error } = await supabase
    .from('semesters')
    .upsert({ code: semesterCode }, { onConflict: 'code', ignoreDuplicates: true });
  if (error) throw new Error(`Ensure semester row failed: ${error.message}`);
}

async function replaceSemesterSessions(supabase, semesterCode, rows) {
  const { error: delErr } = await supabase.from('sessions').delete().eq('semester_code', semesterCode);
  if (delErr) throw new Error(`Delete failed: ${delErr.message}`);

  const payload = rows.map(r => ({
    semester_code: semesterCode,
    sl: r.sl,
    course: r.course,
    faculty: r.faculty,
    section: r.section,
    day: r.day,
    start_time: r.start,
    end_time: r.end,
    room_raw: r.room_raw,
    building: r.building,
    room_no: r.room_no,
    room_type: r.room_type,
  }));

  // Insert in chunks — Supabase/PostgREST has a payload size limit.
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload.slice(i, i + CHUNK);
    const { error } = await supabase.from('sessions').insert(chunk);
    if (error) throw new Error(`Insert failed at offset ${i}: ${error.message}`);
  }
  return payload.length;
}

async function upsertSemesterMeta(supabase, { semesterCode, pdfUrl, publishedAt, sessionCount, failedLines }) {
  const { error } = await supabase.from('semesters').upsert({
    code: semesterCode,
    pdf_url: pdfUrl,
    published_at: publishedAt,
    session_count: sessionCount,
    failed_line_count: failedLines,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'code' });
  if (error) throw new Error(`Semester meta upsert failed: ${error.message}`);
}

async function getSemesterMeta(supabase, semesterCode) {
  const { data, error } = await supabase.from('semesters').select('*').eq('code', semesterCode).maybeSingle();
  if (error) throw new Error(`Semester meta fetch failed: ${error.message}`);
  return data;
}

module.exports = { getClient, ensureSemesterRow, replaceSemesterSessions, upsertSemesterMeta, getSemesterMeta };
