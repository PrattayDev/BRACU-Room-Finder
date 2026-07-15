/**
 * POST /api/report
 * Body: { semesterCode, roomRaw, reportType, reporterToken }
 * reportType is one of: occupied | empty | locked | maintenance
 * reporterToken should be a stable-but-anonymous id generated client
 * side (e.g. crypto.randomUUID() stored in localStorage) — used only
 * to stop one browser from stuffing the same report repeatedly.
 */

const { getClient } = require('../lib/db');

const VALID_TYPES = new Set(['occupied', 'empty', 'locked', 'maintenance']);
const CONFIRMATION_THRESHOLD = 3;
const WINDOW_MINUTES = 60; // reports older than this don't count toward the threshold

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { semesterCode, roomRaw, reportType, reporterToken } = req.body || {};
  if (!semesterCode || !roomRaw || !VALID_TYPES.has(reportType) || !reporterToken) {
    return res.status(400).json({ error: 'semesterCode, roomRaw, valid reportType, and reporterToken are required' });
  }

  try {
    const supabase = getClient();

    const { error: insertErr } = await supabase.from('reports').insert({
      semester_code: semesterCode, room_raw: roomRaw, report_type: reportType, reporter_token: reporterToken,
    });
    if (insertErr) throw new Error(insertErr.message);

    const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { data: recent, error: countErr } = await supabase
      .from('reports')
      .select('reporter_token')
      .eq('semester_code', semesterCode)
      .eq('room_raw', roomRaw)
      .eq('report_type', reportType)
      .gte('created_at', since);
    if (countErr) throw new Error(countErr.message);

    const uniqueReporters = new Set((recent || []).map(r => r.reporter_token)).size;
    const confirmed = uniqueReporters >= CONFIRMATION_THRESHOLD;

    return res.status(200).json({ ok: true, uniqueReporters, threshold: CONFIRMATION_THRESHOLD, confirmed });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
