/**
 * scrape-brod.js
 * Scraper za slavonski-brod.hr (RSS) i tzgsb.hr (JSON + HTML)
 * Output: api/_scraped_content.js
 *
 * Što se skrapa:
 *   - Vijesti s Grada Slavonski Brod (RSS feed)
 *   - Manifestacije s TZ (HTML po mjesecima)
 *   - Restorani iz TZ JSON API-ja (tzgsb.hr/static/json/restorani.json)
 *   - Smještaj iz TZ JSON API-ja (tzgsb.hr/static/json/smjestaj.json)
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

// ─── Restorani iz TZ JSON API-ja ────────────────────────────────────────────

async function scrapeRestorani() {
  const text = await fetchHtml('https://www.tzgsb.hr/static/json/restorani.json');
  if (!text) return [];

  let data;
  try { data = JSON.parse(text); } catch { return []; }

  const records = data.records || [];
  const result = records.map(r => {
    const web = r.web?.[0];
    const webUrl = typeof web === 'object' ? (web.https ? 'https://' : 'http://') + web.url : (web ? 'https://' + web : '');
    const name = r.name || '';
    const addr = (r.address || []).join(', ');
    const phone = r.phone?.[0] || r.mobile?.[0] || '';
    return {
      naziv: name,
      adresa: addr,
      telefon: phone,
      web: webUrl,
      karta: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' Slavonski Brod')}`,
    };
  }).filter(r => r.naziv);

  console.log(`✅ Restorani TZ: ${result.length} stavki`);
  return result;
}

// ─── Smještaj iz TZ JSON API-ja ─────────────────────────────────────────────

async function scrapeSmjestaj() {
  const text = await fetchHtml('https://www.tzgsb.hr/static/json/smjestaj.json');
  if (!text) return { hoteli: [], ostalo: [] };

  let data;
  try { data = JSON.parse(text); } catch { return { hoteli: [], ostalo: [] }; }

  const records = data.records || [];

  // Grupiramo po tipu
  const hotelTypes = new Set(['HOTEL', 'HOSTEL', 'HOSTERLY', 'PANSION']);
  const apartTypes = new Set(['APARTMENT', 'APARTMENTS', 'STUDIO_APARTMENT', 'ROOMS', 'VILLA', 'HOLIDAY_HOME']);

  function mapRecord(r) {
    const web = r.web?.[0];
    const webUrl = typeof web === 'object' ? (web.https ? 'https://' : 'http://') + web.url : (web ? 'https://' + web : '');
    const name = r.name || '';
    const addr = (r.address || []).join(', ');
    const phone = r.phone?.[0] || r.mobile?.[0] || '';
    const rank = r.rank ? '★'.repeat(Math.min(r.rank, 5)) : '';
    return {
      naziv: name + (rank ? ` ${rank}` : ''),
      tip: r.type || 'OSTALO',
      adresa: addr,
      telefon: phone,
      web: webUrl,
      karta: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' Slavonski Brod')}`,
    };
  }

  const hoteli = records.filter(r => hotelTypes.has(r.type)).map(mapRecord);
  const apartmani = records.filter(r => apartTypes.has(r.type)).map(mapRecord);

  console.log(`✅ Smještaj TZ: ${hoteli.length} hoteli/hosteli/pansioni + ${apartmani.length} apartmani/sobe/vile`);
  return { hoteli, apartmani };
}

// ─── Kulturna baština (TZ stranice) ─────────────────────────────────────────

// Samo TZ stranice koje imaju specifičan HTML sadržaj za scraping
const BASTINA_PAGES = [
  {
    naziv: 'Muzej tambura (Kuća tambure)',
    tip: 'Muzej',
    link: 'https://www.tzgsb.hr/index.php?page=muzejtambura',
    adresa: 'Vukovarska 1, 35000 Slavonski Brod (zapadna kurtina Tvrđave Brod)',
    telefon: '+385 98 226 707',
    email: 'but@but.hr',
    web: 'https://www.but.hr',
    karta: 'https://www.google.com/maps/search/?api=1&query=Muzej+tambura+Slavonski+Brod',
  },
  {
    naziv: 'Kuća Brlićevih — Interpretacijski centar Ivane Brlić-Mažuranić',
    tip: 'Spomen-kuća / Interpretacijski centar',
    link: 'https://www.tzgsb.hr/index.php?page=kuca_brlicevih',
    karta: 'https://www.google.com/maps/search/?api=1&query=Kuca+Brlicevih+Slavonski+Brod',
  },
  {
    naziv: 'Living History — Tvrđava Brod',
    tip: 'Doživljajna turistička atrakcija',
    link: 'https://www.tzgsb.hr/index.php?page=livinghistory',
    karta: 'https://www.google.com/maps/search/?api=1&query=Tvrdjava+Brod+Slavonski+Brod',
  },
];

function extractBastrinaContent(html) {
  const text = stripHtml(html);
  const footerMarker = '© Copyright Tourist Board';

  // Pokušaj naći specifičan sadržaj stranice u bloku iza navigacije
  // TZ stranice s konkretnim sadržajem imaju ga iza "Preporučujemo!" ili "Living History" ili naziva sekcije
  const contentMarkers = ['Preporučujemo!', 'Living History programi', 'Kuća Brlićevih', 'Gradski vodič'];
  let start = -1;
  for (const marker of contentMarkers) {
    const idx = text.indexOf(marker);
    if (idx >= 0) { start = idx; break; }
  }
  if (start < 0) return ''; // nema prepoznatljivog sadržaja

  const end = text.indexOf(footerMarker);
  const raw = (end > start ? text.substring(start, end) : text.substring(start, start + 2000)).trim();

  const cleaned = raw
    .replace(/^-?\s*\w+\/\w+\s+\d{4}\.?\s*/i, '')  // ukloni "- siječanj/veljača 2012."
    .replace(/\+385\s*\d[\d\s\-\/]+/g, '')
    .replace(/[\w.+-]+@[\w-]+\.[a-z]{2,}/g, '')
    .replace(/www\.\S+/g, '')
    .replace(/\s{3,}/g, '  ')
    .trim();

  // Odbaci ako počinje s navigacijskim tekstom
  if (/^Turistička zajednica|^O nama|^Kulturna baština/.test(cleaned)) return '';

  return cleaned.substring(0, 600);
}

