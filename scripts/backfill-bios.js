#!/usr/bin/env node
/**
 * Backfill Producer Bios
 *
 * Usage:
 *   1. Run fetchProducerBios() in Google Apps Script editor
 *   2. Copy the JSON from the _ProducerBios tab (or Logs)
 *   3. Save it as scripts/producer-bios.json
 *   4. Run: node scripts/backfill-bios.js
 *
 * This will update the "about" fields in the-source-portfolio.html
 */

const fs = require('fs');
const path = require('path');

const PORTFOLIO_PATH = path.join(__dirname, '..', 'the-source-portfolio.html');
const BIOS_PATH = path.join(__dirname, 'producer-bios.json');

if (!fs.existsSync(BIOS_PATH)) {
  console.error('Missing producer-bios.json — see instructions at top of this file.');
  process.exit(1);
}

const bios = JSON.parse(fs.readFileSync(BIOS_PATH, 'utf8'));
console.log('Loaded', Object.keys(bios).length, 'producer bios');

let html = fs.readFileSync(PORTFOLIO_PATH, 'utf8');

// Find the DATA array
const startMarker = 'const DATA = [';
const startIdx = html.indexOf(startMarker);
if (startIdx === -1) { console.error('Could not find DATA array'); process.exit(1); }

const dataStart = startIdx + startMarker.length - 1;
let endIdx = html.indexOf('];\n', dataStart);
if (endIdx === -1) endIdx = html.indexOf('];', dataStart);
if (endIdx === -1) { console.error('Could not find end of DATA array'); process.exit(1); }

const jsonStr = html.substring(dataStart, endIdx + 1);
const data = JSON.parse(jsonStr);

// Patch producer about fields
let updated = 0;
let skipped = 0;
let notFound = [];

data.forEach(function(warehouse) {
  warehouse.countries.forEach(function(country) {
    country.producers.forEach(function(producer) {
      const name = producer.name;

      // Try exact match first
      let bio = bios[name];

      // Try fuzzy match if not found
      if (!bio) {
        const lowerName = name.toLowerCase();
        for (const [key, val] of Object.entries(bios)) {
          if (key.toLowerCase() === lowerName) { bio = val; break; }
          // Also try if portfolio name is a substring (e.g. "Bergeron" matches "Domaine Bergeron")
          if (key.toLowerCase().includes(lowerName) || lowerName.includes(key.toLowerCase())) {
            bio = val;
            break;
          }
        }
      }

      if (bio && bio.trim()) {
        if (!producer.about || !producer.about.trim()) {
          producer.about = bio;
          updated++;
          console.log('  ✓ Filled:', name);
        } else {
          skipped++;
        }
      } else {
        if (!producer.about || !producer.about.trim()) {
          notFound.push(name);
        }
      }
    });
  });
});

// Write back
const newJson = JSON.stringify(data);
const newHtml = html.substring(0, dataStart) + newJson + html.substring(endIdx + 1);
fs.writeFileSync(PORTFOLIO_PATH, newHtml, 'utf8');

console.log('\nDone!');
console.log('  Updated:', updated, 'producers');
console.log('  Already had bio:', skipped, 'producers');
if (notFound.length > 0) {
  console.log('  Not found in Vinosmith (' + notFound.length + '):');
  notFound.forEach(function(n) { console.log('    -', n); });
}
