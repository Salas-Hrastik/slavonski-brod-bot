import OpenAI from "openai";
import { db } from "./_database.js";
import { scrapedContent } from "./_scraped_content.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY?.trim()
});

function stripImages(data) {
  if (Array.isArray(data)) return data.map(stripImages);
  if (data && typeof data === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === 'IMAGE_URL') continue;
      out[k] = stripImages(v);
    }
    return out;
  }
  return data;
}

function getCategoryItems(category) {
  const s = scrapedContent;
  if (!s) return [];

  function item(o, extra) {
    return { naziv: o.naziv || '', slika: o.slika || '', adresa: o.adresa || '',
             telefon: o.telefon || '', web: o.web || '', karta: o.karta || '', ...extra };
  }

  if (category === 'gastronomija') {
    return (s.restorani_tz || []).slice(0, 20).map(r => item(r));
  }
  if (category === 'smjestaj') {
    const hoteli = (s.smjestaj_hoteli || []).map(h => item(h));
    const apartmani = (s.smjestaj_apartmani || [])
      .filter(a => a.slika)
      .slice(0, 20)
      .map(a => item(a));
    return [...hoteli, ...apartmani];
  }
  if (category === 'znamenitosti') {
    return (s.kulturna_bastina || []).map(b => item(b, { opis: b.opis || '' }));
  }
  if (category === 'priroda' || category === 'sport') {
    return (s.atrakcije_tz || []).map(a => item(a, { opis: a.opis || '' }));
  }
  // okolica — AI obrađuje s db.okolica.izleti (pravi izleti iz SB, ne lokalne atrakcije)
  return [];
}

// Vizualne kategorije — uvijek prikazuju minijature
const VISUAL_CATS = ['gastronomija', 'smjestaj', 'znamenitosti', 'priroda', 'sport'];

// Vraća stavke sa slikom za kategoriju — uvijek, bez obzira na kontekst pitanja
function getItemsForCategory(category, limit = 8) {
  const s = scrapedContent;
  if (!s) return [];

  function item(o) {
    return { naziv: o.naziv || '', slika: o.slika || '', adresa: o.adresa || '',
             telefon: o.telefon || '', web: o.web || '', karta: o.karta || '' };
  }

  if (category === 'gastronomija') {
    return (s.restorani_tz || []).filter(o => o.slika).slice(0, limit).map(item);
  }
  if (category === 'smjestaj') {
    const hoteli = (s.smjestaj_hoteli || []).filter(o => o.slika).map(item);
    const apartmani = (s.smjestaj_apartmani || []).filter(o => o.slika).slice(0, limit - hoteli.length).map(item);
    return [...hoteli, ...apartmani].slice(0, limit);
  }
  if (category === 'znamenitosti') {
    return (s.kulturna_bastina || []).filter(o => o.slika).slice(0, limit).map(item);
  }
  if (category === 'priroda' || category === 'sport') {
    return (s.atrakcije_tz || []).filter(o => o.slika).slice(0, limit).map(item);
  }
  return [];
}

// Traži stavke sa slikom koje odgovaraju ključnim riječima u tekstu (za AI odgovore)
// Ako nema dovoljno matcheva, dopuni s kategorijskim stavkama
function findRelevantItems(text, category) {
  const s = scrapedContent;
  if (!s) return [];
  const t = text.toLowerCase();

  function item(o) {
    return { naziv: o.naziv || '', slika: o.slika || '', adresa: o.adresa || '',
             telefon: o.telefon || '', web: o.web || '', karta: o.karta || '' };
  }

  // Odaberi pool prema kategoriji
  let pool;
  if (category === 'gastronomija') pool = s.restorani_tz || [];
  else if (category === 'smjestaj') pool = [...(s.smjestaj_hoteli || []), ...(s.smjestaj_apartmani || [])];
  else if (category === 'znamenitosti') pool = s.kulturna_bastina || [];
  else if (category === 'priroda' || category === 'sport') pool = s.atrakcije_tz || [];
  else pool = [...(s.kulturna_bastina || []), ...(s.restorani_tz || []), ...(s.smjestaj_hoteli || [])];

  const matched = pool.filter(o => {
    if (!o.slika) return false;
    const name = (o.naziv || '').toLowerCase();
    const words = name.split(/[\s\-—/]+/).filter(w => w.length > 3);
    return words.some(w => t.includes(w));
  });

  return matched.slice(0, 6).map(item);
}

