/**
 * scrape-hoteli.js
 * Scraper web stranica hotela/hostela/pansiona: cjenici, sobe, sadržaji, gastro,
 * wellness, dvorane, kontakti, uvjeti boravka.
 * Output: api/_hoteli.js
 *
 * Stanje (studeni 2026.):
 *   ✅ Hotel Savus, Hotel Art, Hotel Central, Smart Hostel, Hotel Garten,
 *      Pansion Antonio (cjenik još u kunama — označeno kao zastarjelo)
 *   ❌ Hotel Park (hotelparksb.hr) — stranica u održavanju ("coming soon")
 *   ❌ Hostel Levicki (hostel-levicki.hr) — domena ne postoji
 *   ❌ Prenoćište Magnus (prenociste-magnus.com) — prazna zadana stranica hostinga
 *
 * Responzivne stranice (npr. Hotel Art) imaju zasebne blokove za računalo i mobitel
 * (klase x-hide-*). Tekst se čita u "računalnoj" verziji; ako mobilna verzija ima
 * DRUGAČIJE cijene, to se bilježi u napomenama (stranica sama sebi proturječi).
 *
 * Zaštita: ako hotel ne uspije (mreža, promjena HTML-a), zadržavaju se njegovi
 * prethodno spremljeni podaci.
 */

import { writeFileSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolve } from 'path';
import { parse } from 'node-html-parser';

const OUT = 'api/_hoteli.js';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SlavBrodChatbotScraper/1.0; tourist-info-bot)',
  'Accept-Language': 'hr,en;q=0.8',
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_PAGE_CHARS = 5000;

// naziv mora odgovarati nazivu u smještaju (scrapedContent.smjestaj_hoteli / db.smjestaj)
const HOTELI = [
  { naziv: 'Hotel Savus', kljucevi: ['savus'], web: 'https://savus-hotel.com', stranice: [
    ['cjenik', 'https://savus-hotel.com/ponuda-cjenik/'],
    ['smještaj', 'https://savus-hotel.com/smjestaj/'],
    ['gastro', 'https://savus-hotel.com/gastro-ponuda/'],
    ['kavana', 'https://savus-hotel.com/kavana-s-pripadajucom-terasom/'],
    ['konferencijska sala', 'https://savus-hotel.com/konferencijska-sala/'],
    ['eko-etno salaš Savus', 'https://savus-hotel.com/eko-etno-salas-savus/'],
    ['turistička agencija', 'https://savus-hotel.com/turisticka-agencija-savus/'],
    ['kontakt', 'https://savus-hotel.com/kontakt-informacije/'],
  ] },
  { naziv: 'Hotel Art', kljucevi: ['hotel art', 'art hotel', 'hotelu art', 'hotela art', 'hotelom art', 'zrinski', 'vidikovac'], web: 'https://www.art-hotel.eu', stranice: [
    ['cjenik i sobe', 'https://www.art-hotel.eu/cjenik-smjestaj/'],
    ['o hotelu', 'https://www.art-hotel.eu/'],
    ['sadržaji', 'https://www.art-hotel.eu/sadrzaji/'],
    ['gastro', 'https://www.art-hotel.eu/gastro-ponuda/'],
    ['konferencijska sala', 'https://www.art-hotel.eu/konferencijska-sala/'],
    ['kontakt', 'https://www.art-hotel.eu/kontakt/'],
  ] },
  { naziv: 'Hotel Central', kljucevi: ['hotel central', 'hotelu central', 'hotela central', 'central hotel', 'hotelcentral'], web: 'https://www.hotelcentralsb.hr', stranice: [
    ['cjenik', 'https://www.hotelcentralsb.hr/cjenik/'],
    ['o hotelu', 'https://www.hotelcentralsb.hr/'],
    ['sobe', 'https://www.hotelcentralsb.hr/sobe/'],
    ['dvokrevetna soba', 'https://www.hotelcentralsb.hr/room/dvokrevetna-soba/'],
    ['deluxe soba', 'https://www.hotelcentralsb.hr/room/deluxe-soba/'],
    ['apartman', 'https://www.hotelcentralsb.hr/room/apartman/'],
    ['sadržaji', 'https://www.hotelcentralsb.hr/sadrzaji/'],
    ['posebne ponude', 'https://www.hotelcentralsb.hr/posebne-ponude/'],
    ['lokacija', 'https://www.hotelcentralsb.hr/lokacija/'],
    ['kontakt', 'https://www.hotelcentralsb.hr/kontakt/'],
  ] },
  { naziv: 'Smart Hostel', kljucevi: ['smart hostel', 'smart hostelu', 'smart hostela', 'smarthostel'], web: 'https://www.smarthostel.hr', stranice: [
    ['cjenik i sobe', 'https://www.smarthostel.hr/'],
    ['dvokrevetna soba', 'https://www.smarthostel.hr/room/dvokrevetna/'],
    ['trokrevetna soba', 'https://www.smarthostel.hr/room/trokrevetna/'],
    ['peterokrevetna soba', 'https://www.smarthostel.hr/room/peterokrevetna/'],
    ['svečana dvorana', 'https://www.smarthostel.hr/svecana-dvorana-slavonski-brod/'],
  ] },
  { naziv: 'Hotel Garten', kljucevi: ['garten'], web: 'https://www.garten.hr', stranice: [
    ['o hotelu', 'https://www.garten.hr/hotel.html'],
    ['sobe', 'https://www.garten.hr/sobe.html'],
    ['klasične sobe', 'https://www.garten.hr/klasicne-sobe.html'],
    ['delux sobe', 'https://www.garten.hr/delux-sobe.html'],
    ['restoran', 'https://www.garten.hr/restoran.html'],
    ['team building i wellness (cjenik)', 'https://www.garten.hr/team-building-i-wellness.html'],
    ['uvjeti i pravila', 'https://www.garten.hr/uvjeti-pravila.html'],
    ['lokacija', 'https://www.garten.hr/lokacija.html'],
  ] },
  { naziv: 'Pansion Antonio', kljucevi: ['antonio'], web: 'http://www.pansion-antonio.hr', stranice: [
    ['cjenik i ponuda', 'http://www.pansion-antonio.hr/ponuda.asp'],
    ['o pansionu', 'http://www.pansion-antonio.hr/default.asp'],
    ['rezervacije', 'http://www.pansion-antonio.hr/rezervacije.asp'],
  ] },
];

