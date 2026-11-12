// Dijagnostika glasovnog unosa: stranica šalje slijed događaja prepoznavanja govora
// (vrsta događaja, vrijeme, kod greške, duljina teksta), nikad sam izgovoreni tekst.
// Zapis je vidljiv u Vercel logovima kao redak "[voice] ...".
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};
  const events = Array.isArray(b.events) ? b.events.slice(0, 80).map(e => ({
    t: Number(e.t) || 0,
    e: String(e.e || '').slice(0, 20),
    x: e.x == null ? undefined : String(e.x).slice(0, 40),
  })) : [];
  console.log('[voice]', JSON.stringify({ ua: String(b.ua || '').slice(0, 200), mode: String(b.mode || '').slice(0, 12), lang: String(b.lang || '').slice(0, 8), events }));
  return res.status(204).end();
}