function buildScrapedSection(category) {
  const s = scrapedContent;
  if (!s) return '';
  const lines = [];
  const ts = s.meta?.zadnje_azuriranje?.substring(0, 10) || '';

  function poiLines(lista, max = 30) {
    return (lista || []).slice(0, max).map(x => {
      const adr = x.adresa ? ` — ${x.adresa}` : '';
      const tel = x.telefon ? ` | ${x.telefon}` : '';
      const rw  = x.radno_vrijeme ? ` | ${x.radno_vrijeme}` : '';
      return `• **${x.naziv}**${adr}${tel}${rw}`;
    });
  }

  if (category === 'opcenito') {
    const o = s.o_nama || {};
    if (o.grad_opis) lines.push(`\nO gradu:\n${o.grad_opis.substring(0, 600)}`);
    if (o.rijec_gradonacelnika) lines.push(`\nRijec gradonacelnika:\n${o.rijec_gradonacelnika.substring(0, 400)}`);
    if (s.novosti_grad?.length) {
      lines.push(`\nNajnovije vijesti (${ts}):`);
      s.novosti_grad.slice(0, 5).forEach(n => lines.push(`• [${n.datum}] ${n.naslov}`));
    }
  }

  if (category === 'smjestaj') {
    if (s.smjestaj_hoteli?.length) {
      lines.push(`\nHoteli, hosteli i pansioni (${s.smjestaj_hoteli.length}):`);
      s.smjestaj_hoteli.forEach(h => {
        const tel = h.telefon ? ` | Tel: ${h.telefon}` : '';
        const web = h.web ? ` | ${h.web}` : '';
        lines.push(`• **${h.naziv}** [${h.tip}] — ${h.adresa}${tel}${web}`);
      });
    }
    if (s.smjestaj_apartmani?.length) {
      lines.push(`\nApartmani, sobe i vile (${s.smjestaj_apartmani.length} ukupno — prvih 30):`);
      s.smjestaj_apartmani.slice(0, 30).forEach(a => {
        const tel = a.telefon ? ` | Tel: ${a.telefon}` : '';
        const web = a.web ? ` | ${a.web}` : '';
        lines.push(`• **${a.naziv}** [${a.tip}] — ${a.adresa}${tel}${web}`);
      });
      if (s.smjestaj_apartmani.length > 30)
        lines.push(`  ... i jos ${s.smjestaj_apartmani.length - 30} objekata: https://www.tzgsb.hr/index.php?page=smjestaj`);
    }
  }

  if (category === 'gastronomija') {
    if (s.restorani_tz?.length) {
      lines.push(`\nRestorani registrirani pri TZ (${s.restorani_tz.length}):`);
      s.restorani_tz.forEach(r => {
        const tel = r.telefon ? ` | Tel: ${r.telefon}` : '';
        const web = r.web ? ` | ${r.web}` : '';
        lines.push(`• **${r.naziv}** — ${r.adresa}${tel}${web}`);
      });
    }
    if (s.poi?.caffe_barovi?.length) {
      lines.push(`\nCaffe barovi i kafici (${s.poi.caffe_barovi.length}):`);
      lines.push(...poiLines(s.poi.caffe_barovi, 25));
    }
  }

  if (category === 'dogadanja') {
    if (s.manifestacije_aktualne?.length) {
      lines.push('\nAktualne manifestacije:');
      s.manifestacije_aktualne.forEach(m => {
        lines.push(`• ${m.naziv} (${m.datum})`);
        if (m.opis) lines.push(`  ${m.opis.substring(0, 200)}`);
      });
    }
  }

  if (category === 'znamenitosti') {
    if (s.kulturna_bastina?.length) {
      lines.push(`\nKulturna bastina (${s.kulturna_bastina.length} lokacija):`);
      s.kulturna_bastina.forEach(b => {
        const adr = b.adresa ? ` | ${b.adresa}` : '';
        const tel = b.telefon ? ` | Tel: ${b.telefon}` : '';
        const web = b.web ? ` | ${b.web}` : '';
        lines.push(`• **${b.naziv}** [${b.tip}]${adr}${tel}${web}`);
        if (b.opis) lines.push(`  ${b.opis.substring(0, 250)}`);
      });
    }
    if (s.poi?.muzeji?.length) {
      lines.push(`\nMuzeji (OSM):`);
      lines.push(...poiLines(s.poi.muzeji));
    }
  }

  if (category === 'priroda' || category === 'sport') {
    if (s.atrakcije_tz?.length) {
      lines.push(`\nTuristicke atrakcije i rekreacija:`);
      s.atrakcije_tz.forEach(a => {
        const lok = a.lokacija ? ` | ${a.lokacija}` : (a.adresa ? ` | ${a.adresa}` : '');
        lines.push(`• **${a.naziv}** [${a.tip}]${lok}`);
        if (a.opis) lines.push(`  ${a.opis.substring(0, 180)}`);
      });
    }
  }

  if (category === 'usluge') {
    const o = s.o_nama || {};
    if (o.kontakti) lines.push(`\nKontakti i vazni brojevi:\n${o.kontakti.substring(0, 700)}`);
    if (o.tic) lines.push(`\nTuristicko-informativni centar:\n${o.tic.substring(0, 350)}`);
    if (o.turisticke_agencije) lines.push(`\nTuristicke agencije:\n${o.turisticke_agencije.substring(0, 500)}`);
    const p = s.poi || {};
    if (p.ljekarne?.length)        { lines.push(`\nLjekarne (${p.ljekarne.length}):`);          lines.push(...poiLines(p.ljekarne)); }
    if (p.lijecnici?.length)       { lines.push(`\nLijecnici/klinike (${p.lijecnici.length}):`); lines.push(...poiLines(p.lijecnici)); }
    if (p.banke_bankomati?.length) { lines.push(`\nBanke i bankomati (${p.banke_bankomati.length}):`); lines.push(...poiLines(p.banke_bankomati, 20)); }
    if (p.posta?.length)           { lines.push(`\nPosta (${p.posta.length}):`);               lines.push(...poiLines(p.posta)); }
    if (p.auto_servisi?.length)    { lines.push(`\nAuto servisi (${p.auto_servisi.length}):`);  lines.push(...poiLines(p.auto_servisi)); }
    if (p.javni_prijevoz?.length)  { lines.push(`\nStanice javnog prijevoza (${p.javni_prijevoz.length}):`); lines.push(...poiLines(p.javni_prijevoz, 20)); }
  }

  if (category === 'benzinske') {
    if (s.poi?.benzinske?.length) {
      lines.push(`\nBenzinske postaje (${s.poi.benzinske.length}):`);
      lines.push(...poiLines(s.poi.benzinske));
    }
  }

  if (category === 'parking') {
    if (s.poi?.parkinzi?.length) {
      lines.push(`\nParkiralista (${s.poi.parkinzi.length}):`);
      lines.push(...poiLines(s.poi.parkinzi));
    }
  }

  if (category === 'kupovina') {
    const p = s.poi || {};
    if (p.trgovacki_centri?.length) { lines.push(`\nTrgvacki centri i supermarketi (${p.trgovacki_centri.length}):`); lines.push(...poiLines(p.trgovacki_centri)); }
    if (p.frizerski_saloni?.length) { lines.push(`\nFrizerski saloni (${p.frizerski_saloni.length}):`); lines.push(...poiLines(p.frizerski_saloni, 20)); }
  }

  if (category === 'okolica') {
    if (s.atrakcije_tz?.length) {
      const prirodne = s.atrakcije_tz.filter(a => a.tip?.includes('Priroda') || a.tip?.includes('Izletiste') || a.lokacija);
      if (prirodne.length) {
        lines.push(`\nIzletista i priroda u okolici:`);
        prirodne.forEach(a => {
          const lok = a.lokacija ? ` | ${a.lokacija}` : '';
          lines.push(`• **${a.naziv}** [${a.tip}]${lok}`);
          if (a.opis) lines.push(`  ${a.opis.substring(0, 150)}`);
        });
      }
    }
  }

  if (category === 'dokumenti') {
    if (s.dokumenti_strategije?.length) {
      lines.push(`\nStrategije i planovi razvoja turizma (${s.dokumenti_strategije.length}):`);
      s.dokumenti_strategije.forEach(d => { lines.push(`• ${d.naslov}`); lines.push(`  ${d.url}`); });
    }
    if (s.dokumenti_ostali?.length) {
      lines.push(`\nOstali dokumenti TZ (${s.dokumenti_ostali.length}):`);
      s.dokumenti_ostali.slice(0, 15).forEach(d => { lines.push(`• ${d.naslov}`); lines.push(`  ${d.url}`); });
      if (s.dokumenti_ostali.length > 15)
        lines.push(`  ... i jos ${s.dokumenti_ostali.length - 15}: https://www.tzgsb.hr/index.php?page=opceinformacije`);
    }
  }

  return lines.length ? lines.join('\n') : '';
}

const CATEGORY_CONTEXTS = {
  smjestaj:     (db) => ({ grad: db.grad }),
  gastronomija: (db) => ({ grad: db.grad, lokalna_kuhinja: db.lokalna_kuhinja }),
  dogadanja:    (db) => ({ grad: db.grad, dogadanja: db.dogadanja }),
  znamenitosti: (db) => ({ grad: db.grad, znamenitosti: db.znamenitosti }),
  sport:        (db) => ({ grad: db.grad, sport: db.sport }),
  kupovina:     (db) => ({ grad: db.grad, kupovina: db.kupovina }),
  opcenito:     (db) => ({ grad: db.grad, opcenito: db.opcenito }),
  benzinske:    (db) => ({ grad: db.grad }),
  parking:      (db) => ({ grad: db.grad }),
  usluge:       (db) => ({ grad: db.grad }),
  priroda:      (db) => ({ grad: db.grad, priroda: db.priroda }),
  okolica:      (db) => ({ grad: db.grad, okolica: db.okolica }),
  dokumenti:    (db) => ({ grad: db.grad }),
};

function detectLang(msg) {
  const words = msg.toLowerCase().split(/[\s,?.!;:()\-]+/);
  const has = (list) => list.some(w => words.includes(w));
  if (has(['what','where','how','which','when','is','are','can','do','have','show','find','tell','give','any','some','the','and','but','not','open','map','near','best','visit','see','eat','drink','stay','sleep','book','ticket','price','time','hour']))
    return 'en';
  if (has(['was','wo','wie','welche','wann','ist','sind','kann','haben','zeig','gibt','bitte','ich','ein','eine','der','die','das','und','oder','nicht','hier','mit','für','von','nach','beim','zum','zur']))
    return 'de';
  return 'hr';
}

