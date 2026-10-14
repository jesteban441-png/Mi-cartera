// Definición de instrumentos del motor de precios genérico (Fase 5A + Fase 2B).
// Lo usan /api/catalogo (para describir cada instrumento) y /api/precios (para
// saber de dónde sacar el precio crudo de un id). El archivo empieza con "_" para
// que Vercel no lo publique como ruta.
//
// Regla de oro: acá NO se inventan factores ni monedas. Un instrumento queda en
// cotización AUTOMÁTICA solo si existe evidencia registrada de que su regla de
// conversión (unidad, factor y moneda) es correcta. Todo lo demás queda MANUAL.
//
// ---------------------------------------------------------------------------
// MODELO DE VALIDACIÓN (Fase 2B)
//
// Hay tres cosas separadas:
//   1. factorEstado (confianza en la conversión): CONFIRMADO | CONTRASTADO | PENDIENTE
//        CONFIRMADO  = la propia fuente documenta la unidad (o es inequívoca).
//        CONTRASTADO = dos cifras independientes coinciden (diferencia <= 3 %).
//        PENDIENTE   = sin evidencia suficiente.
//   2. estadoOperativo (lo que ve el usuario): AUTOMATICO | MANUAL
//        AUTOMATICO solo si factorEstado != PENDIENTE y están completos
//        unidad, factor y moneda. Nunca depende de la categoría por sí sola.
//   3. validacion (por qué):
//        validado          = regla y evidencia suficientes.
//        pendiente         = existe fuente compatible, falta validación técnica.
//        manual-sin-fuente = no existe cotización posible (p. ej. efectivo).
//
// Las reglas se definen por TIPO de instrumento y PROVEEDOR (REGLAS). Una regla
// vale para toda su clase cuando acumula evidencia suficiente (documentación de
// la fuente, o contrastes de al menos MIN_INSTRUMENTOS_POR_REGLA instrumentos
// distintos). Mientras no alcance ese umbral, solo los instrumentos con
// evidencia propia quedan validados. La evidencia individual se conserva.
// ---------------------------------------------------------------------------

const ESTADOS = ['soportado', 'sin-verificar', 'solo-manual']; // campo heredado (5A)
const FACTOR_ESTADOS = ['CONFIRMADO', 'CONTRASTADO', 'PENDIENTE'];
const ESTADOS_OPERATIVOS = ['AUTOMATICO', 'MANUAL'];
const VALIDACIONES = ['validado', 'pendiente', 'manual-sin-fuente'];
const UMBRAL_DIFERENCIA_PCT = 3;
const MIN_INSTRUMENTOS_POR_REGLA = 3;

// Paneles de data912 que usa la app. `tipo` es descriptivo.
const PANELES_DATA912 = {
  arg_cedears: { tipo: 'cedear', categoria: 'cedears', label: 'CEDEARs' },
  arg_stocks: { tipo: 'accion', categoria: 'acciones', label: 'Acciones argentinas' },
  arg_bonds: { tipo: 'bono', categoria: 'bonos', label: 'Bonos argentinos' },
  arg_corp: { tipo: 'on', categoria: 'obligaciones', label: 'Obligaciones negociables' },
  arg_notes: { tipo: 'letra', categoria: 'notas', label: 'Notas / letras' },
};

const CATEGORIAS_FCI = ['mercadoDinero', 'rentaVariable', 'rentaFija', 'rentaMixta', 'retornoTotal', 'otros'];

// Cripto: CoinGecko en USD por unidad. La conversión a ARS la hace el cliente,
// una sola vez, con el MEP que la API informa aparte.
const CRIPTO = {
  bitcoin: { simbolo: 'BTC', nombre: 'Bitcoin' },
  tether: { simbolo: 'USDT', nombre: 'USDT (staking)' },
};

const DEF_NO_VERIFICADA = { unidadFuente: null, unidadApp: null, factor: null, moneda: null };

// ---------------------------------------------------------------------------
// Reglas por tipo de instrumento y proveedor.
//
// evidencia[]: solo lo que CUENTA para validar.
//   { tipo: 'documentacion', instrumento: null|clave, fuenteDoc, detalle, fecha }
//   { tipo: 'contraste', instrumento: clave, a: {fuente, valor|min,max},
//     b: {fuente, valor|min,max}, fecha, limite }       (diferencia calculada)
// observaciones[]: datos sueltos que NO cuentan (una sola fuente, sin contraste).
// ---------------------------------------------------------------------------
const FECHA_AUDITORIA = '2026-10-12';

