/**
 * scrape-brod.js
 * Scraper za slavonski-brod.hr (RSS) i tzgsb.hr (manifestacije po mjesecima)
 * Output: api/_scraped_content.js
 *
 * Što se skrapa:
 *   - Vijesti s Grada Slavonski Brod (RSS: slavonski-brod.hr/vijesti?format=feed&type=rss)
 *   - Manifestacije s TZ web stranica (tzgsb.hr po mjesecima: sijecanj, ozujak, travanj...)
 */

import { writeFileSync, readFileSync } from 'fs';

const HEADERS = {
  'User-Agent': 'SlavBrodChatbotScraper/1.0 (tourist-info-bot)',
  'Accept-Language': 'hr,en;q=0.8',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.warn(`⚠️  Nije moguće dohvatiti ${url}: ${e.message}`);
    return null;
  }
}

// ─── Vijesti s Grada (Joomla RSS) ──────────────────────────────────────────

async function scrapeVijesti() {
  const xml = await fetchHtml('https://www.slavonski-brod.hr/vijesti?format=feed&type=rss');
  if (!xml) return [];

  const items = [];
  const entries = xml.split('<item>').slice(1);
  const skipWords = /natječaj|javna nabava|zakon|pravilnik|javni poziv za dostav|natječaj za zakup|javni natječ/i;

  for (const entry of entries.slice(0, 15)) {
    const titleRaw = (
      entry.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/) ||
      entry.match(/<title>([^<]+)<\/title>/)
    )?.[1]?.trim() || '';
    const link   = entry.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() || '';
    const dateRaw = entry.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1]?.trim() || '';
    const descRaw = (
      entry.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
      entry.match(/<description>([^<]+)<\/description>/)
    )?.[1] || '';

    if (!titleRaw || skipWords.test(titleRaw)) continue;

    // Izvuci tekst opisa (bez HTML tagova)
    const descText = descRaw
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\{gallery[^}]*\}/g, '')
      .trim()
      .substring(0, 300);

    // Izvuci prvu sliku iz opisa
    const imgMatch = descRaw.match(/<img[^>]+src="([^"]+)"/i);
    const imgUrl = imgMatch?.[1] || '';

    // Formatiraj datum
    const d = new Date(dateRaw);
    const dateFormatted = isNaN(d) ? dateRaw.substring(0, 16) :
      d.toLocaleDateString('hr-HR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    items.push({
      naslov: titleRaw.substring(0, 120),
      datum: dateFormatted,
      kratki_opis: descText,
      link,
      IMAGE_URL: imgUrl,
    });
  }

  console.log(`✅ Vijesti Grad: ${items.length} stavki`);
  return items;
}

// ─── Manifestacije s TZ (po mjesecima) ─────────────────────────────────────

const MONTH_SLUGS = {
  1:  'sijecanj',
  2:  'veljaca',
  3:  'ozujak',
  4:  'travanj',
  5:  'svibanj',
  6:  'lipanj',
  7:  'srpanj',
  8:  'kolovoz',
  9:  'rujan',
  10: 'listopad',
  11: 'studeni',
  12: 'prosinac',
};

const MONTH_HR = {
  1:'Siječanj', 2:'Veljača', 3:'Ožujak', 4:'Travanj', 5:'Svibanj', 6:'Lipanj',
  7:'Srpanj', 8:'Kolovoz', 9:'Rujan', 10:'Listopad', 11:'Studeni', 12:'Prosinac',
};

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMonthContent(html, monthNum) {
  const text = stripHtml(html);
  const monthName = MONTH_HR[monthNum];
  const footerMarker = '© Copyright Tourist Board';

  // TZ stranica sadrži linkove na SLJEDEĆE mjesece na vrhu, a zatim "Gradski vodič..." marker
  // iza kojeg slijedi ime TRENUTNOG mjeseca i eventi.
  // Marker koji odvaja navigaciju od sadržaja:
  const contentMarker = 'Gradski vodič';
  let start = text.indexOf(contentMarker);
  if (start < 0) {
    // Fallback: nađi drugi pojav naziva mjeseca (prvi je u navigaciji)
    let pos = text.indexOf(monthName);
    if (pos >= 0) pos = text.indexOf(monthName, pos + monthName.length);
    start = pos >= 0 ? pos : 0;
  } else {
    // Preskočimo "Gradski vodič..." pa nađemo naziv tog mjeseca
    const afterMarker = text.indexOf(monthName, start);
    start = afterMarker >= 0 ? afterMarker + monthName.length : start + contentMarker.length;
  }

  const end = text.indexOf(footerMarker);
  const raw = (end > start ? text.substring(start, end) : text.substring(start, start + 3000)).trim();

  // Čišćenje: ukloni kontaktne podatke, gallery, www, e-mail
  const cleaned = raw
    .replace(/Galerija\s+[\s\S]{0,200}?(?=\n|$)/g, '')
    .replace(/\+385\s*\d[\d\s\-\/]+/g, '')
    .replace(/www\.\S+/g, '')
    .replace(/[\w.+-]+@[\w-]+\.[a-z]{2,}/g, '')
    .replace(/Radnički trg[\s\S]{0,100}?(?=\d{5})/g, '')
    .replace(/\b\d{5}\s+Slavonski Brod\b/g, '')
    .replace(/\s{3,}/g, '  ')
    .trim();

  if (!cleaned || cleaned.length < 20) return [];

  // Razdvoji na blokove po dvostrukim razmacima
  const blocks = cleaned.split(/\s{2,}/).map(b => b.trim()).filter(b => b.length > 15);

  const manifestacije = [];
  let i = 0;
  while (i < blocks.length && manifestacije.length < 5) {
    const block = blocks[i];

    // Preskočimo kontaktne/adresne blokove
    const isContact = /^Adresa:|^Telefon:|^E-mail:|^\+385|^www\.|^Tel:/.test(block);
    // Preskočimo navigacijske blokove (samo nazivi mjesta/mjeseci)
    const isNavOnly = /^[A-ZČŠŽĆĐ][a-zčšžćđ]+(\s+[A-ZČŠŽĆĐ][a-zčšžćđ]+)*$/.test(block) && block.split(' ').length <= 3;

    if (!isContact && !isNavOnly && block.length > 20) {
      // Naziv: uzimamo sve dok ne naletimo na duži opisni tekst
      // Tražimo prvu točku koja NIJE dio kratice (prethodne slovo je malo)
      let nazBound = -1;
      for (let j = 10; j < Math.min(block.length, 120); j++) {
        if (block[j] === '.' && block[j-1] && /[a-zčšžćđ]/.test(block[j-1]) && block[j+1] === ' ') {
          nazBound = j;
          break;
        }
      }
      const naziv = nazBound > 10
        ? block.substring(0, nazBound).trim()
        : block.substring(0, 100).trim();

      // Opis: ostatak bloka + eventualno sljedeći blok, bez kontakt info
      const rest = block.substring(naziv.length).replace(/^[.\s]+/, '');
      const nextBlock = (blocks[i+1] && !blocks[i+1].startsWith('Adresa') && !blocks[i+1].startsWith('+385'))
        ? ' ' + blocks[i+1] : '';
      const opis = (rest + nextBlock)
        .replace(/Galerija[\s\S]{0,50}/, '')
        .substring(0, 300)
        .trim();

      if (naziv.length > 8 && /[a-zčšžćđ]/.test(naziv)) {
        manifestacije.push({
          naziv: naziv.substring(0, 100),
          datum: monthName,
          opis: opis || naziv,
          link: `https://www.tzgsb.hr/index.php?page=${MONTH_SLUGS[monthNum]}`,
        });
        if (nextBlock) i++; // preskočimo opis blok
      }
    }
    i++;
  }

  return manifestacije;
}