const TR = {
  hr: {
    map:        'Otvori na karti',
    more:       'Više informacija',
    tzMore:     'Više informacija na TZ Slavonski Brod',
    web:        'Web stranica',
    inCity:     'u Slavonskom Brodu',
    free:       'Besplatno',
    contact:    'Kontakt',
    upcoming:   'Predstojeće manifestacije u Slavonskom Brodu',
    noEvents:   'Trenutno nema predstojećih manifestacija. Pratite TZ Slavonski Brod za najave!',
    allAccom:   'Evo svih smještajnih opcija u Slavonskom Brodu:',
    hotels:     'Hoteli',
    apts:       'Apartmani',
    pensions:   'Prenoćišta',
    dining:     'Restorani i mjesta za objedovanje u Slavonskom Brodu:',
    cafes:      'Caffe barovi i kavane u Slavonskom Brodu:',
    allGastro:  'Slavonski Brod ima bogatu ugostiteljsku ponudu. Evo pregleda:',
    rests:      'Restorani',
    fastfood:   'Brza hrana i pizzerije',
    cafesH:     'Caffe barovi i kavane',
    health:     '🏥 Zdravstvene ustanove i ljekarne:',
    atm:        '🏧 Banke i bankomati:',
    banks:      '🏦 Banke i pošta:',
    taxi:       '🚕 Taksi prijevoz:',
    bus:        '🚌 Autobusni prijevoz:',
    fuel:       '⛽ Benzinske stanice:',
    parking:    '🅿️ Parkirališta u Slavonskom Brodu:',
    svcOverview:'Pregled usluga dostupnih u Slavonskom Brodu:',
    askMore:    'Pitajte za detalje o bilo kojoj kategoriji!',
    excursions: 'Preporučeni izleti iz Slavonskog Broda — od najbližeg prema daljem:',
  },
  en: {
    map:        'Open on map',
    more:       'More information',
    tzMore:     'More information at TZ Slavonski Brod',
    web:        'Website',
    inCity:     'in Slavonski Brod',
    free:       'Free',
    contact:    'Contact',
    upcoming:   'Upcoming events in Slavonski Brod',
    noEvents:   'No upcoming events at this time. Follow TZ Slavonski Brod for announcements!',
    allAccom:   'Here are all accommodation options in Slavonski Brod:',
    hotels:     'Hotels',
    apts:       'Apartments',
    pensions:   'Guesthouses',
    dining:     'Restaurants and dining in Slavonski Brod:',
    cafes:      'Cafés in Slavonski Brod:',
    allGastro:  'Slavonski Brod has a rich culinary offer. Here is an overview:',
    rests:      'Restaurants',
    fastfood:   'Fast food & pizzerias',
    cafesH:     'Cafés & coffee bars',
    health:     '🏥 Healthcare & pharmacies:',
    atm:        '🏧 ATMs & banks:',
    banks:      '🏦 Banks & post office:',
    taxi:       '🚕 Taxi services:',
    bus:        '🚌 Bus transport:',
    fuel:       '⛽ Petrol stations:',
    parking:    '🅿️ Parking in Slavonski Brod:',
    svcOverview:'Services available in Slavonski Brod:',
    askMore:    'Ask for details on any category!',
    excursions: 'Recommended day trips from Slavonski Brod — nearest to farthest:',
  },
  de: {
    map:        'Auf der Karte öffnen',
    more:       'Mehr Informationen',
    tzMore:     'Mehr Informationen – TZ Slavonski Brod',
    web:        'Webseite',
    inCity:     'in Slavonski Brod',
    free:       'Kostenlos',
    contact:    'Kontakt',
    upcoming:   'Bevorstehende Veranstaltungen in Slavonski Brod',
    noEvents:   'Derzeit keine bevorstehenden Veranstaltungen. Folgen Sie TZ Slavonski Brod!',
    allAccom:   'Hier sind alle Unterkunftsmöglichkeiten in Slavonski Brod:',
    hotels:     'Hotels',
    apts:       'Apartments',
    pensions:   'Pensionen',
    dining:     'Restaurants und Gastronomie in Slavonski Brod:',
    cafes:      'Cafés in Slavonski Brod:',
    allGastro:  'Slavonski Brod bietet ein reiches kulinarisches Angebot. Hier ein Überblick:',
    rests:      'Restaurants',
    fastfood:   'Schnellimbiss & Pizzerien',
    cafesH:     'Cafés & Kaffeebars',
    health:     '🏥 Gesundheit & Apotheken:',
    atm:        '🏧 Geldautomaten & Banken:',
    banks:      '🏦 Banken & Post:',
    taxi:       '🚕 Taxiservice:',
    bus:        '🚌 Busverbindungen:',
    fuel:       '⛽ Tankstellen:',
    parking:    '🅿️ Parkplätze in Slavonski Brod:',
    svcOverview:'Verfügbare Dienstleistungen in Slavonski Brod:',
    askMore:    'Fragen Sie nach Details zu einer beliebigen Kategorie!',
    excursions: 'Empfohlene Ausflüge ab Slavonski Brod — vom nächsten zum weitesten:',
  },
};

