/**
 * scrape-cjenici.js
 * Scraper cjenika jela (i pića, gdje postoje) s web stranica restorana.
 * Output: api/_cjenici.js
 *
 * Stanje (studeni 2026.) — provjerene web stranice restorana s TZ popisa:
 *   ✅ Restoran Oroz      — restoran-oroz.hr/jelovnik (15 kategorija, cijene po stavci)
 *   ✅ Podroom Grill      — podroom-grill.com/ponuda/ (cijene + cijena na referentni datum)
 *   ❌ Hotel Savus        — gastro ponuda bez cijena (cjenik samo za smještaj)
 *   ❌ Grozd              — stranica bez jelovnika
 *   ❌ Eden (krcma-eden.com) — domena preusmjerava na nepovezanu (kockarsku) stranicu
 *   ❌ Onyx, Uno, Gurman  — domene više ne postoje (NXDOMAIN)
 *   ❌ Zdenac             — 404; Art hotel — prazna zadana stranica hostinga
 *   Karte pića: nijedna stranica ih ne objavljuje.
 *
 * Zaštita: ako neki izvor ne uspije (mreža, anti-bot, promijenjen HTML), zadržavaju
 * se njegovi ranije spremljeni podaci — nikad ne brišemo dobar cjenik praznim.
 */

import { writeFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

const OUT = 'api/_cjenici.js';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SlavBrodChatbotScraper/1.0; tourist-info-bot)',
  'Accept-Language': 'hr,en;q=0.8',
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  return res.text();
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€' };
function htmlToLines(html) {
  let s = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|td|span)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
  return s.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const price = s => parseFloat(s.match(/\d+(?:[.,]\d+)?/)[0].replace(',', '.'));

// ─── Restoran Oroz ──────────────────────────────────────────────────────────
const OROZ_BASE = 'https://www.restoran-oroz.hr';
const OROZ_CATS = {
  'dorucak': 'Doručak', 'predjela': 'Predjela', 'juhe': 'Juhe', 'dnevna-jela': 'Dnevna jela',
  'jela-sa-rostilja': 'Jela s roštilja', 'jela-po-narudzbi': 'Jela po narudžbi',
  'jela-od-ribe': 'Jela od ribe', 'plate': 'Plate', 'tjestenine-i-rizoto': 'Tjestenine i rižoto',
  'pizze': 'Pizze', 'salate-kao-glavno-jelo': 'Salate kao glavno jelo', 'salate-male': 'Male salate',
  'prilozi': 'Prilozi', 'dodaci-jelu': 'Dodaci jelu', 'deserti': 'Deserti',
};

function parseOrozItem(html) {
  const L = htmlToLines(html);
  // Naslov stavke slijedi nakon drugog pojavljivanja "Partyaner" (kraj navigacije)
  const marks = L.map((l, i) => l === 'Partyaner' ? i : -1).filter(i => i >= 0);
  if (marks.length < 2) return null;
  const blk = [];
  for (const l of L.slice(marks[1] + 1)) {
    if (/^(Označeno u|Srodni sadržaj|Više u ovoj)/.test(l)) break;
    blk.push(l);
  }
  if (!blk.length) return null;
  const it = { naziv: blk[0] };
  const opis = [], varijante = [];
  for (let j = 1; j < blk.length; j++) {
    const l = blk[j];
    if (l === 'Cijena:' && blk[j + 1]) { it.cijena = price(blk[++j]); continue; }
    const m = l.match(/^(.+?):\s*€\s*([\d.,]+)$/);
    if (m) varijante.push({ naziv: m[1].trim(), cijena: price(m[2]) });
    else opis.push(l);
  }
  if (opis.length) it.opis = opis.join(' ');
  if (varijante.length) it.varijante = varijante;
  return it.cijena != null || varijante.length ? it : null;
}

async function scrapeOroz() {
  const kategorije = [];
  for (const [slug, naziv] of Object.entries(OROZ_CATS)) {
    const html = await fetchHtml(`${OROZ_BASE}/jelovnik/${slug}`);
    const urls = [...new Set([...html.matchAll(new RegExp(`href="(/jelovnik/${slug}/item/[^"]+)"`, 'g'))].map(m => m[1]))];
    const stavke = [];
    for (const u of urls) {
      await sleep(300);
      try {
        const it = parseOrozItem(await fetchHtml(OROZ_BASE + u));
        if (it) stavke.push(it);
      } catch (e) { console.warn(`   Oroz ${u}: ${e.message}`); }
    }
    if (stavke.length) kategorije.push({ kategorija: naziv, stavke });
  }
  return kategorije;
}

// ─── Podroom Grill ──────────────────────────────────────────────────────────
const PODROOM_SECS = ['Doručak', 'Hladna predjela', 'Topla predjela', 'Juha', 'Specijaliteti leskovačkog roštilja',
  'Roštilj', 'Jela po narudžbi', 'American BBQ', 'Salate kao obrok', 'Prilozi', 'Izbor umaka', 'Salate',
  'Ribe i mekušci (samo petkom)', 'Desert', 'Pizze'];