// Convención de conversión que comparten una regla y toda su evidencia. Una
// evidencia solo cuenta para una regla si declara EXACTAMENTE esta misma convención
// (proveedor, panel, moneda de cotización, unidad de origen, unidad de la app y
// factor). Así, cambiar el factor de una regla invalida la evidencia anterior, y
// la evidencia de un mercado, moneda o unidad distintos no se mezcla.
const CAMPOS_CONVENCION = ['proveedor', 'panel', 'moneda', 'unidadFuente', 'unidadApp', 'factor'];

// Patrón de ticker que PUEDE ser una variante de moneda (sufijo D o C). Para la
// herencia por clase se descarta aunque la base no figure en el panel: no se
// asume que un ticker que termina en D/C cotice en pesos.
const PATRON_POSIBLE_VARIANTE = /^[A-Z0-9]{2,}[DC]$/; // 3 letras o más, terminado en D o C (GLD, AMD, KOD...)
const noVariante = (clave, ctx) => !esPosibleVarianteMoneda(clave, (ctx && ctx.simbolosPanel) || new Set());
const noSufijoMoneda = clave => !PATRON_POSIBLE_VARIANTE.test(clave);

const CONV_BONOS_ARS = { proveedor: 'data912', panel: 'arg_bonds', moneda: 'ARS', unidadFuente: '100VN', unidadApp: '1VN', factor: 0.01 };
const CONV_CEDEARS_ARS = { proveedor: 'data912', panel: 'arg_cedears', moneda: 'ARS', unidadFuente: '1', unidadApp: '1', factor: 1 };
const CONV_ACCIONES_ARS = { proveedor: 'data912', panel: 'arg_stocks', moneda: 'ARS', unidadFuente: '1', unidadApp: '1', factor: 1 };

