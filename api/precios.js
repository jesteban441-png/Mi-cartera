// Esta función corre en el servidor de Vercel (no en el navegador), así que no tiene
// problema de CORS para llamar a las fuentes de datos. El navegador solo le pide a ESTA
// función: fetch('/api/precios').
//
// Fuentes usadas (públicas y gratuitas, sin necesidad de clave/API key):
//   - data912.com    -> CEDEARs y ONs corporativas (Argentina)
//   - dolarapi.com    -> dólar MEP, para convertir cripto (en USD) a pesos
//   - api.coingecko.com -> precio de Bitcoin y USDT en dólares
//
// IMPORTANTE: son fuentes comunitarias/hobby, no oficiales. Pueden tener demora, caerse
// un rato, o algún símbolo que no coincida exactamente. Por eso cada fuente se pide por
// separado (no todo junto): si UNA falla, las demás igual traen su precio. Si ves
// "Sin precio para: X", puede ser el ticker mal configurado (te muestra parecidos) o
// que esa fuente puntual esté caída (mirá "fuentesConError" en la respuesta).

// Mapa de tickers: para cada activo (tal como lo escribiste en "Cartera objetivo"),
// indicá el símbolo que hay que buscar. Dejalo vacío si no aplica.
const TICKERS = {
  cedears: {
    'SPY': 'SPY',
    'XLK': 'XLK',
    'VEA': 'VEA',
  },
  bonds: { // se busca en arg_corp y arg_notes juntos
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
    const fuentes = [
      { key: 'cedears', url: 'https://data912.com/live/arg_cedears' },
      { key: 'corp', url: 'https://data912.com/live/arg_corp' },
      { key: 'notes', url: 'https://data912.com/live/arg_notes' },
      { key: 'mep', url: 'https://dolarapi.com/v1/dolares/bolsa' },
      { key: 'crypto', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,tether&vs_currencies=usd' },
    ];
    const resultados = await Promise.allSettled(fuentes.map(f => fetchJSON(f.url)));

    const datos = {};
    const fuentesConError = [];
    resultados.forEach((r, i) => {
      const { key, url } = fuentes[i];
      if (r.status === 'fulfilled') {
        datos[key] = r.value;
      } else {
        datos[key] = null;
        const motivo = (r.reason && r.reason.cause && r.reason.cause.message) || (r.reason && r.reason.message) || String(r.reason);
        fuentesConError.push(`${key} (${url}): ${motivo}`);
      }
    });

    const mep = datos.mep;
    const usdArs = (mep && typeof mep.compra === 'number' && typeof mep.venta === 'number')
      ? (mep.compra + mep.venta) / 2 : null;
    const bondsPanel = [...(Array.isArray(datos.corp) ? datos.corp : []), ...(Array.isArray(datos.notes) ? datos.notes : [])];

    const prices = {};
    const notFound = [];

    for (const [name, symbol] of Object.entries(TICKERS.cedears)) {
      const row = findBySymbol(datos.cedears, symbol);
      const price = row ? pickPrice(row) : null;
      if (price) prices[name] = price;
      else notFound.push(`${name} (ticker: ${symbol})`);
    }
    for (const [name, symbol] of Object.entries(TICKERS.bonds)) {
      const row = findBySymbol(bondsPanel, symbol);
      const price = row ? pickPrice(row) : null;
      if (price) prices[name] = price;
      else {
        const parecidos = suggestSimilar(bondsPanel, symbol);
        notFound.push(`${name} (ticker: ${symbol})${parecidos.length ? ' — parecidos: ' + parecidos.join(', ') : ''}`);
      }
    }
    for (const [name, id] of Object.entries(TICKERS.crypto)) {
      const usd = datos.crypto && datos.crypto[id] && datos.crypto[id].usd;
      if (usd && usdArs) prices[name] = usd * usdArs;
      else notFound.push(`${name} (falta cotización de ${id} o del dólar MEP)`);
    }

    res.status(200).json({ ok: true, prices, usdArs, notFound, fuentesConError, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'mi-cartera-personal/1.0' } });
  if (!r.ok) throw new Error(`status ${r.status}`);
  return r.json();
}
function findBySymbol(arr, symbol) {
  if (!Array.isArray(arr) || !symbol) return null;
  return arr.find(x => x && typeof x.symbol === 'string' && x.symbol.toUpperCase() === symbol.toUpperCase());
}
function suggestSimilar(arr, symbol) {
  if (!Array.isArray(arr) || !symbol) return [];
  const prefix = symbol.slice(0, 2).toUpperCase();
  return arr.filter(x => x && typeof x.symbol === 'string' && x.symbol.toUpperCase().startsWith(prefix)).map(x => x.symbol).slice(0, 8);
}
function pickPrice(row) {
  const val = row.c ?? row.px_bid ?? row.px_ask ?? null;
  return typeof val === 'number' && val > 0 ? val : null;
}
