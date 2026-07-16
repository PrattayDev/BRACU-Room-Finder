/**
 * Local-only sync using a real headless browser.
 *
 * Why this exists: bracu.ac.bd sits behind Cloudflare, and Cloudflare's
 * "Just a moment..." interstitial is a JavaScript challenge — it isn't
 * checking headers or IP ranges, it's checking whether the client can
 * actually run JS like a real browser. A plain server-side fetch()
 * (from Vercel OR from a home connection) can never pass that. This
 * script uses Puppeteer to drive real Chrome, which does pass it.
 *
 * This is meant to run on your own machine — see README.md for how to
 * schedule it (Windows Task Scheduler) so it runs automatically without
 * needing Vercel at all for the scraping step.
 *
 * Usage:
 *   cd local-sync
 *   npm install
 *   node sync-with-browser.js
 *
 * Requires the same SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars
 * as the rest of the project (set them before running, same as
 * scripts/run-sync-local.js did).
 */

const puppeteer = require('puppeteer');
const path = require('path');

const { resolveCurrentSemester } = require('../lib/semester');
const { extractPdfLink, extractPublishDate, scheduleUrl } = require('../lib/scraper');
const { parseSchedule } = require('../lib/parser');
const { getClient, ensureSemesterRow, replaceSemesterSessions, upsertSemesterMeta, getSemesterMeta } = require('../lib/db');

async function fetchWithBrowser(page, url, debugLabel) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  let title = await page.title();

  if (title.includes('Just a moment')) {
    console.log(`  (Cloudflare challenge detected, waiting for it to resolve...)`);
    // The challenge auto-solves and then navigates away — wait for that
    // actual navigation to finish, not just for the title to change,
    // since some Cloudflare setups swap content in-place via XHR rather
    // than a full page navigation.
    try {
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }),
        page.waitForFunction(() => !document.title.includes('Just a moment'), { timeout: 20000 }),
      ]);
    } catch (err) {
      console.log(`  (challenge wait timed out, proceeding with whatever loaded)`);
    }
    // Give the DOM a moment to finish settling either way.
    await new Promise(r => setTimeout(r, 2000));
    title = await page.title();
  }

  const status = res ? res.status() : null;
  const html = await page.content();

  if (debugLabel) {
    const fs = require('fs');
    const path = require('path');
    const debugPath = path.join(__dirname, `debug-${debugLabel}.html`);
    fs.writeFileSync(debugPath, html);
    console.log(`  (saved captured page to ${debugPath} for inspection)`);
  }

  console.log(`  final title: "${title}" | html length: ${html.length} chars`);
  return { html, status, title };
}

async function downloadPdfBuffer(page, pdfUrl) {
  // PDFs served from /sites/default/files/uploads/... are static assets
  // and typically aren't behind the same JS challenge as HTML pages,
  // so a plain fetch usually works here even though it doesn't for the
  // schedule page itself. If BRACU ever puts static files behind the
  // challenge too, this is the place to switch to a browser download.
  const res = await fetch(pdfUrl);
  if (!res.ok) throw new Error(`PDF download failed (HTTP ${res.status}) at ${pdfUrl}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.');
    process.exit(1);
  }

  const pdfParse = require('pdf-parse');
  const supabase = getClient();
  const { current, next, source } = await resolveCurrentSemester();
  console.log(`Semester detection: ${source}. Checking: ${current.code}, ${next.code}`);

  const browser = await puppeteer.launch({ headless: 'new' });
  const results = [];

  try {
    for (const sem of [current, next]) {
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      );
      try {
        const url = scheduleUrl(sem.code);
        console.log(`\n[${sem.code}] loading ${url} ...`);
        const { html, status } = await fetchWithBrowser(page, url, sem.code);

        if (status && status >= 400) {
          results.push({ semesterCode: sem.code, status: 'not_published', reason: `HTTP ${status}` });
          continue;
        }

        const pdfUrl = extractPdfLink(html);
        if (!pdfUrl) {
          // Don't just give up — scan for any ".pdf" occurrence at all
          // and print surrounding context, so we can see the real markup
          // BRACU is using without needing to manually open the debug file.
          const pdfMentions = [...html.matchAll(/.{60}\.pdf.{20}/gi)];
          if (pdfMentions.length) {
            console.log(`  found ${pdfMentions.length} ".pdf" mention(s) in the page that didn't match our link pattern:`);
            pdfMentions.slice(0, 5).forEach((m, i) => console.log(`    [${i}] ...${m[0]}...`));
          } else {
            console.log(`  no ".pdf" text found anywhere on the page at all.`);
          }
          results.push({ semesterCode: sem.code, status: 'not_published', reason: `No PDF link found — check debug-${sem.code}.html to see what was captured` });
          continue;
        }

        const existing = await getSemesterMeta(supabase, sem.code);
        if (existing && existing.pdf_url === pdfUrl) {
          results.push({ semesterCode: sem.code, status: 'unchanged', pdfUrl });
          continue;
        }

        console.log(`[${sem.code}] found PDF: ${pdfUrl}`);
        const publishedAt = extractPublishDate(html);

        console.log(`[${sem.code}] downloading PDF...`);
        const pdfBuffer = await downloadPdfBuffer(page, pdfUrl);

        console.log(`[${sem.code}] extracting text...`);
        const parsed = await pdfParse(pdfBuffer);

        const fs = require('fs');
        const path = require('path');
        const textDebugPath = path.join(__dirname, `debug-${sem.code}-pdftext.txt`);
        fs.writeFileSync(textDebugPath, parsed.text);
        console.log(`[${sem.code}] extracted ${parsed.text.length} chars of text, saved to ${textDebugPath}`);
        console.log(`[${sem.code}] first 400 chars: ${JSON.stringify(parsed.text.slice(0, 400))}`);

        console.log(`[${sem.code}] parsing sessions...`);
        const { rows, failed } = parseSchedule(parsed.text);

        if (rows.length === 0) {
          console.log(`[${sem.code}] sample of failed lines (showing raw whitespace):`);
          failed.slice(0, 5).forEach((line, i) => console.log(`  [${i}] ${JSON.stringify(line)}`));
          results.push({ semesterCode: sem.code, status: 'parse_failed', failedLineCount: failed.length });
          continue;
        }

        console.log(`[${sem.code}] writing ${rows.length} sessions to Supabase...`);
        await ensureSemesterRow(supabase, sem.code);
        const inserted = await replaceSemesterSessions(supabase, sem.code, rows);
        await upsertSemesterMeta(supabase, {
          semesterCode: sem.code, pdfUrl, publishedAt, sessionCount: inserted, failedLines: failed.length,
        });

        results.push({
          semesterCode: sem.code,
          status: existing ? 'updated' : 'created',
          sessionCount: inserted,
          failedLineCount: failed.length,
          pdfUrl,
        });
      } catch (err) {
        results.push({ semesterCode: sem.code, status: 'error', message: err.message });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log('\n=== Sync results ===');
  console.log(JSON.stringify({ ok: true, checked: [current.code, next.code], results, ranAt: new Date().toISOString() }, null, 2));
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