const REGLAS = {
  'cripto-coingecko-usd': {
    id: 'cripto-coingecko-usd',
    descripcion: 'Criptomonedas: CoinGecko /simple/price informa el precio de 1 unidad de la moneda en USD; se convierte a ARS con el MEP.',
    tipo: 'cripto', proveedor: 'coingecko', panel: 'simple',
    unidadFuente: '1', unidadApp: '1', factor: 1, moneda: 'USD',
    conversion: { a: 'ARS', tipoCambio: 'MEP' },
    alcance: clave => Object.prototype.hasOwnProperty.call(CRIPTO, clave),
    evidencia: [
      {
        tipo: 'documentacion', instrumento: null, fecha: FECHA_AUDITORIA,
        convencion: { proveedor: 'coingecko', panel: 'simple', moneda: 'USD', unidadFuente: '1', unidadApp: '1', factor: 1 },
        fuenteDoc: 'CoinGecko API v3 /simple/price',
        detalle: 'El endpoint devuelve el precio de una unidad de la moneda en la divisa pedida (vs_currencies=usd). La unidad es inequívoca: 1 moneda.',
      },
    ],
    observaciones: [
      { instrumento: 'bitcoin', detalle: 'Producción 2026-10-12: 81.311 USD (MEP 1.539,4).' },
      { instrumento: 'tether', detalle: 'Producción 2026-10-12: 0,999181 USD (coherente con una moneda estable).' },
    ],
  },

  // Bonos soberanos: UNA regla por familia. Familias distintas pueden tener
  // convenciones distintas (ajuste por CER, moneda de emisión, etc.), así que la
  // evidencia de una familia no habilita a otra. Los patrones exigen terminar en
  // dos dígitos: las variantes con sufijo de moneda (AL29D, GD38C...) y las
  // letras quedan fuera por construcción.
  'bonos-al-gd-data912-ars': {
    id: 'bonos-al-gd-data912-ars',
    descripcion: 'Bonos de las familias AL y GD en data912 arg_bonds: precio en ARS cada 100 VN; el valor por 1 VN es precio / 100.',
    tipo: 'bono', proveedor: 'data912', panel: 'arg_bonds', familia: 'AL/GD', ...CONV_BONOS_ARS,
    alcance: clave => /^(AL|GD)\d{2}$/.test(clave),
    evidencia: [
      {
        tipo: 'contraste', instrumento: 'AL29', fecha: FECHA_AUDITORIA, convencion: { ...CONV_BONOS_ARS },
        a: { fuente: 'data912 arg_bonds (rango observado)', min: 82930, max: 84280 },
        b: { fuente: 'BYMA datos abiertos', valor: 83140 },
        limite: 'Las dos fuentes coinciden en el valor; ninguna declara la unidad. La relación 100 VN -> 1 VN sigue la convención de cotización de bonos soberanos.',
      },
      {
        tipo: 'contraste', instrumento: 'GD38', fecha: FECHA_AUDITORIA, convencion: { ...CONV_BONOS_ARS },
        a: { fuente: 'data912 arg_bonds', valor: 123840 },
        b: { fuente: 'BYMA datos abiertos', valor: 121000 },
        limite: 'Diferencia del 2,3 % compatible con distinto horario o puntas. Ninguna fuente declara la unidad.',
      },
    ],
    observaciones: [],
  },

  'bonos-ao-data912-ars': {
    id: 'bonos-ao-data912-ars',
    descripcion: 'Bonos de la familia AO en data912 arg_bonds (hipótesis cada 100 VN, sin validar). No hereda evidencia de otras familias.',
    tipo: 'bono', proveedor: 'data912', panel: 'arg_bonds', familia: 'AO', ...CONV_BONOS_ARS,
    alcance: clave => /^AO\d{2}$/.test(clave),
    evidencia: [],
    observaciones: [
      { instrumento: 'AO27', detalle: 'Solo cifra de BYMA (158.320); falta la de data912 del mismo momento. No cuenta.' },
      { instrumento: 'AO28', detalle: 'Sin cifras individuales registradas.' },
    ],
  },

  'bonos-tx-data912-ars': {
    id: 'bonos-tx-data912-ars',
    descripcion: 'Bonos de la familia TX en data912 arg_bonds (hipótesis cada 100 VN, sin validar; su convención puede diferir). No hereda evidencia de otras familias.',
    tipo: 'bono', proveedor: 'data912', panel: 'arg_bonds', familia: 'TX', ...CONV_BONOS_ARS,
    alcance: clave => /^TX\d{2}$/.test(clave),
    evidencia: [],
    observaciones: [
      { instrumento: 'TX28', detalle: 'Sin cifras individuales registradas.' },
    ],
  },

  // Para CEDEARs y acciones, `alcance` excluye las variantes de moneda conocidas
  // y `alcanceClase` (lo que puede heredarse SIN evidencia propia) es más estricto:
  // excluye cualquier ticker que termine en D o C, aunque su base no figure.
  'cedears-data912-ars': {
    id: 'cedears-data912-ars',
    descripcion: 'CEDEARs en data912 arg_cedears: precio en ARS por CEDEAR (hipótesis, sin validar).',
    tipo: 'cedear', proveedor: 'data912', panel: 'arg_cedears', ...CONV_CEDEARS_ARS,
    alcance: noVariante,
    alcanceClase: noSufijoMoneda,
    evidencia: [],
    observaciones: [
      { instrumento: 'SPY', detalle: 'Una sola fuente (data912): 20.600 a 20.860. No cuenta.' },
      { instrumento: 'IVV', detalle: 'Una sola fuente (data912): 1.817 a 1.827. No cuenta.' },
      { instrumento: 'XLK', detalle: 'Una sola fuente (ruta vieja): 7.075. No cuenta.' },
      { instrumento: 'VEA', detalle: 'Una sola fuente (ruta vieja): 11.540. No cuenta.' },
    ],
  },

  'acciones-data912-ars': {
    id: 'acciones-data912-ars',
    descripcion: 'Acciones argentinas en data912 arg_stocks: precio en ARS por acción (hipótesis, sin validar).',
    tipo: 'accion', proveedor: 'data912', panel: 'arg_stocks', ...CONV_ACCIONES_ARS,
    alcance: noVariante,
    alcanceClase: noSufijoMoneda,
    evidencia: [],
    observaciones: [
      { instrumento: 'GGAL', detalle: 'Una sola fuente (data912): 5.840 a 6.000. No cuenta.' },
    ],
  },

  // FCI: la regla nunca valida una clase completa. Cada fondo necesita
  // confirmar fondo, clase, moneda y unidad (identidad por instrumento). Su
  // convención varía por fondo (panel = categoría, moneda = la del fondo).
  'fci-argentinadatos-vcp': {
    id: 'fci-argentinadatos-vcp',
    descripcion: 'FCI en ArgentinaDatos: vcp cada 1000 cuotapartes (convención CAFCI). Cada fondo requiere confirmar fondo, clase, moneda y unidad.',
    tipo: 'fci', proveedor: 'argentinadatos', panel: null,
    unidadFuente: '1000CP', unidadApp: '1CP', factor: 0.001, moneda: null,
    exigeIdentidadPorInstrumento: true,
    alcance: () => true,
    evidencia: [],
    observaciones: [],
  },
};

