// Esta función corre en el servidor de Vercel (no en el navegador), así que no tiene
// problema de CORS para llamar a las fuentes de datos. El navegador solo le pide a ESTA
// función: fetch('/api/precios').
//
// Fuentes usadas (públicas y gratuitas, sin necesidad de clave/API key):
//   - data912.com          -> CEDEARs, ONs corporativas y tipo de cambio MEP (Argentina)
//   - api.coingecko.com    -> precio de Bitcoin y USDT en dólares
//
// IMPORTANTE: estas son fuentes comunitarias/hobby, no oficiales. Pueden tener demora
// (data912 se describe a sí mismo como no estrictamente en tiempo real) o algún símbolo
// que no coincida exactamente. Si ves "Sin precio para: X" en la app, lo más probable es
// que el ticker configurado abajo no sea el que usa la fuente — revisalo y ajustalo.

// Mapa de tickers: para cada activo (tal como lo escribiste en "Cartera objetivo"),
// indicá el símbolo que hay que buscar. Dejalo vacío si no aplica.
const TICKERS = {
  cedears: {
    'SPY': 'SPY',
    'XLK': 'XLK',
    'VEA': 'VEA',
  },
  corp: {
    'ON YPF': 'YFCDO',
    'ON Pampa': 'MGCEO',
  },
  crypto: {
    'Bitcoin': 'bitcoin',
    'USDT (staking)': 'tether',
  },
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  try {
    const [cedears, corp, mep, crypto] = await Promise.all([
      fetchJSON('https://data912.com/live/arg_cedears'),
      fetchJSON('https://data912.com/live/arg_corp'),
      fetchJSON('https://data912.com/live/mep'),
      fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,tether&vs_currencies=usd'),
    ]);

    const usdArs = extractRate(mep);
    const prices = {};
    const notFound = [];

    for (const [name, symbol] of Object.entries(TICKERS.cedears)) {
      const row = findBySymbol(cedears, symbol);
      const price = row ? pickPrice(row) : null;
      if (price) prices[name] = price; else notFound.push(`${name} (ticker: ${symbol})`);
    }
    for (const [name, symbol] of Object.entries(TICKERS.corp)) {
      const row = findBySymbol(corp, symbol);
      const price = row ? pickPrice(row) : null;
      if (price) prices[name] = price; else notFound.push(`${name} (ticker: ${symbol})`);
    }
    for (const [name, id] of Object.entries(TICKERS.crypto)) {
      const usd = crypto && crypto[id] && crypto[id].usd;
      if (usd && usdArs) prices[name] = usd * usdArs;
      else notFound.push(`${name} (falta cotización de ${id} o del dólar MEP)`);
    }

    res.status(200).json({ ok: true, prices, usdArs, notFound, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'mi-cartera-personal/1.0' } });
  if (!r.ok) throw new Error(`No se pudo leer ${url} (status ${r.status})`);
  return r.json();
}

function findBySymbol(arr, symbol) {
  if (!Array.isArray(arr) || !symbol) return null;
  return arr.find(x => x && typeof x.symbol === 'string' && x.symbol.toUpperCase() === symbol.toUpperCase());
}

function pickPrice(row) {
  const val = row.c ?? row.px_bid ?? row.px_ask ?? null;
  return typeof val === 'number' && val > 0 ? val : null;
}

// El shape exacto de /live/mep no está confirmado (puede ser un array o un objeto único);
// esto intenta cubrir ambos casos probando los nombres de campo más comunes.
function extractRate(mep) {
  const row = Array.isArray(mep) ? mep[0] : mep;
  if (!row || typeof row !== 'object') return null;
  const val = row.c ?? row.px_bid ?? row.px_ask ?? row.venta ?? row.value ?? row.price ?? null;
  return typeof val === 'number' && val > 0 ? val : null;
}
