// api/weather.js — Vrijeme za Slavonski Brod
// Identičan pristup kao Valpovo — open-meteo, bez API ključa

const WMO_ICONS = {
  0:'☀️', 1:'🌤️', 2:'⛅', 3:'☁️',
  45:'🌫️', 48:'🌫️',
  51:'🌦️', 53:'🌦️', 55:'🌦️',
  61:'🌧️', 63:'🌧️', 65:'🌧️',
  71:'❄️', 73:'❄️', 75:'❄️', 77:'❄️',
  80:'🌦️', 81:'🌦️', 82:'🌦️',
  85:'❄️', 86:'❄️',
  95:'⛈️', 96:'⛈️', 99:'⛈️'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=300');

  try {
    // Isti pristup kao Valpovo — current_weather=true (stariji, stabilniji endpoint)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);

    const r = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=45.16&longitude=18.015&current_weather=true&wind_speed_unit=kmh',
      { signal: ctrl.signal }
    );
    clearTimeout(timer);

    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const w = d.current_weather;

    return res.status(200).json({
      temperature: Math.round(w.temperature),
      windspeed:   Math.round(w.windspeed),
      icon:        WMO_ICONS[w.weathercode] || '🌡️'
    });

  } catch (err) {
    console.error('Weather error:', err.message);
    return res.status(200).json({ temperature: null, windspeed: null, icon: '🌡️' });
  }
}
