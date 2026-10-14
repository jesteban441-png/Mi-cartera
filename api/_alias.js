// Alias curados y búsqueda de instrumentos (Fase 2B).
// Se busca SOLO sobre el catálogo ya armado (símbolos, nombres y alias de esta
// tabla). No se consulta BYMA ni ninguna otra fuente durante la búsqueda.
//
// Reglas de los alias:
//  - Sirven únicamente para ENCONTRAR un instrumento. Nunca unifican dos
//    instrumentos distintos: GD38, GD38D y GD38C son resultados separados, y
//    "Clase A" y "Clase C" de un fondo también.
//  - Cada alias apunta a un id concreto (id del catálogo o id estable de FCI).
//    Si ese id no está en el catálogo, el alias simplemente no produce resultados.
//  - Un alias no implica que la cotización sea automática: eso lo dice
//    estadoOperativo de cada instrumento.

const ALIAS = [
  // Cripto
  { ref: 'coingecko:simple:bitcoin', alias: ['bitcoin', 'btc', 'bitcoin btc'] },
  { ref: 'coingecko:simple:tether', alias: ['usdt', 'tether', 'usdt staking', 'usdt (staking)'] },
  // Efectivo
  { ref: 'efectivo:ars:pesos', alias: ['pesos', 'efectivo', 'efectivo pesos', 'ars', 'pesos argentinos'] },
  // Bonos: A027 (con cero) es una forma habitual de escribir AO27 (con O).
  { ref: 'data912:arg_bonds:AO27', alias: ['A027'] },
  { ref: 'data912:arg_bonds:AO28', alias: ['A028'] },
  // ONs
  { ref: 'data912:arg_corp:YFCGO', alias: ['on ypf', 'ypf on', 'obligacion negociable ypf'] },
  { ref: 'data912:arg_corp:MGCEO', alias: ['on pampa', 'pampa on', 'obligacion negociable pampa'] },
  // Acciones y CEDEARs de nombre conocido (solo aparecen si el símbolo existe en el catálogo)
  { ref: 'data912:arg_stocks:GGAL', alias: ['galicia', 'grupo financiero galicia'] },
  { ref: 'data912:arg_stocks:YPFD', alias: ['ypf', 'ypf acciones'] },
  { ref: 'data912:arg_cedears:MELI', alias: ['mercado libre', 'mercadolibre'] },
  { ref: 'data912:arg_cedears:AAPL', alias: ['apple'] },
  { ref: 'data912:arg_cedears:MSFT', alias: ['microsoft'] },
  { ref: 'data912:arg_cedears:SPY', alias: ['sp500 spy', 'spdr sp500'] },
  { ref: 'data912:arg_cedears:IVV', alias: ['ishares sp500', 'ishares core sp500'] },
  { ref: 'data912:arg_cedears:XLK', alias: ['sector tecnologia', 'technology select sector'] },
  { ref: 'data912:arg_cedears:VEA', alias: ['vanguard desarrollados', 'vanguard ftse developed'] },
  { ref: 'data912:arg_cedears:GLD', alias: ['oro gld', 'spdr gold'] },
  // FCI: SCRTAPA es el código con que el broker muestra Schroder Renta Plus - Clase A.
  { ref: 'fci:schroder-renta-plus-clase-a', alias: ['SCRTAPA', 'schroder renta plus', 'schroder'] },
  { ref: 'fci:mp-ahorro-clase-a', alias: ['mp ahorro', 'mercado pago ahorro'] },
  { ref: 'fci:mp-empresas-argentinas-clase-a', alias: ['mp empresas argentinas', 'mercado pago empresas argentinas'] },
];

