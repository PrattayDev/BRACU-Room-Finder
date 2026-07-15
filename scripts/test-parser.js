const fs = require('fs');
const path = require('path');
const { parseSchedule } = require('../lib/parser');

const raw = fs.readFileSync(path.join(__dirname, '..', 'test-data', 'raw_schedule_sample.txt'), 'utf8');
const { rows, failed } = parseSchedule(raw);

console.log(`Parsed ${rows.length} rows, ${failed.length} failed`);
if (failed.length) failed.forEach(f => console.log('FAILED:', f));
console.log(JSON.stringify(rows.slice(0, 3), null, 2));

const buildings = [...new Set(rows.map(r => r.building).filter(Boolean))].sort();
console.log('Buildings:', buildings.join(', '));

if (failed.length > 0) process.exit(1);
console.log('OK: parser parity check passed');
