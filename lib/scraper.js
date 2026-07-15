/**
 * Fetches BRAC University's published Class Schedule for a given
 * semester (e.g. "summer-2026") and returns the raw PDF text plus
 * metadata about the PDF itself (URL, publish date) so callers can
 * detect when it changes.
 *
 * There is no API — this walks the same path a student would:
 *   1. GET https://www.bracu.ac.bd/class-schedule-{semester}
 *   2. Find the PDF link on that page
 *   3. Download and text-extract the PDF
 */

const pdfParse = require('pdf-parse');

const USER_AGENT = 'BRACURoomFinderBot/1.0 (+https://github.com/yourname/bracu-room-finder)';

function scheduleUrl(semesterCode) {
  // semesterCode like "summer-2026" -> matches BRACU's own URL pattern
  return `https://www.bracu.ac.bd/class-schedule-${semesterCode}`;
}

async function fetchSchedulePageHtml(semesterCode) {
  const url = scheduleUrl(semesterCode);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Schedule page not found for ${semesterCode} (HTTP ${res.status}) at ${url}`);
  }
  return { html: await res.text(), pageUrl: url };
}

function extractPdfLink(html) {
  // BRACU links the PDF as an absolute /sites/default/files/uploads/... path.
  const m = /href="(https:\/\/www\.bracu\.ac\.bd\/sites\/default\/files\/uploads\/[^"]+\.pdf)"/i.exec(html)
    || /href="(\/sites\/default\/files\/uploads\/[^"]+\.pdf)"/i.exec(html);
  if (!m) return null;
  const href = m[1];
  return href.startsWith('http') ? href : `https://www.bracu.ac.bd${href}`;
}

function extractPublishDate(html) {
  // BRACU shows "Publish Date: <weekday>, <Month> <day>, <year> - <time>"
  const m = /Publish Date:\s*([A-Za-z]+,\s*[A-Za-z]+\s+\d{1,2},\s*\d{4})/i.exec(html);
  if (!m) return null;
  const d = new Date(m[1]);
  return isNaN(d) ? null : d.toISOString();
}

async function downloadPdfText(pdfUrl) {
  const res = await fetch(pdfUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Failed to download PDF (HTTP ${res.status}) at ${pdfUrl}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const parsed = await pdfParse(buffer);
  return parsed.text;
}

/**
 * Full pipeline for one semester. Returns null (not throws) if the
 * page for that semester doesn't exist yet — that's the normal case
 * for a future semester whose schedule hasn't been published.
 */
async function fetchSemesterSchedule(semesterCode) {
  let html, pageUrl;
  try {
    ({ html, pageUrl } = await fetchSchedulePageHtml(semesterCode));
  } catch (err) {
    return { available: false, reason: err.message };
  }

  const pdfUrl = extractPdfLink(html);
  if (!pdfUrl) {
    return { available: false, reason: 'Page exists but no PDF link found — layout may have changed.' };
  }

  const publishedAt = extractPublishDate(html);
  const text = await downloadPdfText(pdfUrl);

  return {
    available: true,
    semesterCode,
    pageUrl,
    pdfUrl,
    publishedAt,
    rawText: text,
  };
}

module.exports = { fetchSemesterSchedule, scheduleUrl, extractPdfLink, extractPublishDate };