// Qué reglas le tocan a cada panel de data912, en orden: se usa la primera cuyo
// `alcance` incluya el símbolo. Lo que ninguna incluye (ONs, letras, variantes...)
// queda pendiente.
const REGLAS_POR_PANEL_DATA912 = {
  arg_cedears: ['cedears-data912-ars'],
  arg_stocks: ['acciones-data912-ars'],
  arg_bonds: ['bonos-al-gd-data912-ars', 'bonos-ao-data912-ars', 'bonos-tx-data912-ars'],
};

// Notas de casos especiales (se muestran como `nota` en el catálogo).
const NOTAS = {
  'data912:arg_corp:YFCGO': 'ON de YPF (no es CEDEAR). data912 informa ~158.200 mientras IOL muestra 1.586,90: relación 100 a 1 compatible con cotización cada 100 VN, pero NO confirmada. La posición actual está cargada por unidad. Se mantiene MANUAL.',
  'data912:arg_corp:MGCEO': 'ON de Pampa. data912 informa 145.020 a 147.000. La posición actual está cargada en lotes de 100 VN (0,13). La convención de cantidad se decide en Fase 3. Se mantiene MANUAL.',
  'fci:schroder-renta-plus-clase-a': 'Alias de broker SCRTAPA. Falta confirmar fondo, clase, moneda y unidad. Chequeo: valor en el broker / cuotapartes debería dar ~ vcp/1000.',
  'fci:mp-ahorro-clase-a': 'Falta confirmar fondo, clase, moneda y unidad. Chequeo: valor en el broker / cuotapartes debería dar ~ vcp/1000.',
  'fci:mp-empresas-argentinas-clase-a': 'Falta confirmar fondo, clase, moneda y unidad. Chequeo: valor en el broker / cuotapartes debería dar ~ vcp/1000.',
};

// ---------------------------------------------------------------------------
// Evidencia
// ---------------------------------------------------------------------------
function rangoDe(x) {
  if (x && Number.isFinite(x.valor)) return [x.valor, x.valor];
  if (x && Number.isFinite(x.min) && Number.isFinite(x.max)) return [x.min, x.max];
  return null;
}

// Mayor diferencia porcentual entre las dos cifras (o rangos), tomando la
// segunda como base. null si falta algún dato o hay valores no positivos.
function diferenciaMaxPct(e) {
  if (!e) return null;
  const ra = rangoDe(e.a);
  const rb = rangoDe(e.b);
  if (!ra || !rb) return null;
  let max = 0;
  for (const x of ra) {
    for (const y of rb) {
      if (!(x > 0) || !(y > 0)) return null;
      max = Math.max(max, (Math.abs(x - y) / y) * 100);
    }
  }
  return max;
}

function convencionDe(r) {
  const o = {};
  CAMPOS_CONVENCION.forEach(k => { o[k] = r[k]; });
  return o;
}

function mismaConvencion(a, b) {
  return !!a && !!b && typeof a === 'object' && typeof b === 'object' && CAMPOS_CONVENCION.every(k => a[k] === b[k]);
}

// '100VN' -> { n: 100, sufijo: 'VN' }; '1' -> { n: 1, sufijo: '' }
function cantidadUnidad(u) {
  const m = /^(\d+(?:\.\d+)?)([A-Z]*)$/.exec(typeof u === 'string' ? u : '');
  return m ? { n: Number(m[1]), sufijo: m[2] } : null;
}

// El factor debe ser coherente con las unidades: factor = unidadApp / unidadFuente.
// Una regla incoherente nunca habilita nada.
function reglaConsistente(r) {
  if (!r || !Number.isFinite(r.factor) || !(r.factor > 0)) return false;
  const f = cantidadUnidad(r.unidadFuente);
  const a = cantidadUnidad(r.unidadApp);
  return !!f && !!a && f.sufijo === a.sufijo && f.n > 0 && Math.abs(a.n / f.n - r.factor) < 1e-12;
}