// Minúsculas, sin acentos, solo letras y números separados por un espacio.
function normalizarTexto(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(s) {
  const n = normalizarTexto(s);
  return n ? n.split(' ') : [];
}

// ¿Todos los tokens de la consulta aparecen en el texto? Un token de 2 o más
// letras puede ser prefijo de una palabra (mientras se escribe); una letra suelta
// ("A", "C" de "Clase A" / "Clase C") solo coincide con la palabra exacta, para
// que "clase c" no traiga también la clase A.
function coincidenTodos(tokensConsulta, tokensTexto) {
  return tokensConsulta.length > 0 && tokensConsulta.every(q => tokensTexto.some(t => (q.length === 1 ? t === q : t.startsWith(q))));
}

const ORDEN_TIPO = { cripto: 0, efectivo: 1, accion: 2, cedear: 3, bono: 4, on: 5, letra: 6, fci: 7 };

function aliasPorRef() {
  const m = new Map();
  ALIAS.forEach(a => m.set(a.ref, a.alias));
  return m;
}

// Busca en `instrumentos` (el arreglo que arma /api/catalogo). Devuelve a lo
// sumo `limite` resultados ordenados por calidad de coincidencia.
function buscarInstrumentos(texto, instrumentos, limite) {
  const q = normalizarTexto(texto);
  if (!q || !Array.isArray(instrumentos)) return [];
  const max = Number.isInteger(limite) && limite > 0 ? Math.min(limite, 100) : 20;
  const tq = q.split(' ');
  const alias = aliasPorRef();
  const out = [];

  instrumentos.forEach(inst => {
    if (!inst) return;
    const sim = normalizarTexto(inst.simbolo);
    const nom = normalizarTexto(inst.nombre);
    const lista = (alias.get(inst.id) || []).concat(inst.idEstable ? alias.get(inst.idEstable) || [] : []);
    const alN = lista.map(normalizarTexto);

    let puntaje = 0;
    let por = null;
    let aliasUsado = null;
    const sube = (p, motivo, al) => { if (p > puntaje) { puntaje = p; por = motivo; aliasUsado = al || null; } };

    if (sim === q) sube(100, 'simbolo');
    alN.forEach((a, i) => { if (a === q) sube(90, 'alias', lista[i]); });
    if (nom === q) sube(80, 'nombre');
    if (sim.startsWith(q)) sube(70, 'simbolo');
    alN.forEach((a, i) => { if (a.startsWith(q)) sube(60, 'alias', lista[i]); else if (coincidenTodos(tq, a.split(' '))) sube(45, 'alias', lista[i]); });
    if (nom.startsWith(q)) sube(55, 'nombre');
    if (coincidenTodos(tq, nom.split(' '))) sube(50, 'nombre');
    if (tq.length === 1 && q.length >= 3 && (sim.includes(q) || nom.includes(q))) sube(30, 'nombre');

    if (!puntaje) return;
    // Las variantes de moneda (GD38D) aparecen después de su instrumento base.
    if (inst.posibleVarianteDe) puntaje -= 5;
    const r = {
      id: inst.id,
      simbolo: inst.simbolo,
      nombre: inst.nombre,
      tipo: inst.tipo,
      categoria: inst.categoria,
      estadoOperativo: inst.estadoOperativo,
      validacion: inst.validacion,
      coincidencia: por,
      _p: puntaje,
    };
    if (inst.idEstable) r.idEstable = inst.idEstable;
    if (inst.subcategoria) r.subcategoria = inst.subcategoria;
    if (inst.posibleVarianteDe) r.posibleVarianteDe = inst.posibleVarianteDe;
    if (aliasUsado && por === 'alias') r.aliasUsado = aliasUsado;
    out.push(r);
  });

  out.sort((a, b) => {
    if (b._p !== a._p) return b._p - a._p;
    const aa = a.estadoOperativo === 'AUTOMATICO' ? 0 : 1;
    const bb = b.estadoOperativo === 'AUTOMATICO' ? 0 : 1;
    if (aa !== bb) return aa - bb;
    const ta = ORDEN_TIPO[a.tipo] === undefined ? 99 : ORDEN_TIPO[a.tipo];
    const tb = ORDEN_TIPO[b.tipo] === undefined ? 99 : ORDEN_TIPO[b.tipo];
    if (ta !== tb) return ta - tb;
    return String(a.nombre).localeCompare(String(b.nombre));
  });
  return out.slice(0, max).map(r => { const { _p, ...resto } = r; return resto; });
}

module.exports = { ALIAS, normalizarTexto, buscarInstrumentos };