async function scrapeManifestacije() {
  const now = new Date();
  const thisMonth = now.getMonth() + 1;
  // Skrapaj ovaj i sljedeća 3 mjeseca (ciklički)
  const monthsToFetch = [0, 1, 2, 3].map(offset => ((thisMonth - 1 + offset) % 12) + 1);

  const allEvents = [];
  const seen = new Set();

  for (const monthNum of monthsToFetch) {
    const slug = MONTH_SLUGS[monthNum];
    const url = `https://www.tzgsb.hr/index.php?page=${slug}`;
    const html = await fetchHtml(url);
    if (!html) continue;

    const events = extractMonthContent(html, monthNum);
    for (const ev of events) {
      if (!seen.has(ev.naziv)) {
        seen.add(ev.naziv);
        allEvents.push(ev);
      }
    }
    console.log(`  📅 ${MONTH_HR[monthNum]}: ${events.length} manifestacija`);
  }

  console.log(`✅ Manifestacije TZ: ${allEvents.length} stavki`);
  return allEvents;
}

// ─── Restorani i smještaj s TZ ──────────────────────────────────────────────

async function scrapeSmjestajSummary() {
  const html = await fetchHtml('https://www.tzgsb.hr/index.php?page=smjestaj');
  if (!html) return null;

  const text = stripHtml(html);
  const start = text.indexOf('Smještaj');
  const end = text.indexOf('© Copyright');
  if (start < 0) return null;

  const chunk = (end > start ? text.substring(start, end) : text.substring(start, start + 2000))
    .trim()
    .substring(0, 800);

  return chunk || null;
}

// ─── Zapis rezultata ─────────────────────────────────────────────────────────

function writeOutput(data) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const output = `// AUTO-GENERATED — ne editiraj ručno!
// Zadnje skrapanje: ${ts} UTC
// Izvor: slavonski-brod.hr (RSS vijesti), tzgsb.hr (manifestacije po mjesecima)
// GitHub Actions job: scrape-brod (tjedno, ponedjeljkom u 06:00 UTC)

export const scrapedContent = ${JSON.stringify(data, null, 2)};
`;
  writeFileSync('api/_scraped_content.js', output, 'utf8');
  console.log('✅ Zapisano: api/_scraped_content.js');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Pokrećem scraping za Slavonski Brod...\n');

  const [vijesti, manifestacije, smjestajTekst] = await Promise.all([
    scrapeVijesti(),
    scrapeManifestacije(),
    scrapeSmjestajSummary(),
  ]);

  const data = {
    meta: {
      zadnje_azuriranje: new Date().toISOString(),
      izvori: [
        'https://www.slavonski-brod.hr/vijesti?format=feed&type=rss',
        'https://www.tzgsb.hr/index.php?page=manifestacije',
      ],
    },
    novosti_grad: vijesti,
    manifestacije_aktualne: manifestacije,
    smjestaj_tz_info: smjestajTekst,
  };

  const total = vijesti.length + manifestacije.length;

  if (total === 0) {
    console.warn('⚠️  Nije dohvaćen nikakav sadržaj. Provjeri dostupnost web stranica.');
    process.exit(0);
  }

  writeOutput(data);
  console.log(`\n✅ Ukupno: ${total} stavki skrapano i zapisano.`);
  console.log('  📰 Vijesti:', vijesti.length);
  console.log('  📅 Manifestacije:', manifestacije.length);
}

main().catch(err => {
  console.error('❌ Scraping neuspješan:', err);
  process.exit(1);
});