async function scrapePodroom() {
  const L = htmlToLines(await fetchHtml('https://podroom-grill.com/ponuda/'));
  const nav = L.findIndex(l => l.startsWith('Doručak ') && l.includes('Pizze'));
  if (nav < 0) throw new Error('Podroom: nije pronađena navigacija ponude (promijenjen HTML?)');
  const isRef = l => /^\d{2}\.\d{2}\.\d{4}\.?:?$/.test(l);       // npr. "10.09.2026.:" (referentna cijena)
  const PR = /^([\d.,]+)\s*€$/;
  const VAR = /^(Mala|Srednja|Velika|Jumbo):\s*([\d.,]+)\s*€$/;
  const out = []; let cur = null, buf = [], refDatum = null;
  for (let k = nav + 1; k < L.length; k++) {
    const l = L[k];
    if (l.startsWith('Dostava putem')) break;
    if (PODROOM_SECS.includes(l)) { cur = { kategorija: l, stavke: [] }; out.push(cur); buf = []; continue; }
    if (isRef(l)) { refDatum ??= l.replace(/[.:]+$/, ''); continue; }
    if (!cur) continue;
    if (VAR.test(l) && buf.length) {
      const it = { naziv: buf[0], ...(buf.length > 1 && { opis: buf.slice(1).join(' ') }) };
      const vs = {};
      while (k < L.length && (VAR.test(L[k]) || isRef(L[k]))) {
        const m = L[k].match(VAR); if (m) vs[m[1]] ??= price(m[2]); k++;
      }
      k--;
      it.varijante = Object.entries(vs).map(([naziv, cijena]) => ({ naziv, cijena }));
      cur.stavke.push(it); buf = []; continue;
    }
    const m = l.match(PR);
    if (m && buf.length) {
      const it = { naziv: buf[0], ...(buf.length > 1 && { opis: buf.slice(1).join(' ') }), cijena: price(m[1]) };
      // Iza aktualne cijene slijedi "DD.MM.YYYY.:" + cijena na taj referentni datum
      if (isRef(L[k + 1] || '') && PR.test(L[k + 2] || '')) {
        refDatum ??= L[k + 1].replace(/[.:]+$/, '');
        const ref = price(L[k + 2]);
        if (ref !== it.cijena) it.cijena_referentna = ref;
        k += 2;
      }
      cur.stavke.push(it); buf = []; continue;
    }
    buf.push(l);
  }
  return { kategorije: out.filter(c => c.stavke.length), refDatum };
}

// ─── Glavni tok ─────────────────────────────────────────────────────────────
async function loadPrevious() {
  if (!existsSync(OUT)) return {};
  try { return (await import(pathToFileURL(resolve(OUT)).href + `?t=${Date.now()}`)).cjenici || {}; }
  catch { return {}; }
}

export async function main() {
  const prev = await loadPrevious();
  const datum = new Date().toISOString().slice(0, 10);
  const restorani = { ...(prev.restorani || {}) };

  const sources = [
    { key: 'Oroz', web: 'https://www.restoran-oroz.hr/jelovnik', run: async () => ({ kategorije: await scrapeOroz() }) },
    { key: 'Podroom Grill', web: 'https://podroom-grill.com/ponuda/', run: scrapePodroom },
  ];
  for (const s of sources) {
    try {
      const { kategorije, refDatum } = await s.run();
      const n = kategorije.reduce((a, c) => a + c.stavke.length, 0);
      if (n < 10) throw new Error(`premalo stavki (${n}) — vjerojatno promijenjen HTML`);
      restorani[s.key] = {
        izvor: s.web, preuzeto: datum, valuta: 'EUR',
        ...(refDatum && { napomena: `Uz aktualnu cijenu stranica navodi i cijenu na dan ${refDatum} (polje cijena_referentna, samo gdje se razlikuje).` }),
        kategorije,
      };
      console.log(`✅ ${s.key}: ${n} stavki`);
    } catch (e) {
      console.warn(`⚠️  ${s.key}: ${e.message} — zadržavam prethodne podatke${restorani[s.key] ? ` (${restorani[s.key].preuzeto})` : ' (nema ih)'}`);
    }
  }

  const cjenici = {
    napomena: 'Cijene preuzete s javnih web stranica restorana; mogu se promijeniti. Karte pića nisu objavljene online.',
    bez_online_cjenika: ['Eden (Krčma Eden)', 'Grozd', 'Savus (hotel restoran)', 'Onyx', 'Uno', 'Zrinski (Hotel Art)', 'Gurman', 'Zdenac'],
    restorani,
  };
  const output = `// AUTO-GENERATED by scripts/scrape-cjenici.js — ne uređuj ručno\n// Zadnje pokretanje: ${datum}\nexport const cjenici = ${JSON.stringify(cjenici, null, 1)};\n`;
  writeFileSync(OUT, output, 'utf8');
  console.log(`💾 ${OUT} spremljen`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