// ¿La clave puede heredar la regla por clase (sin evidencia propia)?
function puedeHeredar(regla, clave, ctx) {
  return !!regla && regla.alcance(clave, ctx) && (!regla.alcanceClase || regla.alcanceClase(clave, ctx));
}

// Una evidencia solo cuenta si (1) está completa, (2) declara EXACTAMENTE la
// convención de la regla y (3) se refiere a un instrumento que la regla describe.
// Evidencia de una variante, de otra familia o de otro panel no cuenta.
function evidenciaValida(e, regla, ctx) {
  if (!e || typeof e !== 'object' || !regla) return false;
  if (e.instrumento != null && (typeof e.instrumento !== 'string' || !regla.alcance(e.instrumento, ctx))) return false;
  if (regla.exigeIdentidadPorInstrumento) {
    // FCI: la convención se fija por fondo (categoría y moneda propias); lo demás debe coincidir.
    const c = e.convencion;
    const i = e.identidad;
    if (!c || !i || e.tipo !== 'contraste') return false;
    if (!(c.proveedor === regla.proveedor && c.unidadFuente === regla.unidadFuente && c.unidadApp === regla.unidadApp && c.factor === regla.factor)) return false;
    if (!CATEGORIAS_FCI.includes(c.panel) || (ctx && ctx.categoria && c.panel !== ctx.categoria)) return false;
    if (!(i.fondo === true && i.clase === true && i.moneda === true && i.unidad === true)) return false;
    if (typeof i.monedaValor !== 'string' || !i.monedaValor || c.moneda !== i.monedaValor) return false;
  } else if (!mismaConvencion(e.convencion, convencionDe(regla))) {
    return false;
  }
  if (e.tipo === 'documentacion') {
    return typeof e.detalle === 'string' && e.detalle.length > 0 && typeof e.fuenteDoc === 'string' && e.fuenteDoc.length > 0;
  }
  if (e.tipo === 'contraste') {
    if (typeof e.instrumento !== 'string' || !e.instrumento) return false;
    const d = diferenciaMaxPct(e);
    return d !== null && d <= UMBRAL_DIFERENCIA_PCT;
  }
  return false;
}

// Resuelve la confianza del factor para una clave dentro de una regla.
// Devuelve { factorEstado, origen: 'instrumento'|'regla'|null, evidencia: [] }.
function resolverFactor(regla, clave, ctx) {
  const pendiente = { factorEstado: 'PENDIENTE', origen: null, evidencia: [] };
  if (!regla || !reglaConsistente(regla)) return pendiente;
  const validas = (regla.evidencia || []).filter(e => evidenciaValida(e, regla, ctx));
  const propias = validas.filter(e => e.instrumento === clave);
  if (propias.length) {
    return { factorEstado: propias.some(e => e.tipo === 'documentacion') ? 'CONFIRMADO' : 'CONTRASTADO', origen: 'instrumento', evidencia: propias };
  }
  if (regla.exigeIdentidadPorInstrumento) return pendiente;
  if (!puedeHeredar(regla, clave, ctx)) return pendiente;
  const doc = validas.filter(e => e.tipo === 'documentacion' && !e.instrumento);
  if (doc.length) return { factorEstado: 'CONFIRMADO', origen: 'regla', evidencia: doc };
  // Solo cuentan para la clase los contrastes de instrumentos que a su vez pueden heredarla.
  const contrastes = validas.filter(e => e.tipo === 'contraste' && puedeHeredar(regla, e.instrumento, ctx));
  const distintos = new Set(contrastes.map(e => e.instrumento));
  if (distintos.size >= MIN_INSTRUMENTOS_POR_REGLA) return { factorEstado: 'CONTRASTADO', origen: 'regla', evidencia: contrastes };
  return pendiente;
}

// ¿La regla vale para toda su clase? (independiente de un instrumento puntual)
function reglaValidadaParaClase(regla, ctx) {
  if (!regla || regla.exigeIdentidadPorInstrumento || !reglaConsistente(regla)) return false;
  const c = ctx || { simbolosPanel: new Set() };
  const validas = (regla.evidencia || []).filter(e => evidenciaValida(e, regla, c));
  if (validas.some(e => e.tipo === 'documentacion' && !e.instrumento)) return true;
  const distintos = new Set(validas.filter(e => e.tipo === 'contraste' && puedeHeredar(regla, e.instrumento, c)).map(e => e.instrumento));
  return distintos.size >= MIN_INSTRUMENTOS_POR_REGLA;
}

