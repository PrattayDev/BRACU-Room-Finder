/**
 * Parses BRAC University's Class Schedule PDF text (as extracted by
 * pdf-parse) into structured session rows. This is a direct port of
 * the tokenizer that was validated against real Summer 2026 rows —
 * see /scripts/test-parser.js to re-run that check.
 */

const ROOM_RE = /^([A-Za-z0-9]{2,4})-(\d{1,3})([A-Za-z]?)$/;
const SUFFIX_MAP = { C: 'Classroom', L: 'Lab', T: 'Theater Room' };

function parseRoomCode(code) {
  const m = ROOM_RE.exec(code.trim());
  if (!m) return { raw: code, building: null, room_no: null, type: 'Unknown' };
  const [, building, num, suffix] = m;
  return { raw: code, building, room_no: num + suffix, type: SUFFIX_MAP[suffix] || 'Unknown' };
}

function resolveRoomForDay(roomField, day) {
  const field = roomField.trim();
  if (/^[A-Z]{3,4}\s+[\d:]+\s*[AP]M:/.test(field)) {
    const dayAbbr = day.slice(0, 3);
    const parts = field.split(';').map(p => p.trim());
    let chosen = null;
    for (const p of parts) {
      const pm = /^([A-Z]{3,4})\s+[\d:]+\s*[AP]M:\s*(.+)$/.exec(p);
      if (pm && pm[1].slice(0, 3) === dayAbbr) chosen = pm[2].trim();
    }
    if (chosen) return chosen;
    const pm = /^[A-Z]{3,4}\s+[\d:]+\s*[AP]M:\s*(.+)$/.exec(parts[0]);
    return pm ? pm[1].trim() : field;
  }
  return field;
}

// Matches one schedule row regardless of whether pdf-parse preserved
// spaces between table columns or collapsed them (both have been
// observed from BRACU's actual PDF depending on extraction path) —
// every gap between fields is optional whitespace (\s*).
//
// The course-code group is the trickiest part: some courses have a
// trailing suffix letter directly attached with no space (e.g.
// "CSE101L"), and those never have a named faculty. To avoid
// mismatching a real faculty's first initial as a fake course suffix,
// the trailing letter is only captured as part of the course code if
// it's immediately followed by a digit (the start of the section
// number) — i.e. no faculty letters intervening.
// The course-code group is the trickiest part: some courses have a
// trailing suffix letter (lab codes like "CSE101L", or section-letter
// courses like "CSE490A") that may or may not be separated from the
// faculty initials that follow by a space, depending on how pdf-parse
// extracted this particular row. The suffix letter is treated as part
// of the course code UNLESS it's immediately followed by another
// uppercase letter — that pattern only happens when a multi-letter
// faculty name is glued directly onto the course code with no space
// (e.g. "CSE220MAHR"), in which case the first letter belongs to the
// faculty group, not the course.
const RECORD_RE = new RegExp(
  '^(\\d+)\\s*' +                                   // 1: SL
  '([A-Z]{2,4}\\d{3}(?:[A-Z](?![A-Z]))?)\\s*' +      // 2: course (+ optional attached suffix like L or A)
  '([A-Z,]*?)\\s*' +                                 // 3: faculty initials (may be empty)
  '(\\d{2}[A-Z]?(?:\\(\\w+\\))?)\\s*' +               // 4: section (e.g. 01, 01A, 17(PHR))
  '(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY)\\s*' + // 5: day
  '(\\d{1,2}:\\d{2}\\s*[AP]M)\\s*' +                  // 6: start time
  '(\\d{1,2}:\\d{2}\\s*[AP]M)\\s*' +                  // 7: end time
  '(.+)$'                                            // 8: room field (rest of line)
);

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const m = RECORD_RE.exec(trimmed);
  if (!m) return null;

  const [, slStr, course, facultyRaw, section, day, startRaw, endRaw, roomField] = m;
  const sl = parseInt(slStr, 10);
  if (Number.isNaN(sl)) return null;

  const faculty = facultyRaw ? facultyRaw.replace(/,$/, '') : null;
  const start = startRaw.replace(/\s+/g, '');
  const end = endRaw.replace(/\s+/g, '');

  const roomRaw = resolveRoomForDay(roomField.trim(), day);
  const roomInfo = parseRoomCode(roomRaw);

  return {
    sl, course, faculty, section, day, start, end,
    room_raw: roomRaw,
    building: roomInfo.building,
    room_no: roomInfo.room_no,
    room_type: roomInfo.type,
  };
}

/** Parses a full raw-text extract (multi-line string) into session rows. */
function parseSchedule(rawText) {
  const rows = [];
  const failed = [];
  for (const line of rawText.split('\n')) {
    const trimmed = line.trim();
    // Skip repeated page headers/footers that pdf-parse leaves in
    // (covers both the spaced and space-collapsed forms of these).
    if (/^BRAC\s*University$/i.test(trimmed)) continue;
    if (/^Class\s*Schedule\s*for/i.test(trimmed)) continue;
    if (/^SL\s*Course\s*Faculty/i.test(trimmed)) continue;
    const rec = parseLine(line);
    if (rec) rows.push(rec);
    else if (trimmed) failed.push(trimmed);
  }
  return { rows, failed };
}

module.exports = { parseSchedule, parseLine, parseRoomCode };
