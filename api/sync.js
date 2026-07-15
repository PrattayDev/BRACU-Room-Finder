/**
 * Vercel serverless function: GET/POST /api/sync
 *
 * This is the cron target (see vercel.json). Each run:
 *   1. Works out which semester(s) should be checked — current and next
 *      (checking "next" too means the moment BRACU publishes a new
 *      semester's PDF, usually a few days before classes start, we
 *      pick it up on the very next scheduled run instead of waiting).
 *   2. For each, fetches the live schedule page + PDF.
 *   3. Compares against what's stored (by PDF URL and publish date —
 *      BRACU uploads a new file with a new dated path whenever the
 *      schedule changes, so a URL change is a reliable "this is new"
 *      signal even if the on-page "Publish Date" isn't parsed).
 *   4. If changed, re-parses and replaces that semester's sessions.
 *
 * Protect this endpoint in production (see README) — it's a write
 * path, and Vercel Cron alone doesn't authenticate the request.
 */

const { resolveCurrentSemester } = require('../lib/semester');
const { fetchSemesterSchedule } = require('../lib/scraper');
const { parseSchedule } = require('../lib/parser');
const { getClient, replaceSemesterSessions, upsertSemesterMeta, getSemesterMeta } = require('../lib/db');

async function syncOneSemester(supabase, semesterCode) {
  const live = await fetchSemesterSchedule(semesterCode);
  if (!live.available) {
    return { semesterCode, status: 'not_published', reason: live.reason };
  }

  const existing = await getSemesterMeta(supabase, semesterCode);
  const unchanged = existing && existing.pdf_url === live.pdfUrl;
  if (unchanged) {
    return { semesterCode, status: 'unchanged', pdfUrl: live.pdfUrl };
  }

  const { rows, failed } = parseSchedule(live.rawText);
  if (rows.length === 0) {
    // Don't wipe good data with a bad parse (e.g. BRACU changed the PDF layout).
    return { semesterCode, status: 'parse_failed', failedLineCount: failed.length };
  }

  const inserted = await replaceSemesterSessions(supabase, semesterCode, rows);
  await upsertSemesterMeta(supabase, {
    semesterCode,
    pdfUrl: live.pdfUrl,
    publishedAt: live.publishedAt,
    sessionCount: inserted,
    failedLines: failed.length,
  });

  return {
    semesterCode,
    status: existing ? 'updated' : 'created',
    sessionCount: inserted,
    failedLineCount: failed.length,
    pdfUrl: live.pdfUrl,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const supabase = getClient();
    const { current, next, source } = await resolveCurrentSemester();

    const results = [];
    for (const sem of [current, next]) {
      try {
        results.push(await syncOneSemester(supabase, sem.code));
      } catch (err) {
        results.push({ semesterCode: sem.code, status: 'error', message: err.message });
      }
    }

    return res.status(200).json({
      ok: true,
      semesterDetection: source,
      checked: [current.code, next.code],
      results,
      ranAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[sync] fatal:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