async function scrapeBastina() {
  const result = [];

  for (const page of BASTINA_PAGES) {
    // Za TZ stranice dohvati HTML; za vanjske URL-ove preskoči scraping opisa
    const isTzPage = page.link.includes('tzgsb.hr/index.php');
    let opis = '';
    if (isTzPage) {
      const html = await fetchHtml(page.link);
      opis = html ? extractBastrinaContent(html) : '';
    }
    result.push({ ...page, opis: opis || undefined });
    console.log(`  🏛️  ${page.naziv}: ${opis.length} znakova`);
  }

  console.log(`✅ Kulturna baština: ${result.length} stavki`);
  return result;
}

// ─── Turističke atrakcije ────────────────────────────────────────────────────

// Kurirane atrakcije s poznatim podacima (TZ HTML nema specifičnih stranica za svaku)
const ATRAKCIJE_STATIC = [
  {
    naziv: 'Sportsko-rekreacijska zona Vijuš',
    tip: 'Rekreacija',
    opis: 'Sportska dvorana kapaciteta 2.200 mjesta, kuglana, bazeni, nogometni stadion, 3D mural (1.300 m²) — jedan od najvećih u regiji, fitness park i biciklističke staze.',
    link: 'https://www.tzgsb.hr/index.php?page=rekreacija',
    karta: 'https://www.google.com/maps/search/?api=1&query=Vijus+Slavonski+Brod',
  },
  {
    naziv: 'Rekreacijski centar Poloj',
    tip: 'Rekreacija / Plaža',
    opis: '3 km nizvodno od centra grada uz Savu. Pješčana riječna plaža, sportski tereni, piknik prostori i parking. Omiljeno ljetno odredište Broðana.',
    link: 'https://www.tzgsb.hr/index.php?page=rekreacija',
    karta: 'https://www.google.com/maps/search/?api=1&query=Poloj+Slavonski+Brod',
  },
  {
    naziv: 'Dilj gora — rekreacija i priroda',
    tip: 'Priroda / Planinarenje',
    opis: 'Geološki lokalitet Pljuskara, jezero Ljeskove vode, Planinski dom Đuro Pilar i rekreacijska šuma Striborova u podnožju Dilj gore sjeverno od grada.',
    link: 'https://www.tzgsb.hr/index.php?page=rekreacija',
    karta: 'https://www.google.com/maps/search/?api=1&query=Dilj+gora+Slavonski+Brod',
  },
  {
    naziv: 'Malena i Klepetan — Priča o rodama',
    tip: 'Jedinstvena turistička priča',
    opis: 'Svjetski poznata priča o rodi Maleni koja zbog oštećenih krila ne može letjeti, te njezinom partneru Klepetanu koji se svake godine vraća iz Afrike u Brodsku Posavinu. Priča je obišla cijeli svijet i postala simbol odanosti.',
    lokacija: 'Slavonski Kobaš (15 km od Slavonskog Broda)',
    karta: 'https://www.google.com/maps/search/?api=1&query=Slavonski+Kobas+rode',
    link: 'https://www.tzgsb.hr/index.php?page=malena-klepetan',
  },
  {
    naziv: 'Spomen dom Dragutina Tadijanovića',
    tip: 'Memorijalna kuća / Muzej',
    opis: 'Spomen dom posvećen Dragutinu Tadijanoviću (1905.–2007.), jednom od najznačajnijih hrvatskih pjesnika 20. st. Rodio se u Rastušju kraj Slavonskog Broda. Dom čuva osobne predmete, rukopise i fotografije. TZ organizira susrete s "likom" pjesnika u okviru Living History programa.',
    lokacija: 'Rastušje, okolica Slavonskog Broda',
    karta: 'https://www.google.com/maps/search/?api=1&query=Spomen+dom+Tadijanovic+Slavonski+Brod',
    link: 'https://www.tzgsb.hr/index.php?page=tada-tadijanovic',
  },
  {
    naziv: 'Turističko-industrijski park "Đuro Đaković"',
    tip: 'Industrijska baština / Park',
    opis: 'Park s izloženim željezničkim vagonima, cisternama i industrijskim strojevima slavne brodske tvornice Đuro Đaković. Jedinstven industrijski muzej na otvorenom koji prikazuje 100+ godina slavonske industrije.',
    adresa: 'Slavonski Brod',
    karta: 'https://www.google.com/maps/search/?api=1&query=Djuro+Djakovic+Slavonski+Brod',
    link: 'https://www.tzgsb.hr/index.php?page=gdjdj',
  },
  {
    naziv: 'Lovački muzej',
    tip: 'Muzej',
    opis: 'Muzej s bogatom zbirkom lovačkih trofeja, oružja i opreme karakteristične za Brodsko-posavsku županiju i posavske lovišta.',
    adresa: 'Slavonski Brod',
    karta: 'https://www.google.com/maps/search/?api=1&query=Lovacki+muzej+Slavonski+Brod',
    link: 'https://www.tzgsb.hr',
  },
  {
    naziv: 'Posavska biciklistička ruta',
    tip: 'Aktivni turizam / Biciklizam',
    opis: 'Ravninska biciklistička ruta koja prolazi uz Savu kroz Brodsko-posavsku županiju. Dio međunarodne EuroVelo mreže. Lako vozna, prolazi uz rijeku i kroz posavska sela.',
    link: 'https://www.tzgsb.hr',
    karta: 'https://www.google.com/maps/search/?api=1&query=Posavska+biciklisticka+ruta',
  },
];

