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

const I = require('./_instrumentos');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  // Motor genérico: /api/precios?ids=id1,id2 devuelve el precio CRUDO de cada
  // instrumento. Sin `ids`, se mantiene la respuesta de siempre (ruta vieja).
  const ids = leerIds(req);
  if (ids) return preciosPorIds(ids, res);
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

// ---------------------------------------------------------------------------
// Motor genérico (Fase 5A). La API NO convierte unidades ni monedas: entrega el
// valor tal cual lo publica la fuente, con su unidad y moneda. Para cripto
// informa además el MEP por separado; la conversión la hace el cliente una vez.
// ---------------------------------------------------------------------------
// Lectura de ids. Se toma el valor YA DECODIFICADO de `ids` (de req.query, o de
// req.url con URLSearchParams si no hay req.query) y se separa por comas. Así
// "a,b" y "a%2Cb" dan lo mismo: Vercel puede re-codificar la coma literal como
// %2C en req.url, por lo que la coma no puede distinguirse de una coma dentro
// de un id. Consecuencia: un id no puede contener comas. También acepta
// ?ids=a&ids=b. Devuelve null si no hay `ids` (ruta vieja).
function leerIds(req) {
  let valores = [];
  const q = req && req.query ? req.query.ids : undefined;
  if (q !== undefined && q !== null) {
    valores = Array.isArray(q) ? q : [q];
  } else if (req && typeof req.url === 'string' && req.url.indexOf('?') >= 0) {
    try { valores = new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1)).getAll('ids'); } catch (e) { valores = []; }
  }
  if (!valores.length) return null;
  const ids = [];
  valores.forEach(v => String(v).split(',').forEach(parte => ids.push(parte)));
  const unicos = [...new Set(ids.map(s => s.trim()).filter(Boolean))].slice(0, 100);
  return unicos.length ? unicos : null;
}

async function preciosPorIds(ids, res) {
  try {
    const consultadoEn = new Date().toISOString();
    const resultados = {};
    const grupos = {}; // "proveedor:panel" -> [{ id, clave }]
    ids.forEach(id => {
      const p = I.parsearId(id);
      if (!p) { resultados[id] = { id, ok: false, motivo: 'id inválido' }; return; }
      const g = `${p.proveedor}:${p.panel}`;
      (grupos[g] = grupos[g] || []).push({ id, ...p });
    });

    const fuentesConError = [];
    const falla = (nombre, e) => fuentesConError.push(`${nombre}: ${(e && e.message) || e}`);
    let necesitaMep = false;

    await Promise.all(Object.keys(grupos).map(async g => {
      const items = grupos[g];
      const { proveedor, panel } = items[0];
      if (proveedor === 'data912' && I.PANELES_DATA912[panel]) {
        let filas;
        try { filas = await I.fetchJSON(I.urlData912(panel)); } catch (e) { falla(`data912/${panel}`, e); filas = null; }
        const simbolosPanel = new Set((Array.isArray(filas) ? filas : []).map(x => x && typeof x.symbol === 'string' ? x.symbol.trim().toUpperCase() : null).filter(Boolean));
        items.forEach(({ id, clave }) => {
          if (!filas) { resultados[id] = { id, ok: false, motivo: 'fuente no disponible' }; return; }
          const fila = filas.find(x => x && typeof x.symbol === 'string' && x.symbol.trim().toUpperCase() === clave.toUpperCase());
          if (!fila) { resultados[id] = { id, ok: false, motivo: 'no figura en el panel' }; return; }
          const def = I.definirData912(panel, clave.toUpperCase(), simbolosPanel);
          resultados[id] = {
            id, ok: true, estado: def.estado,
            precioFuente: fila.c === undefined ? null : fila.c, // crudo: se valida en el cliente
            unidadFuente: def.unidadFuente, monedaFuente: def.moneda,
            fuente: { proveedor, panel, clave: def.simbolo, campo: 'c' },
            consultadoEn, fechaCotizacion: null, // data912 no publica fecha
          };
        });
      } else if (proveedor === 'argentinadatos' && I.CATEGORIAS_FCI.includes(panel)) {
        let filas;
        try { filas = await I.fetchJSON(I.urlFCI(panel)); } catch (e) { falla(`argentinadatos/${panel}`, e); filas = null; }
        items.forEach(({ id, clave }) => {
          if (!Array.isArray(filas)) { resultados[id] = { id, ok: false, motivo: 'fuente no disponible' }; return; }
          const fila = filas.find(x => x && x.fondo === clave);
          if (!fila) { resultados[id] = { id, ok: false, motivo: 'no figura en la categoría' }; return; }
          const def = I.definirFCI(panel, clave);
          resultados[id] = {
            id, ok: true, estado: def.estado,
            precioFuente: fila.vcp === undefined ? null : fila.vcp,
            unidadFuente: def.unidadFuente, monedaFuente: def.moneda,
            fuente: { proveedor, panel, clave, campo: 'vcp' },
            consultadoEn, fechaCotizacion: typeof fila.fecha === 'string' ? fila.fecha : null,
          };
        });
      } else if (proveedor === 'coingecko' && panel === 'simple') {
        const validos = items.filter(it => I.CRIPTO[it.clave]);
        items.filter(it => !I.CRIPTO[it.clave]).forEach(({ id }) => { resultados[id] = { id, ok: false, motivo: 'cripto no soportada' }; });
        if (!validos.length) return;
        necesitaMep = true;
        let data;
        try { data = await I.fetchJSON(I.urlCoingecko(validos.map(v => v.clave))); } catch (e) { falla('coingecko', e); data = null; }
        validos.forEach(({ id, clave }) => {
          if (!data) { resultados[id] = { id, ok: false, motivo: 'fuente no disponible' }; return; }
          const def = I.definirCripto(clave);
          const usd = data[clave] ? data[clave].usd : undefined;
          resultados[id] = {
            id, ok: true, estado: def.estado,
            precioFuente: usd === undefined ? null : usd,
            unidadFuente: def.unidadFuente, monedaFuente: def.moneda,
            fuente: { proveedor, panel, clave, campo: 'usd' },
            consultadoEn, fechaCotizacion: null,
          };
        });
      } else {
        items.forEach(({ id }) => { resultados[id] = { id, ok: false, motivo: 'proveedor o panel desconocido' }; });
      }
    }));

    // Tipo de cambio informado aparte, sin aplicarlo.
    const tiposCambio = {};
    if (necesitaMep) {
      try {
        const mep = await I.fetchJSON(I.URL_MEP);
        const valor = mep && typeof mep.compra === 'number' && typeof mep.venta === 'number' ? (mep.compra + mep.venta) / 2 : null;
        tiposCambio.MEP = { nombre: 'MEP', valor, fuente: 'dolarapi.com /v1/dolares/bolsa (promedio compra/venta)', consultadoEn };
      } catch (e) {
        falla('dolarapi', e);
        tiposCambio.MEP = { nombre: 'MEP', valor: null, fuente: 'dolarapi.com /v1/dolares/bolsa (promedio compra/venta)', consultadoEn };
      }
    }

    res.status(200).json({ ok: true, resultados, tiposCambio, fuentesConError, consultadoEn });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
}
