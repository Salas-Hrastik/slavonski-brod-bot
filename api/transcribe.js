/**
 * POST /api/transcribe — prijepis govora u tekst (Speech-to-Text).
 *
 * Namjena: glasovni unos na uređajima BEZ Web Speech API-ja (iPhone/iPad Safari,
 * Firefox). Klijent snimi kratak isječak zvuka, kodira ga u base64 i pošalje ovamo
 * kao JSON; server ga proslijedi OpenAI Whisperu i vrati prepoznati tekst.
 *
 * Tijelo (JSON): { audio: "<base64>", mime: "audio/webm", lang: "hr"|"en"|"de" }
 * Odgovor: { text: string }
 *
 * NAPOMENA: zahtijeva OPENAI_API_KEY u okolini (Vercel → Environment Variables).
 */

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — kratki glasovni upiti su mali

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('[transcribe] Nedostaje OPENAI_API_KEY u okolini.');
    res.status(503).json({ error: 'Prijepis govora trenutačno nije konfiguriran.' });
    return;
  }

  try {
    // Vercel parsira application/json u req.body; podržavamo i string za svaki slučaj.
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const b64 = (body.audio || '').toString();
    if (!b64) {
      res.status(400).json({ error: 'Nedostaje audio zapis.' });
      return;
    }

    const audio = Buffer.from(b64, 'base64');
    if (audio.length === 0) {
      res.status(400).json({ error: 'Neispravan audio zapis.' });
      return;
    }
    if (audio.length > MAX_BYTES) {
      res.status(413).json({ error: 'Audio zapis je prevelik.' });
      return;
    }

    // Ekstenzija pomaže Whisperu odrediti format.
    const mime = (body.mime || 'audio/webm').toString();
    const ext = mime.includes('mp4') || mime.includes('m4a')
      ? 'mp4'
      : mime.includes('ogg')
        ? 'ogg'
        : mime.includes('wav')
          ? 'wav'
          : 'webm';

    // Jezik prijepisa (ako je poznat) — inače Whisper sam prepoznaje jezik.
    const langRaw = (body.lang || '').toString();
    const lang = ['hr', 'en', 'de'].includes(langRaw) ? langRaw : '';

    const form = new FormData();
    form.append('file', new Blob([audio], { type: mime }), `snimka.${ext}`);
    form.append('model', 'whisper-1');
    if (lang) form.append('language', lang);
    form.append('response_format', 'json');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}` },
      body: form,
      signal: AbortSignal.timeout(25000),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[transcribe] OpenAI greška:', r.status, detail.slice(0, 300));
      res.status(502).json({ error: 'Prijepis trenutačno nije moguć.' });
      return;
    }

    const data = await r.json();
    res.status(200).json({ text: (data.text || '').trim() });
  } catch (e) {
    console.error('[transcribe] greška:', e?.message || e);
    res.status(500).json({ error: 'Došlo je do pogreške pri prijepisu.' });
  }
}