function resumirEvidencia(e) {
  const d = diferenciaMaxPct(e);
  const out = { tipo: e.tipo, fecha: e.fecha || null };
  if (e.instrumento) out.instrumento = e.instrumento;
  if (e.tipo === 'contraste') {
    out.fuentes = [e.a && e.a.fuente, e.b && e.b.fuente];
    out.difMaxPct = d === null ? null : Math.round(d * 100) / 100;
  } else {
    out.fuenteDoc = e.fuenteDoc;
  }
  if (e.limite) out.limite = e.limite;
  return out;
}

function resumenReglas() {
  return Object.keys(REGLAS).map(k => {
    const r = REGLAS[k];
    const validas = (r.evidencia || []).filter(e => evidenciaValida(e, r, { simbolosPanel: new Set() }));
    return {
      id: r.id,
      familia: r.familia || null,
      consistente: reglaConsistente(r),
      tipo: r.tipo,
      proveedor: r.proveedor,
      panel: r.panel,
      validadaParaClase: reglaValidadaParaClase(r),
      instrumentosConEvidencia: [...new Set(validas.filter(e => e.instrumento).map(e => e.instrumento))],
      evidenciasValidas: validas.length,
      minimoInstrumentosParaClase: r.exigeIdentidadPorInstrumento ? null : MIN_INSTRUMENTOS_POR_REGLA,
      porInstrumento: !!r.exigeIdentidadPorInstrumento,
    };
  });
}

