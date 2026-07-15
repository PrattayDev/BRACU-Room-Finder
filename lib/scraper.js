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

// bracu.ac.bd runs bot-protection that 403s requests identifying as a
// bot (which the old User-Agent literally did). We're not hiding what
// this is — the schedule PDF is public, no auth, no ToS violation —
// but the request needs to look like an ordinary browser visit or
// their firewall blocks it before our code ever runs.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function scheduleUrl(semesterCode) {
  // semesterCode like "summer-2026" -> matches BRACU's own URL pattern
  return `https://www.bracu.ac.bd/class-schedule-${semesterCode}`;
}

async function fetchSchedulePageHtml(semesterCode) {
  const url = scheduleUrl(semesterCode);
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) {
    let bodySnippet = '';
    try { bodySnippet = (await res.text()).slice(0, 300).replace(/\s+/g, ' '); } catch (e) { /* ignore */ }
    const server = res.headers.get('server') || 'unknown';
    const cfRay = res.headers.get('cf-ray');
    throw new Error(
      `Schedule page not found for ${semesterCode} (HTTP ${res.status}) at ${url} | ` +
      `server=${server}${cfRay ? ' cf-ray=' + cfRay : ''} | bodyStart="${bodySnippet}"`
    );
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
  const res = await fetch(pdfUrl, { headers: BROWSER_HEADERS });
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