function getRelevantContext(message, db, lastCategory) {
  const msg = message.toLowerCase();

  if (msg.includes('povijest') || msg.includes('histori') || msg.includes('osnovan') || msg.includes('općenito') || msg.includes('o gradu') || msg.includes('o slavonskom') || msg.includes('o brodu') || msg.includes('stanovic') || msg.includes('stanovništv') || msg.includes('geografij') || msg.includes('gospodarsk') || msg.includes('industrij') || msg.includes('poznat') || msg.includes('zanimljiv') || msg.includes('marsonia') || msg.includes('đuro đaković') || msg.includes('duro dakovic') || msg.includes('rimsk') || msg.includes('osmansk') || msg.includes('gradonačelnik') || msg.includes('udaljenost') || msg.includes('vojnokrajiš') || msg.includes('vojna krajina') || msg.includes('domovinski rat') || msg.includes('brodogradnja')
    || msg.includes('history') || msg.includes('about') || msg.includes('general') || msg.includes('population') || msg.includes('founded') || msg.includes('economy') || msg.includes('industry') || msg.includes('famous')
    || msg.includes('geschichte') || msg.includes('über') || msg.includes('einwohner') || msg.includes('wirtschaft'))
    return { context: CATEGORY_CONTEXTS.opcenito(db), category: 'opcenito' };

  if (msg.includes('smještaj') || msg.includes('smjestaj') || msg.includes('hotel') || msg.includes('noćen') || msg.includes('nocen') || msg.includes('apartman') || msg.includes('sobe') || msg.includes('soba') || msg.includes('prenoćiš') || msg.includes('prenocis') || msg.includes('iznajm')
    || msg.includes('accommodation') || msg.includes('sleep') || msg.includes('stay') || msg.includes('room') || msg.includes('bed') || msg.includes('lodge') || msg.includes('hostel')
    || msg.includes('unterkunft') || msg.includes('schlafen') || msg.includes('übernacht') || msg.includes('zimmer'))
    return { context: CATEGORY_CONTEXTS.smjestaj(db), category: 'smjestaj' };

  if (msg.includes('jelo') || msg.includes('restoran') || msg.includes('hrana') || msg.includes('pizza') || msg.includes('jesti') || msg.includes('ručati') || msg.includes('ručak') || msg.includes('večer') || msg.includes('objedovati') || msg.includes('doručak') || msg.includes('kafi') || msg.includes('kav') || msg.includes('bar') || msg.includes('ugostit') || msg.includes('popiti') || msg.includes('napit') || msg.includes('radno vrij') || msg.includes('kada radi') || msg.includes('radi li')
    || msg.includes('restaurant') || msg.includes('food') || msg.includes('eat') || msg.includes('dinner') || msg.includes('lunch') || msg.includes('breakfast') || msg.includes('cafe') || msg.includes('coffee') || msg.includes('drink') || msg.includes('where to eat')
    || msg.includes('essen') || msg.includes('speise') || msg.includes('trinken') || msg.includes('café') || msg.includes('mittagessen'))
    return { context: CATEGORY_CONTEXTS.gastronomija(db), category: 'gastronomija' };

  if (msg.includes('događ') || msg.includes('dogad') || msg.includes('festival') || msg.includes('manifestac') || msg.includes('advent') || msg.includes('program') || msg.includes('što se dešava') || msg.includes('što se događa') || msg.includes('uskoro')
    || msg.includes('brodsko kolo') || msg.includes('brod brodilica') || msg.includes('brodski advent') || msg.includes('festival posavine') || msg.includes('dan grada')
    || msg.includes('event') || msg.includes('events') || msg.includes('carnival') || msg.includes('celebration') || msg.includes('upcoming') || msg.includes('what\'s on')
    || msg.includes('veranstaltung') || msg.includes('fest') || msg.includes('feier'))
    return { context: CATEGORY_CONTEXTS.dogadanja(db), category: 'dogadanja' };

  if (msg.includes('znamenitost') || msg.includes('tvrđava') || msg.includes('tvrdava') || msg.includes('muzej') || msg.includes('crkv') || msg.includes('posjet') || msg.includes('vidjeti') || msg.includes('vidjet') || msg.includes('razgled') || msg.includes('što ima') || msg.includes('sto ima') || msg.includes('galerij') || msg.includes('ivana brlić') || msg.includes('ivana brlic') || msg.includes('ivo andrić') || msg.includes('ivo andric') || msg.includes('spomen') || msg.includes('šetalište') || msg.includes('setaliste')
    || msg.includes('attraction') || msg.includes('sightseeing') || msg.includes('castle') || msg.includes('fortress') || msg.includes('museum') || msg.includes('monument') || msg.includes('visit') || msg.includes('landmark') || msg.includes('what to see')
    || msg.includes('sehenswürdigkeit') || msg.includes('burg') || msg.includes('festung') || msg.includes('besichtigung'))
    return { context: CATEGORY_CONTEXTS.znamenitosti(db), category: 'znamenitosti' };

  if (msg.includes('sport') || msg.includes('tenis') || msg.includes('nogomet') || msg.includes('rukomet') || msg.includes('košark') || msg.includes('veslanje') || msg.includes('fitness') || msg.includes('teretana') || msg.includes('stadion') || msg.includes('klub') || msg.includes('bazen') || msg.includes('bicikl') || msg.includes('ribolov') || msg.includes('trčan') || msg.includes('rekreacij')
    || msg.includes('tennis') || msg.includes('football') || msg.includes('soccer') || msg.includes('handball') || msg.includes('gym') || msg.includes('stadium') || msg.includes('swimming') || msg.includes('cycling') || msg.includes('fishing')
    || msg.includes('fußball') || msg.includes('fitnessstudio') || msg.includes('angeln'))
    return { context: CATEGORY_CONTEXTS.sport(db), category: 'sport' };

  if (msg.includes('kupin') || msg.includes('kupovat') || msg.includes('shopping') || msg.includes('trgovin') || msg.includes('supermarket') || msg.includes('dućan') || msg.includes('suveniri') || msg.includes('tržnic') || msg.includes('avenue mall')
    || msg.includes('shop') || msg.includes('store') || msg.includes('buy') || msg.includes('souvenir') || msg.includes('market') || msg.includes('mall') || msg.includes('grocery')
    || msg.includes('einkaufen') || msg.includes('laden') || msg.includes('markt'))
    return { context: CATEGORY_CONTEXTS.kupovina(db), category: 'kupovina' };

  if (msg.includes('benzin') || msg.includes('goriv') || msg.includes('pumpa')
    || msg.includes('gas station') || msg.includes('petrol') || msg.includes('fuel')
    || msg.includes('tankstelle'))
    return { context: CATEGORY_CONTEXTS.benzinske(db), category: 'benzinske' };

  if (msg.includes('parking') || msg.includes('parkir')
    || msg.includes('parken') || msg.includes('parkplatz'))
    return { context: CATEGORY_CONTEXTS.parking(db), category: 'parking' };

  if (msg.includes('ljekar') || msg.includes('banka') || msg.includes('bankomat') || msg.includes('taksi') || msg.includes('taxi') || msg.includes('autobus') || msg.includes('uslug') || msg.includes('bolnic') || msg.includes('liječnik') || msg.includes('ljekarna') || msg.includes('pošta') || msg.includes('auto servis') || msg.includes('mehanik')
    || msg.includes('doctor') || msg.includes('pharmacy') || msg.includes('hospital') || msg.includes('bank') || msg.includes('atm') || msg.includes('bus') || msg.includes('service') || msg.includes('post office')
    || msg.includes('arzt') || msg.includes('apotheke') || msg.includes('krankenhaus') || msg.includes('post'))
    return { context: CATEGORY_CONTEXTS.usluge(db), category: 'usluge' };

  if (msg.includes('šetn') || msg.includes('park') || msg.includes('priroda') || msg.includes('ribolov') || msg.includes('sava') || msg.includes('šuma') || msg.includes('poloj') || msg.includes('bicikl') || msg.includes('riva') || msg.includes('posavina') || msg.includes('posavsk')
    || msg.includes('walk') || msg.includes('hiking') || msg.includes('cycling') || msg.includes('nature') || msg.includes('fishing') || msg.includes('river') || msg.includes('forest') || msg.includes('outdoor')
    || msg.includes('wandern') || msg.includes('radfahren') || msg.includes('natur') || msg.includes('fluss') || msg.includes('wald'))
    return { context: CATEGORY_CONTEXTS.priroda(db), category: 'priroda' };

  if (msg.includes('izlet') || msg.includes('okolica') || msg.includes('blizin') || msg.includes('đakovo') || msg.includes('dakovo') || msg.includes('osijek') || msg.includes('požega') || msg.includes('pozega') || msg.includes('vinkovci') || msg.includes('kutjevo') || msg.includes('bosanski brod') || msg.includes('kozara')
    || msg.includes('trip') || msg.includes('excursion') || msg.includes('nearby') || msg.includes('surroundings') || msg.includes('day trip') || msg.includes('wine')
    || msg.includes('ausflug') || msg.includes('umgebung') || msg.includes('in der nähe') || msg.includes('wein'))
    return { context: CATEGORY_CONTEXTS.okolica(db), category: 'okolica' };

  if (msg.includes('dokument') || msg.includes('strateg') || msg.includes('plan razvoja') || msg.includes('akcijski plan') || msg.includes('master plan') || msg.includes('marketinški plan') || msg.includes('turistička pristojba') || msg.includes('turisticka pristojba') || msg.includes('statut') || msg.includes('pravilnik') || msg.includes('izvješće tz') || msg.includes('program rada')
    || msg.includes('document') || msg.includes('strategy') || msg.includes('development plan') || msg.includes('tourist tax')
    || msg.includes('strategie') || msg.includes('entwicklungsplan'))
    return { context: CATEGORY_CONTEXTS.dokumenti(db), category: 'dokumenti' };

  if (lastCategory && CATEGORY_CONTEXTS[lastCategory])
    return { context: CATEGORY_CONTEXTS[lastCategory](db), category: lastCategory, matched: false };

  return { context: db, category: null, matched: false };
}