// Arma la definición común: aplica la regla (si corresponde y si la clave está en
// su alcance) y deriva factorEstado, estadoOperativo y validacion.
function armarDefinicion(base, regla, clave, ctx) {
  const enAlcance = !!regla && regla.alcance(clave, ctx);
  const r = enAlcance ? resolverFactor(regla, clave, ctx) : { factorEstado: 'PENDIENTE', origen: null, evidencia: [] };
  let moneda = enAlcance ? regla.moneda : null;
  if (enAlcance && !moneda && r.evidencia[0] && r.evidencia[0].identidad && r.evidencia[0].identidad.monedaValor) {
    moneda = r.evidencia[0].identidad.monedaValor;
  }
  const completo = enAlcance && reglaConsistente(regla) && !!moneda;
  const automatico = r.factorEstado !== 'PENDIENTE' && completo;
  // Para no engordar el catálogo, `regla` y `evidenciaOrigen` solo figuran cuando existen.
  const out = {
    ...base,
    factorEstado: automatico ? r.factorEstado : 'PENDIENTE',
    estadoOperativo: automatico ? 'AUTOMATICO' : 'MANUAL',
    validacion: automatico ? 'validado' : 'pendiente',
  };
  if (enAlcance) out.regla = regla.id;
  if (automatico) out.evidenciaOrigen = r.origen;
  if (automatico) {
    Object.assign(out, { unidadFuente: regla.unidadFuente, unidadApp: regla.unidadApp, factor: regla.factor, moneda, estado: 'soportado' });
    if (regla.conversion) out.conversion = regla.conversion;
    if (r.origen === 'instrumento') out.evidencia = r.evidencia.map(resumirEvidencia);
  } else {
    Object.assign(out, DEF_NO_VERIFICADA, { estado: 'sin-verificar' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------
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
// mismo panel). NO se asume que sea USD: solo se la excluye de la validación.
function esPosibleVarianteMoneda(simbolo, simbolosPanel) {
  if (!/^[A-Z0-9]{2,}[DC]$/.test(simbolo)) return false;
  return simbolosPanel.has(simbolo.slice(0, -1));
}

// ---------------------------------------------------------------------------
// FCI: ids estables PROVISIONALES + asociaciones explícitas
// ---------------------------------------------------------------------------
// El id estable se deriva del nombre exacto del fondo (incluida la clase), sin
// depender de la categoría de ArgentinaDatos. Es provisional: cuando se pueda
// verificar un identificador oficial (CNV / fondoId) se reemplaza, y este
// seguirá aceptándose como equivalencia.
function slugFCI(nombre) {
  return String(nombre == null ? '' : nombre)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function idEstableFCI(nombre) {
  const s = slugFCI(nombre);
  return s ? `fci:${s}` : null;
}

function idLegacyFCI(categoria, nombre) {
  return armarId('argentinadatos', categoria, nombre);
}

// Asociaciones EXPLÍCITAS: id estable <-> categoría <-> nombre exacto <-> fuente.
// Un id `fci:...` solo se resuelve si figura acá. No se buscan fondos recorriendo
// categorías. `pendiente` lista lo que todavía no se verificó (todo, por ahora).
const FCI_ASOCIACIONES = [
  {
    idEstable: 'fci:schroder-renta-plus-clase-a', fuente: 'argentinadatos', categoria: 'rentaFija',
    nombreExacto: 'Schroder Renta Plus - Clase A', pendiente: ['fondo', 'clase', 'moneda', 'unidad'],
  },
  {
    idEstable: 'fci:mp-ahorro-clase-a', fuente: 'argentinadatos', categoria: 'rentaFija',
    nombreExacto: 'MP Ahorro - Clase A', pendiente: ['fondo', 'clase', 'moneda', 'unidad'],
  },
  {
    idEstable: 'fci:mp-empresas-argentinas-clase-a', fuente: 'argentinadatos', categoria: 'rentaVariable',
    nombreExacto: 'MP Empresas Argentinas - Clase A', pendiente: ['fondo', 'clase', 'moneda', 'unidad'],
  },
];

function asociacionFCIPorNombre(categoria, nombre) {
  return FCI_ASOCIACIONES.find(a => a.categoria === categoria && a.nombreExacto === nombre) || null;
}

// null si no es un id estable (empieza distinto de "fci:"); { error } si lo es
// pero no está asociado; { idInterno, asociacion } si se puede resolver.
function resolverIdFCI(id) {
  if (typeof id !== 'string' || !id.startsWith('fci:')) return null;
  const a = FCI_ASOCIACIONES.find(x => x.idEstable === id);
  if (!a) return { error: 'fci sin asociación explícita (usar el id con categoría)' };
  return { idInterno: idLegacyFCI(a.categoria, a.nombreExacto), asociacion: a };
}

// Detecta ids estables repetidos entre fondos DISTINTOS (otra categoría u otro
// nombre exacto). Nunca se fusionan: el que colisiona pierde el id estable.
function detectarColisionesFCI(fondos) {
  const porSlug = new Map();
  (fondos || []).forEach(f => {
    const id = idEstableFCI(f && f.nombre);
    if (!id) return;
    const clave = `${f.categoria}\u0000${f.nombre}`;
    if (!porSlug.has(id)) porSlug.set(id, new Map());
    porSlug.get(id).set(clave, { categoria: f.categoria, nombre: f.nombre });
  });
  const colisiones = {};
  porSlug.forEach((m, id) => { if (m.size > 1) colisiones[id] = [...m.values()]; });
  return colisiones;
}

// Chequeo de consistencia de la tabla de asociaciones (lo corren las pruebas).
function validarAsociacionesFCI() {
  const errores = [];
  const ids = new Set();
  const nombres = new Set();
  FCI_ASOCIACIONES.forEach(a => {
    if (a.idEstable !== idEstableFCI(a.nombreExacto)) errores.push(`${a.nombreExacto}: idEstable no coincide con el nombre`);
    if (!CATEGORIAS_FCI.includes(a.categoria)) errores.push(`${a.nombreExacto}: categoría desconocida`);
    if (ids.has(a.idEstable)) errores.push(`${a.idEstable}: id repetido`);
    const k = `${a.categoria}\u0000${a.nombreExacto}`;
    if (nombres.has(k)) errores.push(`${a.nombreExacto}: asociación repetida`);
    ids.add(a.idEstable);
    nombres.add(k);
  });
  const col = detectarColisionesFCI(FCI_ASOCIACIONES.map(a => ({ categoria: a.categoria, nombre: a.nombreExacto })));
  Object.keys(col).forEach(id => errores.push(`${id}: colisión entre fondos distintos`));
  return errores;
}

// ---------------------------------------------------------------------------
// Definiciones por proveedor
// ---------------------------------------------------------------------------
function definirData912(panel, simbolo, simbolosPanel) {
  const p = PANELES_DATA912[panel];
  if (!p) return null;
  const id = armarId('data912', panel, simbolo);
  const base = {
    id,
    simbolo,
    nombre: simbolo,
    tipo: p.tipo,
    categoria: p.categoria,
    fuente: { proveedor: 'data912', panel, clave: simbolo, campo: 'c' },
  };
  const panelSimbolos = simbolosPanel || new Set();
  if (esPosibleVarianteMoneda(simbolo, panelSimbolos)) base.posibleVarianteDe = simbolo.slice(0, -1);
  if (NOTAS[id]) base.nota = NOTAS[id];
  const ctx = { simbolosPanel: panelSimbolos };
  const regla = (REGLAS_POR_PANEL_DATA912[panel] || []).map(id => REGLAS[id]).find(r => r.alcance(simbolo, ctx)) || null;
  return armarDefinicion(base, regla, simbolo, ctx);
}

function definirFCI(categoria, fondo) {
  const idEstable = idEstableFCI(fondo);
  const idLegacy = idLegacyFCI(categoria, fondo);
  const base = {
    id: idLegacy, // el id de siempre (con categoría); se conserva tal cual
    idEstable,
    simbolo: fondo,
    nombre: fondo,
    tipo: 'fci',
    categoria: 'fci',
    subcategoria: categoria,
    fuente: { proveedor: 'argentinadatos', panel: categoria, clave: fondo, campo: 'vcp' },
  };
  const asoc = asociacionFCIPorNombre(categoria, fondo);
  if (asoc) {
    base.asociacionExplicita = true;
    base.equivalencias = [idLegacy]; // ids con los que se puede pedir este mismo fondo
    base.verificacionPendiente = asoc.pendiente.slice();
    if (NOTAS[asoc.idEstable]) base.nota = NOTAS[asoc.idEstable];
  }
  return armarDefinicion(base, REGLAS['fci-argentinadatos-vcp'], fondo, { categoria });
}

function definirCripto(coinId) {
  const c = CRIPTO[coinId];
  if (!c) return null;
  const base = {
    id: armarId('coingecko', 'simple', coinId),
    simbolo: c.simbolo,
    nombre: c.nombre,
    tipo: 'cripto',
    categoria: 'cripto',
    fuente: { proveedor: 'coingecko', panel: 'simple', clave: coinId, campo: 'usd' },
  };
  return armarDefinicion(base, REGLAS['cripto-coingecko-usd'], coinId, {});
}

// Efectivo: no cotiza. Existe como instrumento para poder buscarlo y asignarle
// plataforma, pero nunca tiene fuente de precio.
const EFECTIVO = { pesos: { simbolo: 'ARS', nombre: 'Pesos', moneda: 'ARS' } };

function definirEfectivo(clave) {
  const e = EFECTIVO[clave];
  if (!e) return null;
  return {
    id: armarId('efectivo', 'ars', clave),
    simbolo: e.simbolo,
    nombre: e.nombre,
    tipo: 'efectivo',
    categoria: 'efectivo',
    fuente: null,
    unidadFuente: null, unidadApp: null, factor: null, moneda: e.moneda,
    cotiza: false,
    factorEstado: 'PENDIENTE',
    estadoOperativo: 'MANUAL',
    validacion: 'manual-sin-fuente',
    estado: 'solo-manual',
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
  ESTADOS, FACTOR_ESTADOS, ESTADOS_OPERATIVOS, VALIDACIONES,
  UMBRAL_DIFERENCIA_PCT, MIN_INSTRUMENTOS_POR_REGLA,
  PANELES_DATA912, CATEGORIAS_FCI, CRIPTO, EFECTIVO, REGLAS, REGLAS_POR_PANEL_DATA912, FCI_ASOCIACIONES, CAMPOS_CONVENCION,
  armarId, parsearId, esPosibleVarianteMoneda,
  diferenciaMaxPct, convencionDe, mismaConvencion, reglaConsistente, puedeHeredar, evidenciaValida, resolverFactor, reglaValidadaParaClase, resumenReglas,
  slugFCI, idEstableFCI, idLegacyFCI, asociacionFCIPorNombre, resolverIdFCI, detectarColisionesFCI, validarAsociacionesFCI,
  definirData912, definirFCI, definirCripto, definirEfectivo,
  fetchJSON, urlData912, urlFCI, URL_MEP, urlCoingecko,
};
