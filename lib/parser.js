/**
 * Parses BRAC University's Class Schedule PDF text (as extracted by
 * pdf-parse) into structured session rows. This is a direct port of
 * the tokenizer that was validated against real Summer 2026 rows —
 * see /scripts/test-parser.js to re-run that check.
 */

const DAYS = new Set(['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY']);
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

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const toks = trimmed.split(/\s+/);
  if (toks.length < 7) return null;

  const sl = parseInt(toks[0], 10);
  if (Number.isNaN(sl)) return null;
  const course = toks[1];

  let dayIdx = -1;
  for (let i = 0; i < toks.length; i++) {
    if (DAYS.has(toks[i].toUpperCase())) { dayIdx = i; break; }
  }
  if (dayIdx === -1) return null;

  let between = toks.slice(2, dayIdx);
  if (!between.length) return null;

  let sectionTag = '';
  if (between.length && between[between.length - 1].startsWith('(') && between[between.length - 1].endsWith(')')) {
    sectionTag = ' ' + between[between.length - 1];
    between = between.slice(0, -1);
  }
  if (!between.length) return null;

  const section = between[between.length - 1] + sectionTag;
  const facultyTokens = between.slice(0, -1);
  const faculty = facultyTokens.length ? facultyTokens.join(' ') : null;

  const rest = toks.slice(dayIdx + 1);
  if (rest.length < 5) return null;

  const start = rest[0] + rest[1];
  const end = rest[2] + rest[3];
  const roomField = rest.slice(4).join(' ');
  const day = toks[dayIdx].toUpperCase();

  const roomRaw = resolveRoomForDay(roomField, day);
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
    // Skip repeated page headers/footers that pdf-parse leaves in.
    if (/^BRAC University$/i.test(line.trim())) continue;
    if (/^Class Schedule for/i.test(line.trim())) continue;
    if (/^SL\s+Course\s+Faculty/i.test(line.trim())) continue;
    const rec = parseLine(line);
    if (rec) rows.push(rec);
    else if (line.trim()) failed.push(line.trim());
  }
  return { rows, failed };
}

module.exports = { parseSchedule, parseLine, parseRoomCode };