function getSuggestions(category) {
  const map = {
    smjestaj:     ['🍽️ Gdje ručati?', '🏰 Tvrđava Brod?', '🅿️ Parkiranje?'],
    gastronomija: ['🏨 Smještaj u gradu?', '🏰 Što vidjeti?', '📅 Događaji?'],
    dogadanja:    ['🏨 Smještaj za tu noć?', '🍽️ Gdje ručati?', '🏰 Što vidjeti?'],
    znamenitosti: ['🍽️ Gdje ručati?', '🏨 Smještaj?', '📅 Događaji?'],
    sport:        ['🍽️ Gdje ručati?', '🌿 Priroda i šetnice?', '🏨 Smještaj?'],
    kupovina:     ['🍽️ Gdje ručati?', '🅿️ Parkiranje?', '🏰 Što vidjeti?'],
    priroda:      ['🍽️ Gdje ručati?', '🚴 Sport i rekreacija?', '🏨 Smještaj?'],
    okolica:      ['🏨 Smještaj?', '🍽️ Gdje ručati?', '📅 Događaji?'],
    opcenito:     ['🏰 Tvrđava Brod?', '🍽️ Gdje ručati?', '🏨 Smještaj?'],
    benzinske:    ['🅿️ Parkiranje?', '🍽️ Gdje ručati?', '🏨 Smještaj?'],
    parking:      ['🍽️ Gdje ručati?', '🏰 Što vidjeti?', '🏨 Smještaj?'],
    usluge:       ['🍽️ Gdje ručati?', '🏨 Smještaj?', '🏰 Što vidjeti?'],
  };
  return map[category] || ['🏰 Tvrđava Brod?', '🍽️ Gdje ručati?', '🏨 Smještaj?'];
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const { message, history, category: lastCategory, weather } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Poruka je prazna." });
    }

    // Warmup ping — odmah vrati, ne zovi OpenAI
    if (message === '__warmup__') {
      return res.status(200).json({ reply: '', category: null, suggestions: [], items: [], images: [] });
    }

    const { context, category, matched = true } = getRelevantContext(message, db, lastCategory);
    const msgLower = message.toLowerCase();
    const lang = detectLang(message);
    const t = TR[lang] || TR.hr;

    // Vremenski upit
    const isWeatherQuery = ['prognoz', 'forecast', 'wetter', 'vremensku prognozu'].some(k => msgLower.includes(k))
      || (['kakvo', 'kako', 'hoće', 'biti', 'temperatura'].filter(k => msgLower.includes(k)).length >= 2 && ['vrij', 'tempera', 'kišno', 'sunčano'].some(k => msgLower.includes(k)));
    if (isWeatherQuery) {
      const reply = `Nažalost, nemam pristup vremenskim podacima.\n\nZa točnu vremensku prognozu preporučujem:\n🌤️ [meteo.hr](https://meteo.hr) — Državni hidrometeorološki zavod\n🌡️ [Weather.com Slavonski Brod](https://weather.com/hr-HR/weather/today/l/Slavonski+Brod)\n\nAko mi kažeš kakvo vrijeme očekuješ — predložit ću aktivnosti koje odgovaraju!`;
      return res.status(200).json({ reply, category: lastCategory || null, suggestions: getSuggestions(lastCategory), images: [] });
    }

    const isRecommendationQuery = ['preporuč', 'savjetuješ', 'savjet', 'što bi', 'sto bi', 'koji bi', 'predloži', 'recommend', 'suggest', 'advice', 'what would you', 'empfehl', 'vorschlag'].some(k => msgLower.includes(k));
    const isDetailQuery = ['zanima me više', 'reci mi više', 'više o', 'više informacij', 'detaljn', 'tko je', 'što je to', 'govori mi o', 'ispričaj mi', 'objasni mi', 'tell me more', 'more about', 'details about', 'who is', 'what is', 'explain', 'erzähl mir mehr', 'mehr über'].some(k => msgLower.includes(k));

    // Direktno listanje (tabovi, brzi gumbi) → uvijek template s karticama
    const isDirectListingRequest = [
      'koji postoje', 'koji ima', 'što postoji', 'prikaži', 'nabroji',
      'svi restorani', 'pregled svih', 'gdje ručati', 'gdje jesti', 'gdje spavati',
      'što se događa', 'show me all', 'list all', 'all restaurants', 'all hotels',
      'where to eat', 'where to stay',
      // Tab gumbi — eksplicitno
      'što vidjeti u slavonskom brodu', 'gdje ručati u slavonskom brodu',
      'smještaj u slavonskom brodu', 'koja događanja', 'brodsko kolo festival',
      'izleti iz slavonskog broda', 'sport i rekreacija', 'kupovina u slavonskom brodu',
      'korisne informacije o slavonskom brodu'
    ].some(k => msgLower.includes(k));

    // Pitanja o uvjetima, aktivnostima, vremenu → uvijek AI (s vremenskim kontekstom)
    const isActivityQuery = [
      'mogu li', 'da li', 'je li', 'hoće li', 'može li', 'vrijedi li', 'isplati li',
      'što raditi', 'što posjetiti', 'što preporučuješ', 'za vikend', 'sutra', 'ovaj tjedan',
      'can i', 'is it', 'will it', 'should i', 'worth it', 'what to do'
    ].some(k => msgLower.includes(k));

    const conversationHistory = Array.isArray(history) ? history : [];
    // Konverzacijski mod: history >= 2 ILI activity pitanje — ali NE ako je direktno listanje
    const isConversationalMode = (conversationHistory.length >= 2 || isActivityQuery) && !isDirectListingRequest;

    const isGeneralKnowledgeQuery = ['kako se priprema', 'kako se kuha', 'recept', 'recepti', 'sastojci', 'kultura', 'tradicija', 'običaj', 'folklor', 'porijeklo', 'legenda', 'kako doći', 'how to make', 'how to cook', 'recipe', 'ingredients', 'tradition', 'culture', 'how to get', 'wie macht man', 'wie kommt man', 'rezept', 'klima', 'valuta', 'govore li', 'koji jezik', 'vegetar', 'vegan'].some(k => msgLower.includes(k));

    // FAQ pre-gen blokovi
    {
      const ml = msgLower;
      let faqReply = null;

      // 1. TURISTIČKA ZAJEDNICA
      if (!faqReply && (ml.includes('turistič') || ml.includes('info centar') || ml.includes('info punkt') || ml.includes('tourist info') || ml.includes('tz slavonski') || ml.includes('tz brod') || ml.includes('turistički ured'))) {
        faqReply =
          '🏢 **Turistička zajednica Grada Slavonskog Broda**\n\n' +
          '📍 Trg pobjede 28/I, 35000 Slavonski Brod\n' +
          '📞 +385 35 447 721\n' +
          '✉️ info@tzgsb.hr\n' +
          '[Otvori na karti](https://www.google.com/maps/search/?api=1&query=Turisticka+zajednica+Slavonski+Brod)\n' +
          '[Više informacija](https://www.tzgsb.hr)';
      }

      // 2. TVRĐAVA BROD
      if (!faqReply && (ml.includes('tvrđava') || ml.includes('tvrdava') || ml.includes('fortress') || ml.includes('festung') || ml.includes('tvrdjava'))) {
        faqReply =
          '🏰 **Tvrđava Brod — Slavonski Brod**\n\n' +
          'Jedna od najvećih i najočuvanijih baroknih tvrđava u jugoistočnoj Europi! Izgrađena po nalogu Habsburga 1715.–1780. godine.\n\n' +
          '📍 Trg Ivane Brlić-Mažuranić, 35000 Slavonski Brod\n' +
          '🕐 Vanjski prostori dostupni cijele godine\n' +
          '💶 Vanjske površine — **besplatno**\n' +
          '[Otvori na karti](https://www.google.com/maps/search/?api=1&query=Tvrdava+Brod+Slavonski+Brod)\n\n' +
          '🎭 Svake godine u tvrđavi se održava **Brodsko kolo** — najdugovječnija smotra folklora u Hrvatskoj!';
      }

      // 3. BRODSKO KOLO
      if (!faqReply && (ml.includes('brodsko kolo') || ml.includes('kolo') && ml.includes('brod') || ml.includes('smotra folklora') || ml.includes('folklor'))) {
        faqReply =
          '🎭 **Brodsko kolo — Slavonski Brod**\n\n' +
          'Najdugovječnija smotra folklora u Republici Hrvatskoj — od **1966. godine**!\n\n' +
          '📅 Svake godine u **lipnju** (tradicionalno treći vikend)\n' +
          '📍 Tvrđava Brod i centar Slavonskog Broda\n\n' +
          '🌍 Više od **5.000 folkloraša** iz cijelog svijeta nastupa na pozornicama tvrđave.\n' +
          'Spektakularan festival pod zvjezdanim nebom!\n\n' +
          '[Više informacija](https://www.tzgsb.hr)';
      }

      // 4. BESPLATNO
      if (!faqReply && (ml.includes('besplatno') || ml.includes('besplatn') || ml.includes('bez naplate') || ml.includes('što ne košta') || (ml.includes('free') && (ml.includes('brod') || ml.includes('što') || ml.includes('sto'))))) {
        faqReply =
          '🎁 Besplatni sadržaji u Slavonskom Brodu:\n\n' +
          '🏰 **Tvrđava Brod** — Vanjske površine otvorene cijele godine, besplatno\n' +
          '[Otvori na karti](https://www.google.com/maps/search/?api=1&query=Tvrdava+Brod+Slavonski+Brod)\n\n' +
          '🚶 **Šetalište uz Savu (Brodska riva)** — 3+ km šetnice uz rijeku, besplatno\n\n' +
          '🌳 **Šuma Poloj** — gradska šuma s piknik mjestima, besplatno\n\n' +
          '🅿️ **Parkiranje uz Tvrđavu** i šetalište — besplatno ili pristupačna naplata\n\n' +
          'ℹ️ Za ulaznice u Muzej Brodskog Posavlja obratite se:\n📞 +385 35 447 721 | [tzgsb.hr](https://www.tzgsb.hr)';
      }

      // 5. ZA DJECU / OBITELJ
      if (!faqReply && (ml.includes('djec') || ml.includes('dijete') || ml.includes('obitelj') || ml.includes('kids') || ml.includes('children') || ml.includes('family') || ml.includes('kinder') || ml.includes('s djecom'))) {
        faqReply =
          '👨‍👩‍👧 Slavonski Brod s djecom i obitelju:\n\n' +
          '🏰 **Tvrđava Brod** — Ogroman prostor za istraživanje, bastioni i hodnici, djeci jako zanimljivo!\n\n' +
          '🏊 **Gradski bazen** — Otvoreni bazen ljeti za sve uzraste\n\n' +
          '🌳 **Sportski park Poloj** — Dječja igrališta, atletska staza, zelenilo\n\n' +
          '🚴 **Šetalište uz Savu** — Bicikliranje i šetnja uz rijeku (3+ km)\n\n' +
          '🎭 **Brodsko kolo (lipanj)** — Međunarodni folklor — djeca obožavaju!\n\n' +
          '📚 **Muzej Brodskog Posavlja** — Edukativno za sve uzraste';
      }

      // 6. PLAN POSJETA / KOLIKO DUGO
      if (!faqReply && (ml.includes('koliko dugo') || ml.includes('koliko vremena') || ml.includes('koliko sati') || ml.includes('how long') || ml.includes('wie lange') || ml.includes('plan posjeta') || ml.includes('vikend plan') || ml.includes('jednodnevni') || (ml.includes('koliko') && (ml.includes('sati') || ml.includes('dana'))))) {
        faqReply =
          '🗺️ Preporučeni plan obilaska Slavonskog Broda:\n\n' +
          '⏱️ **Poludnevni posjet (3–4 sata):**\n' +
          '✅ Tvrđava Brod — obilazak i fotografiranje\n' +
          '✅ Šetalište uz Savu\n' +
          '✅ Centar — Trg pobjede, crkva i kavana\n\n' +
          '☀️ **Cijeli dan (6–8 sati):**\n' +
          '✅ Sve gore + Muzej Brodskog Posavlja\n' +
          '✅ Ručak s fiš-paprikašem u restoranu uz Savu\n' +
          '✅ Šuma Poloj ili bicikliranje uz Savu\n\n' +
          '🏕️ **Vikend u Slavonskom Brodu:**\n' +
          '✅ Sve gore + Đakovo (35 km) — katedrala i lipicaneri\n\n' +
          '💡 Više informacija: [tzgsb.hr](https://www.tzgsb.hr)';
      }

      // 7. SUVENIRI
      if (!faqReply && (ml.includes('suvenir') || ml.includes('souvenir') || ml.includes('poklon') || ml.includes('gift') || ml.includes('lokalni proizvod') || ml.includes('suvenirnic'))) {
        faqReply =
          '🎁 Suveniri i lokalni proizvodi iz Slavonskog Broda:\n\n' +
          '🏢 **Turistička zajednica Slavonski Brod**\n' +
          '📍 Trg pobjede 28/I\n' +
          'Suveniri s motivima Tvrđave Brod i Brodskog kola\n\n' +
          '🌿 **Gradska tržnica** — Domaći OPG proizvodi:\n' +
          'Med, sir, sezonsko voće i povrće, jaja\n\n' +
          '🥩 **Slavonski kulen** — Zaštićena oznaka izvornosti, savršen poklon!\n' +
          '🍷 **Kutjevačka vina** — Graševina i rizling iz Kutjeva (50 km)\n' +
          '🥃 **Domaća rakija** — Šljivovica iz posavskih domaćinstava';
      }

      // 8. VLAK / KOLODVOR
      if (!faqReply && (ml.includes('vlak') || ml.includes('train') || ml.includes('zug') || ml.includes('željeznic') || ml.includes('zeleznic') || ml.includes('kolodvor') || ml.includes('hž') || ml.includes('hz') || ml.includes('hžpp') || ml.includes('hzpp'))) {
        faqReply =
          '🚂 **Vlak iz Slavonskog Broda**\n\n' +
          '📍 **Kolodvor Slavonski Brod**\n' +
          'Trg Josipa Langa 1, 35000 Slavonski Brod\n' +
          '[Otvori na karti](https://www.google.com/maps/search/?api=1&query=Zeljeznicki+kolodvor+Slavonski+Brod)\n\n' +
          '🗺️ **Glavne linije:**\n' +
          '• **Slavonski Brod → Zagreb** — direktna linija, ~2h 30min\n' +
          '• **Slavonski Brod → Osijek** — direktna linija, ~2h\n' +
          '• **Slavonski Brod → Split** — s presedom u Zagrebu\n\n' +
          '📅 Vozni red i karte: [hzpp.hr](https://www.hzpp.hr)\n' +
          '📞 HŽ info: **060 333 444**';
      }

      // 9. AUTOBUS / BUS STANICA
      if (!faqReply && (ml.includes('autobus') || ml.includes('autobusn') || ml.includes('bus stanica') || ml.includes('autobusna stanica') || ml.includes('akz') || (ml.includes('bus') && !ml.includes('vlak')))) {
        faqReply =
          '🚌 **Autobusni prijevoz iz Slavonskog Broda**\n\n' +
          '📍 **Autobusni kolodvor Slavonski Brod**\n' +
          'Petra Krešimira IV, 35000 Slavonski Brod\n' +
          '[Otvori na karti](https://www.google.com/maps/search/?api=1&query=Autobusni+kolodvor+Slavonski+Brod)\n\n' +
          '🗺️ **Linije:**\n' +
          '• Zagreb, Osijek, Đakovo, Vinkovci, Split i ostali gradovi\n' +
          '• Lokalne linije po Brodsko-posavskoj županiji\n\n' +
          '📅 Vozni red: [akz.hr](https://www.akz.hr) ili [getbybus.com](https://getbybus.com)\n' +
          '📞 Kolodvor: **035 280 824**';
      }

      // 11. KONTAKT / OPĆE
      if (!faqReply && (ml.includes('kontakt') || ml.includes('contact') || ml.includes('telefon tz') || ml.includes('email tz') || ml.includes('info o brodu') || ml.includes('informacije o brodu'))) {
        faqReply =
          'ℹ️ Kontakt i informacije o Slavonskom Brodu:\n\n' +
          '🏢 **Turistička zajednica Grada Slavonskog Broda**\n' +
          '📍 Trg pobjede 28/I, 35000 Slavonski Brod\n' +
          '📞 +385 35 447 721\n' +
          '✉️ info@tzgsb.hr\n' +
          '[Više informacija](https://www.tzgsb.hr)';
      }

      // 12. PRISTUPAČNOST
      if (!faqReply && (ml.includes('invalid') || ml.includes('pristupačn') || ml.includes('kolica') || ml.includes('wheelchair') || ml.includes('accessible') || ml.includes('hendikep'))) {
        faqReply =
          '♿ Pristupačnost u Slavonskom Brodu:\n\n' +
          '✅ **Šetalište uz Savu** — Ravna, asfaltirana staza, pogodna za kolica\n' +
          '✅ **Avenue Mall** — Moderni shopping centar, potpuno pristupačan\n' +
          '✅ **Trg pobjede** — Centar bez prepreka\n\n' +
          'Za detalje o pristupačnosti Tvrđave i muzeja:\n' +
          '📞 **+385 35 447 721**\n' +
          '✉️ info@tzgsb.hr | [tzgsb.hr](https://www.tzgsb.hr)';
      }

      if (faqReply) {
        return res.status(200).json({
          reply: faqReply,
          category: category || 'opcenito',
          suggestions: getSuggestions(category || 'opcenito'),
          images: []
        });
      }
    }

    // === Strukturirani odgovor (bez AI — brzo) ===
    const resolvedCat = category || lastCategory;

    // O gradu — template bez AI
    if (resolvedCat === 'opcenito' && !isConversationalMode && !isDetailQuery) {
      const s = scrapedContent || {};
      const o = s.o_nama || {};
      const gradOpis = o.grad_opis ? o.grad_opis.substring(0, 500) : '';
      const reply =
        `🏙️ **Slavonski Brod — O gradu**\n\n` +
        `📍 Grad na lijevoj obali rijeke Save, uz granicu s Bosnom i Hercegovinom\n` +
        `👥 Oko 44.000 stanovnika | Brodsko-posavska županija\n` +
        `🗺️ 200 km od Zagreba | 100 km od Osijeka\n\n` +
        (gradOpis ? `${gradOpis}\n\n` : '') +
        `**Kontakt i informacije:**\n` +
        `🏢 Turistička zajednica Grada Slavonskog Broda\n` +
        `📍 Trg pobjede 28/I, 35000 Slavonski Brod\n` +
        `📞 [+385 35 447 721](tel:+38535447721)\n` +
        `✉️ info@tzgsb.hr\n` +
        `🌐 [tzgsb.hr](https://www.tzgsb.hr)\n\n` +
        `🏛️ Grad osnovan u rimsko doba (Marsonia), danas poznat po **Tvrđavi Brod** i **Brodskom kolu** — najdugovječnijoj smotri folklora u Hrvatskoj.`;
      return res.status(200).json({
        reply,
        category: 'opcenito',
        suggestions: ['🏰 Tvrđava Brod?', '🍽️ Gdje ručati?', '🎭 Brodsko kolo — kada?'],
        items: [],
        images: []
      });
    }

    const items = getCategoryItems(resolvedCat);

    if (items.length > 0 && !isConversationalMode && !isGeneralKnowledgeQuery) {
      const intros = {
        gastronomija: `🍽️ **Restorani u Slavonskom Brodu** (${items.length} registriranih objekata pri TZ)\n\nSlavonski Brod poznata je po bogatoj slavonskoj kuhinji — kulenu, čobancu i fiš-paprikašu. Evo svih restorana:`,
        smjestaj:     `🏨 **Smještaj u Slavonskom Brodu** (${items.length} objekata)\n\nHoteli, pansioni i apartmani registrirani pri Turističkoj zajednici — s fotografijama:`,
        znamenitosti: `🏛️ **Kulturna baština Slavonskog Broda** (${items.length} lokacija)\n\nGlavna atrakcija je **Tvrđava Brod** — jedna od najvećih baroknih tvrđava u ovom dijelu Europe. Evo svih lokacija:`,
        priroda:      `🌿 **Turističke atrakcije i rekreacija** (${items.length} lokacija)\n\nSlavonski Brod nudi raznovrsne mogućnosti za aktivan odmor uz rijeku Savu i u okolnoj prirodi:`,
        sport:        `🏃 **Sport i rekreacija u Slavonskom Brodu** (${items.length} lokacija):`,
      };
      const intro = intros[resolvedCat] || `📍 **${items.length} lokacija** u Slavonskom Brodu:`;

      const suggPool = {
        gastronomija: ['Koji restoran ima slavonski kulen?', 'Gdje je fiš-paprikaš?', 'Terasa uz Savu?', 'Preporuka za večeru?', 'Gdje ručati s djecom?', 'Koji restorani rade nedjeljom?'],
        smjestaj:     ['Koji hotel je najbliži centru?', 'Ima li apartmana uz Savu?', 'Parkiranje uz hotel?', 'Najbliži hotel Tvrđavi?', 'Ima li hostela u gradu?', 'Jeftiniji smještaj?'],
        znamenitosti: ['Radno vrijeme Tvrđave?', 'Što je Living History?', 'Kuća Brlićevih — info?', 'Gdje kupiti ulaznice?', 'Muzej tambure — gdje?', 'Vođene ture po gradu?'],
        priroda:      ['Biciklistička staza uz Savu?', 'Gdje ići ribolovom?', 'Poloj — šetnica uz Savu?', 'Jezero Petnja — kako doći?', 'Gajna rezervat — ulaz?', 'Lov u BPŽ?'],
        sport:        ['Teniski tereni u gradu?', 'Sportska dvorana Vijuš?', 'Plivanje — bazeni?', 'Jogging staze?', 'Sportski centri?'],
        okolica:      ['Kako do Đakova?', 'Vinkovci — što posjetiti?', 'Osijek od Broda?', 'Kutjevo vina — izlet?', 'Bosanski Brod — prijelaz?', 'Dilj gora — planinarenje?'],
      };
      const pool = suggPool[resolvedCat] || getSuggestions(resolvedCat);
      // Odaberi 3 sugestije na temelju duljine poruke kao pseudo-randomizator
      const offset = message.length % Math.max(1, pool.length - 2);
      const suggestions = pool.slice(offset, offset + 3).concat(pool.slice(0, Math.max(0, 3 - (pool.length - offset)))).slice(0, 3);

      return res.status(200).json({
        reply: intro,
        category: resolvedCat,
        suggestions,
        items,
        images: []
      });
    }

    // === AI odgovor (za konverzacijska i složena pitanja) ===
    const contextData = isConversationalMode || isGeneralKnowledgeQuery ? db : context;
    const contextStr = JSON.stringify(stripImages(contextData), null, 1);
    const scrapedSection = buildScrapedSection(resolvedCat);

    const langInstruction = lang === 'en'
      ? 'The user is writing in English. Respond in English.'
      : lang === 'de'
      ? 'Der Benutzer schreibt auf Deutsch. Antworte auf Deutsch.'
      : 'Korisnik piše na hrvatskom. Odgovaraj na hrvatskom.';

    // Pripremi weather/datum kontekst za AI
    const now = new Date();
    const MONTHS = ['siječanj','veljača','ožujak','travanj','svibanj','lipanj','srpanj','kolovoz','rujan','listopad','studeni','prosinac'];
    const DAYS   = ['nedjelja','ponedjeljak','utorak','srijeda','četvrtak','petak','subota'];
    const datumStr = weather?.datum || `${now.getDate()}. ${MONTHS[now.getMonth()]} ${now.getFullYear()}.`;
    const danStr   = weather?.dan   || DAYS[now.getDay()];

    let weatherCtx = `\nTrenutni datum: ${danStr}, ${datumStr}\nSezona: ${['prosinac','siječanj','veljača'].includes(MONTHS[now.getMonth()]) ? 'zima' : ['ožujak','travanj','svibanj'].includes(MONTHS[now.getMonth()]) ? 'proljeće' : ['lipanj','srpanj','kolovoz'].includes(MONTHS[now.getMonth()]) ? 'ljeto' : 'jesen'}`;
    if(weather?.temperature != null){
      weatherCtx += `\nAktualno vrijeme u Slavonskom Brodu: ${weather.icon||''} ${weather.temperature}°C, ${weather.opis||''}, vjetar ${weather.windspeed} km/h`;
    }
    if(weather?.forecast?.length){
      weatherCtx += `\nPrognoza za sljedećih dana:`;
      weather.forecast.slice(0,5).forEach(f => {
        weatherCtx += `\n  ${f.dan} (${f.datum}): ${f.icon} ${f.tmin}–${f.tmax}°C, ${f.opis}${f.kisa ? `, kiša ${f.kisa}%` : ''}`;
      });
    }

    const systemPrompt = `Ti si stručni turistički asistent za grad Slavonski Brod (Hrvatska). Pomažeš posjetiteljima pronaći informacije o znamenitostima, gastronomiji, smještaju, događanjima i svemu što Slavonski Brod nudi.
${weatherCtx}

VAŽNO: Koristi datum i vremenske podatke u odgovorima — preporuči aktivnosti primjerene AKTUALNOJ sezoni i temperaturi. Ako je pitanje o nadolazećim danima, referenciraj prognozu. Nikad ne predlažeš ljetne aktivnosti ako je zima ili obrnuto.

${langInstruction}

Koristiš isključivo podatke iz baze i svoja opća znanja o gradu. Budi prijateljski, informativan i koncizan. Koristi markdown (bold, bullet točke, linkovi na Google Maps).

Baza podataka o Slavonskom Brodu:
${contextStr}
${scrapedSection}

Pravila:
1. Odgovaraj samo na pitanja vezana uz Slavonski Brod i turizam u regiji
2. Ne izmišljaj informacije — ako nešto ne znaš, uputi na TZ (+385 35 447 721)
3. Tvrđava Brod je GLAVNA atrakcija — uvijek je istakni
4. Brodsko kolo (lipanj) je najvažnija manifestacija
5. Slavonski kulen i fiš-paprikaš su kulinarski specijaliteti
6. FORMATIRANJE — OBAVEZNO:
   - NIKAD ne koristi ### ili ## za naslove — umjesto toga koristi **Naslov** (bold)
   - NIKAD ne koristi crtice (- stavka) za listanje — uvijek koristi EMOJI ikonu ispred svake stavke
   - Svaka stavka u listi počinje kontekstualnom ikonom: 🏰 tvrđava, 🎻 glazba, 🐟 riba, 🌲 priroda, 🚴 biciklizam, 🍷 vino, 🎭 kultura, 🍽️ restoran, 🏨 hotel, 📍 lokacija, 📞 telefon, 🌐 web, 🗺️ izlet, ⛪ crkva, 🎪 festival, 🛍️ kupovina, 🏊 sport itd.
   - Nikad ne ponavljaj istu ikonu uzastopno u listi
7. Na APSOLUTNOM KRAJU odgovora, u zadnjem retku, dodaj TOČNO ovako (bez ikakvog prefiksa, zagrade ili dvotočke ispred, uvijek na HRVATSKOM jeziku):
SUGGESTIONS:["Pitanje 1 na hrvatskom?","Pitanje 2 na hrvatskom?","Pitanje 3 na hrvatskom?"]`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-6),
      { role: "user", content: message }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 900,
    });

    let raw = completion.choices[0]?.message?.content || "Nije moguće generirati odgovor.";

    // Izvuci SUGGESTIONS — tolerira bilo koji prefix ([: , \n, razmak itd.)
    let aiSuggestions = null;
    const sugMatch = raw.match(/(?:\[?:?\s*)SUGGESTIONS:\s*(\[[\s\S]+?\])\s*\]?\s*$/);
    if (sugMatch) {
      try { aiSuggestions = JSON.parse(sugMatch[1]); } catch {}
      raw = raw.slice(0, sugMatch.index).trimEnd();
    }
    // Fallback: ukloni sve što počinje s SUGGESTIONS (ili [...SUGGESTIONS) do kraja
    raw = raw.replace(/\[?:?\s*SUGGESTIONS:[\s\S]*$/, '').trimEnd();

    // Pronađi relevantne stavke sa slikom za AI odgovor
    // Za vizualne kategorije — uvijek prikaži minijature, neovisno o kontekstu pitanja
    let aiItems = findRelevantItems(message + ' ' + raw, resolvedCat);
    if (VISUAL_CATS.includes(resolvedCat) && aiItems.length < 2) {
      // Nema dovoljno keyword matcheva — uzmi prvih N stavki s fotografijom iz kategorije
      aiItems = getItemsForCategory(resolvedCat, 6);
    }

    return res.status(200).json({
      reply: raw,
      category: resolvedCat || null,
      suggestions: aiSuggestions || getSuggestions(resolvedCat),
      items: aiItems,
      images: []
    });

  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ reply: "Greška u komunikaciji sa serverom. Pokušajte ponovno." });
  }
}
