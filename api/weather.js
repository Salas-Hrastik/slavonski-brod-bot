// api/weather.js — Server-side weather za Slavonski Brod (Open-Meteo, bez API ključa)
// Kešira rezultat 10 minuta da ne pritišće API

let cached = null;
let cachedAt = 0;
const CACHE_MS = 15 * 60 * 1000; // 15 minuta

const WMO_ICONS = {
  0:'☀️',1:'🌤️',2:'⛅',3:'☁️',
  45:'🌫️',48:'🌫️',
  51:'🌦️',53:'🌦️',55:'🌦️',
  61:'🌧️',63:'🌧️',65:'🌧️',
  71:'❄️',73:'❄️',75:'❄️',77:'❄️',
  80:'🌦️',81:'🌦️',82:'🌦️',
  85:'❄️',86:'❄️',
  95:'⛈️',96:'⛈️',99:'⛈️'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Vercel CDN kešira 10 min, stale-while-revalidate još 5 min (brži odgovor)
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=300');

  const now = Date.now();
  if (cached && (now - cachedAt) < CACHE_MS) {
    return res.status(200).json(cached);
  }

  try {
    const r = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=45.16&longitude=18.015' +
      '&current=temperature_2m,windspeed_10m,weathercode&wind_speed_unit=kmh&timezone=Europe%2FZagreb'
    );
    if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
    const d = await r.json();
    const c = d.current;

    cached = {
      temp: Math.round(c.temperature_2m),
      wind: Math.round(c.windspeed_10m),
      icon: WMO_ICONS[c.weathercode] || '🌡️',
      code: c.weathercode,
      time: c.time
    };
    cachedAt = now;

    return res.status(200).json(cached);
  } catch (err) {
    console.error('Weather fetch error:', err.message);
    // Vrati zadnje keširano ili prazan objekt
    return res.status(200).json(cached || { temp: null, wind: null, icon: '🌡️' });
  }
}
