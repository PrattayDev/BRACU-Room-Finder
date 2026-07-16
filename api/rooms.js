/**
 * GET /api/rooms?semester=summer-2026
 * Returns every room for that semester with its full session list.
 * Live status (available/occupied/soon) is intentionally computed
 * client-side against the visitor's clock — see app/index.html — so
 * this endpoint just needs to be a thin, cacheable read of the data.
 * If ?semester is omitted, resolves the current semester automatically.
 */

const { resolveCurrentSemester } = require('../lib/semester');
const { getClient } = require('../lib/db');

const PAGE_SIZE = 1000; // Supabase/PostgREST's default max rows per request

/**
 * Fetches every row for a semester, paginating past Supabase's default
 * 1000-row-per-request cap. Without this, any semester with more than
 * 1000 sessions silently loses everything past that cutoff — which is
 * exactly what was happening here (4,553 real sessions, only the first
 * ~1000 by insertion order were ever returned).
 */
async function fetchAllSessions(supabase, semesterCode) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('sessions')
      .select('room_raw, building, room_no, room_type, course, faculty, section, day, start_time, end_time')
      .eq('semester_code', semesterCode)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    all = all.concat(data);
    if (data.length < PAGE_SIZE) break; // last page was partial — done
    from += PAGE_SIZE;
  }
  return all;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = getClient();
    let semesterCode = req.query.semester;
    if (!semesterCode) {
      const { current } = await resolveCurrentSemester();
      semesterCode = current.code;
    }

    const sessions = await fetchAllSessions(supabase, semesterCode);

    const roomMap = new Map();
    for (const s of sessions) {
      if (!roomMap.has(s.room_raw)) {
        roomMap.set(s.room_raw, {
          id: s.room_raw, building: s.building, room_no: s.room_no, type: s.room_type, sessions: [],
        });
      }
      roomMap.get(s.room_raw).sessions.push({
        course: s.course, faculty: s.faculty, section: s.section,
        day: s.day, start: s.start_time, end: s.end_time,
      });
    }

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json({
      semesterCode,
      totalSessions: sessions.length,
      rooms: Array.from(roomMap.values()),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
