// Definición de instrumentos del motor de precios genérico (Fase 5A).
// Lo usan /api/catalogo (para describir cada instrumento) y /api/precios (para
// saber de dónde sacar el precio crudo de un id). El archivo empieza con "_" para
// que Vercel no lo publique como ruta.
//
// Regla de oro: acá NO se inventan factores ni monedas. Un instrumento es
// "soportado" solo si su unidad y su moneda fueron verificadas contra un broker.
// Todo lo demás queda "sin-verificar" (factor y moneda en null) o "solo-manual".

const ESTADOS = ['soportado', 'sin-verificar', 'solo-manual'];

// Paneles de data912 que usa la app. `tipo` es descriptivo.
const PANELES_DATA912 = {
  arg_cedears: { tipo: 'cedear', categoria: 'cedears', label: 'CEDEARs' },
  arg_stocks: { tipo: 'accion', categoria: 'acciones', label: 'Acciones argentinas' },
  arg_bonds: { tipo: 'bono', categoria: 'bonos', label: 'Bonos argentinos' },
  arg_corp: { tipo: 'on', categoria: 'obligaciones', label: 'Obligaciones negociables' },
  arg_notes: { tipo: 'letra', categoria: 'notas', label: 'Notas / letras' },
};

// Bonos soberanos en ARS verificados contra broker: cotizan cada 100 VN.
const BONOS_VERIFICADOS = new Set(['AL29', 'GD38', 'TX28', 'AO27', 'AO28']);

// FCI verificados contra CAFCI: nombre exacto del fondo en ArgentinaDatos.
// Cotizan (vcp) cada 1000 cuotapartes. Si ArgentinaDatos cambia el nombre, el
// fondo deja de figurar como soportado (falla segura, nunca un factor inventado).
// Vacío a propósito: los nombres exactos de los FCI de Mercado Pago no pudieron
// confirmarse carácter por carácter contra la fuente real. Candidatos a revisar
// en producción: "MP Empresas Argentinas - Clase A" (rentaVariable) y el fondo
// "MP Ahorro" (no apareció en ninguna categoría). Hasta confirmarlos: sin-verificar.
const FCI_VERIFICADOS = new Set([]);
const CATEGORIAS_FCI = ['mercadoDinero', 'rentaVariable', 'rentaFija', 'rentaMixta', 'otros'];

// Cripto: CoinGecko en USD por unidad. La conversión a ARS la hace el cliente,
// una sola vez, con el MEP que la API informa aparte.
const CRIPTO = {
  bitcoin: { simbolo: 'BTC', nombre: 'Bitcoin' },
  tether: { simbolo: 'USDT', nombre: 'USDT (staking)' },
};

const DEF_NO_VERIFICADA = { unidadFuente: null, unidadApp: null, factor: null, moneda: null };

function armarId(proveedor, panel, clave) {
  return `${proveedor}:${panel}:${clave}`;
}

// El id es "proveedor:panel:clave"; la clave puede contener ":" (nombres de FCI).
function parsearId(id) {
  if (typeof id !== 'string') return null;
  const a = id.indexOf(':');
  const b = a < 0 ? -1 : id.indexOf(':', a + 1);
  if (a <= 0 || b <= a + 1 || b === id.length - 1) return null;
  return { proveedor: id.slice(0, a), panel: id.slice(a + 1, b), clave: id.slice(b + 1) };
}

// Posible variante en otra moneda (sufijo D o C con el símbolo base presente en el
// mismo panel). NO se asume que sea USD: solo se la excluye de "soportado".
function esPosibleVarianteMoneda(simbolo, simbolosPanel) {
  if (!/^[A-Z0-9]{3,}[DC]$/.test(simbolo)) return false;
  return simbolosPanel.has(simbolo.slice(0, -1));
}

function definirData912(panel, simbolo, simbolosPanel) {
  const p = PANELES_DATA912[panel];
  if (!p) return null;
  const base = {
    id: armarId('data912', panel, simbolo),
    simbolo,
    nombre: simbolo,
    tipo: p.tipo,
    fuente: { proveedor: 'data912', panel, clave: simbolo, campo: 'c' },
  };
  const variante = esPosibleVarianteMoneda(simbolo, simbolosPanel);
  if ((panel === 'arg_cedears' || panel === 'arg_stocks') && !variante) {
    return { ...base, unidadFuente: '1', unidadApp: '1', factor: 1, moneda: 'ARS', estado: 'soportado' };
  }
  if (panel === 'arg_bonds' && BONOS_VERIFICADOS.has(simbolo)) {
    return { ...base, unidadFuente: '100VN', unidadApp: '1VN', factor: 0.01, moneda: 'ARS', estado: 'soportado' };
  }
  return { ...base, ...DEF_NO_VERIFICADA, estado: 'sin-verificar' };
}

function definirFCI(categoria, fondo) {
  const base = {
    id: armarId('argentinadatos', categoria, fondo),
    simbolo: fondo,
    nombre: fondo,
    tipo: 'fci',
    fuente: { proveedor: 'argentinadatos', panel: categoria, clave: fondo, campo: 'vcp' },
  };
  if (FCI_VERIFICADOS.has(fondo)) {
    return { ...base, unidadFuente: '1000CP', unidadApp: '1CP', factor: 0.001, moneda: 'ARS', estado: 'soportado' };
  }
  return { ...base, ...DEF_NO_VERIFICADA, estado: 'sin-verificar' };
}

function definirCripto(coinId) {
  const c = CRIPTO[coinId];
  if (!c) return null;
  return {
    id: armarId('coingecko', 'simple', coinId),
    simbolo: c.simbolo,
    nombre: c.nombre,
    tipo: 'cripto',
    fuente: { proveedor: 'coingecko', panel: 'simple', clave: coinId, campo: 'usd' },
    unidadFuente: '1',
    unidadApp: '1',
    factor: 1,
    moneda: 'USD',
    conversion: { a: 'ARS', tipoCambio: 'MEP' },
    estado: 'soportado',
  };
}

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'mi-cartera-personal/1.0' } });
  if (!r.ok) throw new Error(`status ${r.status}`);
  return r.json();
}

const urlData912 = panel => `https://data912.com/live/${panel}`;
const urlFCI = categoria => `https://api.argentinadatos.com/v1/finanzas/fci/${categoria}/ultimo`;
const URL_MEP = 'https://dolarapi.com/v1/dolares/bolsa';
const urlCoingecko = ids => `https://api.coingecko.com/api/v3/simple/price?ids=${ids.map(encodeURIComponent).join(',')}&vs_currencies=usd`;

module.exports = {
  ESTADOS, PANELES_DATA912, CATEGORIAS_FCI, CRIPTO,
  armarId, parsearId, esPosibleVarianteMoneda,
  definirData912, definirFCI, definirCripto,
  fetchJSON, urlData912, urlFCI, URL_MEP, urlCoingecko,
};