async function scrapeAtrakcije() {
  // Provjeri ima li stranica rekreacija ažurnijeg sadržaja od statičkih podataka
  const html = await fetchHtml('https://www.tzgsb.hr/index.php?page=rekreacija');
  if (html) {
    const text = stripHtml(html);
    // Provjeri prisutnost očekivanog sadržaja
    const hasVijus = /Vijuš/i.test(text);
    const hasPoloj = /Poloj/i.test(text);
    console.log(`  🏃 Rekreacija: Vijuš=${hasVijus}, Poloj=${hasPoloj}`);
  }

  console.log(`✅ Turističke atrakcije: ${ATRAKCIJE_STATIC.length} stavki`);
  return ATRAKCIJE_STATIC;
}

// ─── Zapis rezultata ─────────────────────────────────────────────────────────

function writeOutput(data) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const output = `// AUTO-GENERATED — ne editiraj ručno!
// Zadnje skrapanje: ${ts} UTC
// Izvor: slavonski-brod.hr (RSS), tzgsb.hr (JSON API + HTML)
// GitHub Actions job: scrape-brod (tjedno, ponedjeljkom u 06:00 UTC)

export const scrapedContent = ${JSON.stringify(data, null, 2)};
`;
  writeFileSync('api/_scraped_content.js', output, 'utf8');
  console.log('✅ Zapisano: api/_scraped_content.js');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Pokrećem scraping za Slavonski Brod...\n');

  const [vijesti, manifestacije, restorani, smjestajData, bastina, atrakcije] = await Promise.all([
    scrapeVijesti(),
    scrapeManifestacije(),
    scrapeRestorani(),
    scrapeSmjestaj(),
    scrapeBastina(),
    scrapeAtrakcije(),
  ]);

  const data = {
    meta: {
      zadnje_azuriranje: new Date().toISOString(),
      izvori: [
        'https://www.slavonski-brod.hr/vijesti?format=feed&type=rss',
        'https://www.tzgsb.hr/static/json/restorani.json',
        'https://www.tzgsb.hr/static/json/smjestaj.json',
        'https://www.tzgsb.hr/index.php?page=manifestacije',
        'https://www.tzgsb.hr/index.php?page=kulturna-bastina',
        'https://www.tzgsb.hr/index.php?page=rekreacija',
      ],
    },
    novosti_grad: vijesti,
    manifestacije_aktualne: manifestacije,
    restorani_tz: restorani,
    smjestaj_hoteli: smjestajData.hoteli || [],
    smjestaj_apartmani: smjestajData.apartmani || [],
    kulturna_bastina: bastina,
    atrakcije_tz: atrakcije,
  };

  const total = vijesti.length + manifestacije.length + restorani.length +
    (smjestajData.hoteli?.length || 0) + (smjestajData.apartmani?.length || 0) +
    bastina.length + atrakcije.length;

  if (total === 0) {
    console.warn('⚠️  Nije dohvaćen nikakav sadržaj. Provjeri dostupnost web stranica.');
    process.exit(0);
  }

  writeOutput(data);
  console.log(`\n✅ Ukupno scraped:`);
  console.log('  📰 Vijesti:', vijesti.length);
  console.log('  📅 Manifestacije:', manifestacije.length);
  console.log('  🍽️  Restorani:', restorani.length);
  console.log('  🏨 Hoteli/hosteli/pansioni:', smjestajData.hoteli?.length || 0);
  console.log('  🏠 Apartmani/sobe/vile:', smjestajData.apartmani?.length || 0);
  console.log('  🏛️  Kulturna baština:', bastina.length);
  console.log('  🎯 Turističke atrakcije:', atrakcije.length);
}

main().catch(err => {
  console.error('❌ Scraping neuspješan:', err);
  process.exit(1);
});