const NEDOSTUPNI = [
  { naziv: 'Hotel Park', web: 'https://www.hotelparksb.hr', razlog: 'stranica u održavanju' },
  { naziv: 'Hostel Levicki', web: 'https://hostel-levicki.hr', razlog: 'domena ne postoji' },
  { naziv: 'Prenoćište Magnus', web: 'https://www.prenociste-magnus.com', razlog: 'prazna stranica' },
];

async function fetchHtml(url, pokusaj = 1) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (pokusaj < 2) { await sleep(2000); return fetchHtml(url, pokusaj + 1); }
    throw e;
  }
}

const BLOCK_TAGS = new Set(['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'section', 'article', 'br', 'table', 'ul', 'ol', 'span', 'a', 'strong', 'b']);
function nodeText(node) {
  let out = '';
  const walk = n => {
    if (n.nodeType === 3) { out += n.text; return; }
    if (n.nodeType !== 1) return;
    const tag = n.rawTagName?.toLowerCase();
    n.childNodes.forEach(walk);
    if (BLOCK_TAGS.has(tag)) out += '\n';
  };
  walk(node);
  return out.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const MOBILE_ONLY = '[class*="x-hide-lg"][class*="x-hide-md"], .visible-xs, .d-md-none, .hidden-md';
function extract(html) {
  const root = parse(html, { comment: false });
  root.querySelectorAll('script, style, noscript, iframe, svg, form, nav, header, footer, select, button, .cookie, #cmplz-cookiebanner-container, .cmplz-cookiebanner').forEach(n => n.remove());
  const mobile = root.querySelectorAll(MOBILE_ONLY);
  const mobileLines = mobile.flatMap(nodeText);
  mobile.forEach(n => n.remove());
  const body = root.querySelector('body') || root;
  return { lines: nodeText(body), mobileLines };
}

const PRICE_RE = /\d+(?:[.,]\d{2})\s*(?:€|EUR|kn)\b|€\s*\d/i;

async function scrapeHotel(h) {
  const pages = [];
  const napomene = [];
  for (const [tema, url] of h.stranice) {
    try {
      const { lines, mobileLines } = extract(await fetchHtml(url));
      pages.push({ tema, url, lines });
      const desk = new Set(lines.filter(l => PRICE_RE.test(l)));
      const mob = [...new Set(mobileLines.filter(l => PRICE_RE.test(l)))];
      const razlika = mob.filter(l => !desk.has(l));
      if (razlika.length) napomene.push(`Stranica "${tema}" (${url}) u mobilnoj verziji prikazuje DRUGAČIJE cijene od računalne verzije: ${razlika.slice(0, 12).join('; ')}. Gostu navedi cijene iz računalne verzije (tekst niže), spomeni da web stranica hotela na mobitelu prikazuje drugačije iznose i preporuči da cijenu potvrdi s hotelom.`);
    } catch (e) {
      console.warn(`   ${h.naziv} — ${tema}: ${e.message}`);
    }
    await sleep(300);
  }
  if (!pages.length) throw new Error('nijedna stranica nije dohvaćena');

  // Boilerplate (izbornik, podnožje, kolačići): retci koji se ponavljaju na više stranica istog hotela
  const count = new Map();
  pages.forEach(p => new Set(p.lines).forEach(l => count.set(l, (count.get(l) || 0) + 1)));
  const prag = Math.max(2, Math.ceil(pages.length / 2));
  const stranice = pages.map((p, i) => {
    // Duplikati unutar stranice NE brišu se (ista cijena / "2 osobe" smiju se ponoviti u
    // tablicama), samo uzastopni identični retci.
    const lines = p.lines.filter((l, j, arr) => {
      if (j > 0 && arr[j - 1] === l) return false;
      if (PRICE_RE.test(l)) return true;                   // cijene uvijek zadrži
      if (l.length < 3) return false;
      return i === 0 ? count.get(l) < pages.length || pages.length === 1 : count.get(l) < prag;
    });
    let tekst = lines.join('\n');
    if (tekst.length > MAX_PAGE_CHARS) tekst = tekst.slice(0, MAX_PAGE_CHARS) + '\n…';
    return { tema: p.tema, url: p.url, tekst };
  }).filter(s => s.tekst.length > 40);

  if (stranice.some(s => /\d+[.,]\d{2}\s*kn\b/i.test(s.tekst)) && !stranice.some(s => /\d+[.,]\d{2}\s*(€|EUR)/i.test(s.tekst)))
    napomene.push('Cjenik na web stranici je još u KUNAMA (prije uvođenja eura 2023.) — zastario je. NE preračunavaj i ne navodi te cijene kao aktualne; reci da je cjenik na webu zastario i uputi gosta da cijenu provjeri izravno kod objekta.');

  return { web: h.web, kljucevi: h.kljucevi, preuzeto: new Date().toISOString().slice(0, 10), ...(napomene.length && { napomene }), stranice };
}

async function loadPrevious() {
  if (!existsSync(OUT)) return {};
  try { return (await import(pathToFileURL(resolve(OUT)).href + `?t=${Date.now()}`)).hoteliWeb || {}; }
  catch { return {}; }
}

export async function main() {
  const prev = await loadPrevious();
  const hoteli = { ...(prev.hoteli || {}) };
  for (const h of HOTELI) {
    try {
      hoteli[h.naziv] = await scrapeHotel(h);
      const z = hoteli[h.naziv].stranice.reduce((a, s) => a + s.tekst.length, 0);
      console.log(`✅ ${h.naziv}: ${hoteli[h.naziv].stranice.length} stranica, ${z} znakova${hoteli[h.naziv].napomene ? ` | ⚠️ ${hoteli[h.naziv].napomene.length} napomena` : ''}`);
    } catch (e) {
      console.warn(`⚠️  ${h.naziv}: ${e.message} — zadržavam prethodne podatke${hoteli[h.naziv] ? ` (${hoteli[h.naziv].preuzeto})` : ' (nema ih)'}`);
    }
  }
  const hoteliWeb = { izvor: 'Službene web stranice smještajnih objekata', nedostupni: NEDOSTUPNI, hoteli };
  const datum = new Date().toISOString().slice(0, 10);
  writeFileSync(OUT, `// AUTO-GENERATED by scripts/scrape-hoteli.js — ne uređuj ručno\n// Zadnje pokretanje: ${datum}\nexport const hoteliWeb = ${JSON.stringify(hoteliWeb, null, 1)};\n`, 'utf8');
  console.log(`💾 ${OUT} spremljen`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
