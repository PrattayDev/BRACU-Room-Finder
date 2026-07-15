/**
 * BRACU runs three semesters a year: Spring, Summer, Fall.
 * There is no official API for "what semester is it" — so this module
 * does two things:
 *   1. A safe heuristic based on the calendar month (works even if
 *      bracu.ac.bd is briefly unreachable).
 *   2. A best-effort check against BRACU's own Academic Dates page,
 *      which publishes the real "Classes begin" date for each semester
 *      (this is effectively the "Year Planner" the site links to).
 * The heuristic is the fallback; the live check is the source of truth
 * when it succeeds.
 */

const ACADEMIC_DATES_URL = 'https://www.bracu.ac.bd/academic-dates';

// Rough month windows — BRACU's real semesters start a little earlier
// or later most years, which is exactly why we cross-check live below.
const HEURISTIC_WINDOWS = [
  { name: 'spring', startMonth: 1, endMonth: 4 },
  { name: 'summer', startMonth: 5, endMonth: 8 },
  { name: 'fall', startMonth: 9, endMonth: 12 },
];

function heuristicSemester(date = new Date()) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const win = HEURISTIC_WINDOWS.find(w => month >= w.startMonth && month <= w.endMonth);
  return { name: win.name, year, code: `${win.name}-${year}` };
}

function nextSemester({ name, year }) {
  const order = ['spring', 'summer', 'fall'];
  const idx = order.indexOf(name);
  if (idx === 2) return { name: 'spring', year: year + 1, code: `spring-${year + 1}` };
  const next = order[idx + 1];
  return { name: next, year, code: `${next}-${year}` };
}

/**
 * Fetches bracu.ac.bd/academic-dates and tries to find lines like
 * "Classes of Summer 2026 begin" followed by a date, so we know the
 * real start date rather than guessing from the month alone.
 * Falls back to null on any failure — callers should fall back to
 * the heuristic above.
 */
async function fetchRealSemesterStartDates() {
  try {
    const res = await fetch(ACADEMIC_DATES_URL, { headers: { 'User-Agent': 'BRACURoomFinder/1.0' } });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    const results = {};
    const re = /Classes of (Spring|Summer|Fall)\s+(\d{4})[^.]{0,40}?(?:begin|Begin)[^.]{0,40}?(\d{1,2}\s+\w+,?\s*\d{4}|\w+\s+\d{1,2},?\s*\d{4})/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const [, semName, semYear, dateStr] = m;
      const code = `${semName.toLowerCase()}-${semYear}`;
      const parsed = new Date(dateStr.replace(',', ''));
      if (!isNaN(parsed)) results[code] = parsed.toISOString();
    }
    return Object.keys(results).length ? results : null;
  } catch (err) {
    console.error('[semester] academic-dates fetch failed:', err.message);
    return null;
  }
}

/**
 * Public entry point: returns the semester BRACU is most likely
 * running right now, and the one coming up next (useful for
 * pre-fetching the schedule as soon as it's published, since it
 * usually goes up a few days before classes start).
 */
async function resolveCurrentSemester(now = new Date()) {
  const heuristicNow = heuristicSemester(now);
  const heuristicNext = nextSemester(heuristicNow);

  const realDates = await fetchRealSemesterStartDates();

  return {
    current: heuristicNow,
    next: heuristicNext,
    realStartDates: realDates, // { "summer-2026": "2026-06-14T00:00:00.000Z", ... } or null
    source: realDates ? 'academic-dates-page' : 'month-heuristic',
  };
}

module.exports = { resolveCurrentSemester, heuristicSemester, nextSemester, ACADEMIC_DATES_URL };
