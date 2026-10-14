// Utilidades compartidas por las pruebas. Las pruebas NO se despliegan
// (ver .vercelignore) y no hacen llamadas de red: todo usa fuentes simuladas.
const path = require('path');

const ROOT = path.join(__dirname, '..');
let n = 0;
let fallas = 0;

function t(nombre, f) {
  try { f(); console.log('OK   ' + nombre); n++; } catch (e) {
    console.error('FALLA ' + nombre + '\n      ' + String(e && e.message).split('\n').join('\n      '));
    fallas++; process.exitCode = 1;
  }
}

async function ta(nombre, f) {
  try { await f(); console.log('OK   ' + nombre); n++; } catch (e) {
    console.error('FALLA ' + nombre + '\n      ' + String(e && e.message).split('\n').join('\n      '));
    fallas++; process.exitCode = 1;
  }
}

function fin(titulo) {
  console.log('\n' + n + ' pruebas OK' + (fallas ? ', ' + fallas + ' FALLAS' : '') + ' (' + titulo + ')');
  if (fallas) process.exitCode = 1;
}

const mockRes = () => {
  const r = { h: {}, setHeader(k, v) { r.h[k] = v; }, status(c) { r.c = c; return r; }, json(b) { r.b = b; return r; } };
  return r;
};

// Fuentes simuladas (data912, ArgentinaDatos, CoinGecko, dolarapi). Registra las
// URL pedidas en `pedidos`.
const FCI_NOMBRES = {
  schroder: 'Schroder Renta Plus - Clase A',
  schroderC: 'Schroder Renta Plus - Clase C',
  mpAhorro: 'MP Ahorro - Clase A',
  mpAhorroC: 'MP Ahorro - Clase C',
  mpEmpresas: 'MP Empresas Argentinas - Clase A',
};

function fixture() {
  const sym = (arr, base) => arr.map((s, i) => ({ symbol: s, c: (base || 1000) + i, px_bid: 1, px_ask: 2 }));
  const data = {
    'https://data912.com/live/arg_cedears': sym(['SPY', 'SPYD', 'XLK', 'VEA', 'IVV', 'GLD', 'AAPL', 'MELI', 'MSFT'], 20000),
    'https://data912.com/live/arg_stocks': sym(['GGAL', 'YPFD', 'PAMP'], 5000),
    'https://data912.com/live/arg_bonds': sym(['AL29', 'AL29D', 'AL29C', 'GD38', 'GD38D', 'GD38C', 'AO27', 'AO28', 'TX28', 'GD30'], 80000),
    'https://data912.com/live/arg_corp': sym(['YFCGO', 'MGCEO'], 150000),
    'https://data912.com/live/arg_notes': sym(['S30O6'], 133),
    'https://api.argentinadatos.com/v1/finanzas/fci/rentaFija/ultimo': [
      { fondo: FCI_NOMBRES.schroder, vcp: 132295.509, fecha: '2026-09-30' },
      { fondo: FCI_NOMBRES.schroderC, vcp: 120000.1, fecha: '2026-09-30' },
      { fondo: FCI_NOMBRES.mpAhorro, vcp: 1206.333, fecha: '2026-09-28' },
      { fondo: FCI_NOMBRES.mpAhorroC, vcp: 1100.5, fecha: '2026-09-28' },
    ],
    'https://api.argentinadatos.com/v1/finanzas/fci/rentaVariable/ultimo': [
      { fondo: FCI_NOMBRES.mpEmpresas, vcp: 884.502, fecha: '2026-09-30' },
    ],
    'https://api.argentinadatos.com/v1/finanzas/fci/rentaMixta/ultimo': [
      { fondo: 'Fondo Ñandú', vcp: 10, fecha: '2026-09-30' },
      { fondo: 'Fondo Nandu', vcp: 11, fecha: '2026-09-30' },
    ],
    'https://api.argentinadatos.com/v1/finanzas/fci/otros/ultimo': [{ fondo: 'Fondo Doble', vcp: 5, fecha: '2026-09-30' }],
    'https://api.argentinadatos.com/v1/finanzas/fci/retornoTotal/ultimo': [{ fondo: 'Fondo Doble', vcp: 5, fecha: '2026-09-30' }, { fondo: 'Fondo Solo Retorno', vcp: 7, fecha: '2026-09-30' }],
  };
  const pedidos = [];
  const f = async u => {
    pedidos.push(u);
    let body = data[u];
    if (body === undefined) {
      if (u.includes('coingecko')) body = { bitcoin: { usd: 81311 }, tether: { usd: 0.999181 } };
      else if (u.includes('dolarapi')) body = { compra: 1530, venta: 1548.8 };
      else if (u.includes('argentinadatos')) body = [];
      else return { ok: false, status: 404, json: async () => [] };
    }
    return { ok: true, json: async () => body };
  };
  return { fetch: f, pedidos, data };
}

// Evidencia de prueba que declara la convención de la regla (como debe hacerse).
// `cambios` permite alterar un atributo de la convención o del resto para probar rechazos.
function herramientas(I) {
  const contraste = (reglaId, instrumento, a, b, cambios) => ({
    tipo: 'contraste', instrumento, fecha: '2026-10-14',
    convencion: { ...I.convencionDe(I.REGLAS[reglaId]), ...((cambios && cambios.convencion) || {}) },
    a: { fuente: 'A', valor: a }, b: { fuente: 'B', valor: b }, limite: 'prueba',
    ...((cambios && cambios.resto) || {}),
  });
  const documentacion = (reglaId, instrumento, cambios) => ({
    tipo: 'documentacion', instrumento: instrumento || null, fecha: '2026-10-14',
    convencion: { ...I.convencionDe(I.REGLAS[reglaId]), ...((cambios && cambios.convencion) || {}) },
    fuenteDoc: 'doc de prueba', detalle: 'la fuente declara la unidad',
  });
  // Agrega evidencia a una regla durante `f` y la restaura siempre.
  const conEvidencia = (reglaId, extra, f) => {
    const r = I.REGLAS[reglaId];
    const antes = r.evidencia.slice();
    r.evidencia.push(...extra);
    try { return f(); } finally { r.evidencia.length = 0; r.evidencia.push(...antes); }
  };
  // Cambia temporalmente atributos de una regla durante `f`.
  const conRegla = (reglaId, cambios, f) => {
    const r = I.REGLAS[reglaId];
    const antes = {};
    Object.keys(cambios).forEach(k => { antes[k] = r[k]; r[k] = cambios[k]; });
    try { return f(); } finally { Object.keys(antes).forEach(k => { r[k] = antes[k]; }); }
  };
  return { contraste, documentacion, conEvidencia, conRegla };
}

module.exports = { ROOT, t, ta, fin, mockRes, fixture, herramientas, FCI_NOMBRES };
