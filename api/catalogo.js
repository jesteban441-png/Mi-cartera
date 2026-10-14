// Trae la lista de símbolos disponibles en el mercado argentino (bonos, CEDEARs,
// acciones, ONs) desde data912.com, para usar como sugerencias de autocompletado
// al cargar una posición o un activo objetivo, y como opciones en la "ruleta" de
// activos ideales al armar la Cartera objetivo. No son precios — es solo la lista
// de tickers que existen, así no hay que adivinar cómo se escribe cada uno.
// Se cachea 1 día porque el catálogo cambia poco (a diferencia de los precios).
//
// Además (motor de precios genérico), devuelve `instrumentos`: cada instrumento
// descripto con id, categoría, fuente, unidad, factor, moneda y estado. Desde la
// Fase 2B cada uno informa también factorEstado (CONFIRMADO / CONTRASTADO /
// PENDIENTE), estadoOperativo (AUTOMATICO / MANUAL) y validacion. Incluye los FCI
// de ArgentinaDatos (con id estable provisional y control de colisiones), la
// cripto y el efectivo (Pesos, sin cotización). `simbolos` y `porCategoria` se
// mantienen igual que antes.
//
// Búsqueda: /api/catalogo?q=texto[&limite=20] devuelve `resultados` buscando por
// símbolo, nombre y alias curados (api/_alias.js). No consulta ninguna fuente extra.
const I = require('./_instrumentos');
const A = require('./_alias');

function leerTexto(req, nombre) {
  const q = req && req.query ? req.query[nombre] : undefined;
  if (q !== undefined && q !== null) return Array.isArray(q) ? String(q[0] == null ? '' : q[0]) : String(q);
  if (req && typeof req.url === 'string' && req.url.indexOf('?') >= 0) {
    try {
      const v = new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1)).get(nombre);
      return v == null ? undefined : v;
    } catch (e) { return undefined; }
  }
  return undefined;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
  try {
    const paneles = Object.keys(I.PANELES_DATA912).map(url => ({ url, key: I.PANELES_DATA912[url].categoria, label: I.PANELES_DATA912[url].label }));
    const [resultados, resultadosFCI] = await Promise.all([
      Promise.all(paneles.map(p => I.fetchJSON(I.urlData912(p.url)).catch(() => []))),
      Promise.all(I.CATEGORIAS_FCI.map(c => I.fetchJSON(I.urlFCI(c)).catch(() => []))),
    ]);
    const simbolos = new Set();
    const porCategoria = {};
    const instrumentos = [];
    paneles.forEach((p, i) => {
      const arr = resultados[i];
      const lista = new Set();
      if (Array.isArray(arr)) {
        arr.forEach(item => {
          if (item && typeof item.symbol === 'string' && item.symbol.trim()) {
            const s = item.symbol.trim().toUpperCase();
            simbolos.add(s);
            lista.add(s);
          }
        });
      }
      porCategoria[p.key] = { label: p.label, simbolos: [...lista].sort() };
      [...lista].sort().forEach(s => instrumentos.push(I.definirData912(p.url, s, lista)));
    });

    // FCI: se listan por categoría de la fuente; el id estable (provisional) se
    // quita si dos fondos distintos darían el mismo id (nunca se fusionan).
    const fondos = [];
    I.CATEGORIAS_FCI.forEach((cat, i) => {
      const arr = resultadosFCI[i];
      if (!Array.isArray(arr)) return;
      const vistos = new Set();
      arr.forEach(f => {
        if (f && typeof f.fondo === 'string' && f.fondo.trim() && !vistos.has(f.fondo)) {
          vistos.add(f.fondo);
          fondos.push({ categoria: cat, nombre: f.fondo });
        }
      });
    });
    const colisionesFCI = I.detectarColisionesFCI(fondos);
    fondos.forEach(f => {
      const def = I.definirFCI(f.categoria, f.nombre);
      if (def.idEstable && colisionesFCI[def.idEstable]) {
        def.idEstableEnColision = def.idEstable;
        def.idEstable = null;
      }
      instrumentos.push(def);
    });

    Object.keys(I.CRIPTO).forEach(id => instrumentos.push(I.definirCripto(id)));
    Object.keys(I.EFECTIVO).forEach(id => instrumentos.push(I.definirEfectivo(id)));

    const q = leerTexto(req, 'q');
    if (q !== undefined) {
      const lim = parseInt(leerTexto(req, 'limite'), 10);
      res.status(200).json({
        ok: true, q,
        resultados: A.buscarInstrumentos(q, instrumentos, Number.isFinite(lim) ? lim : undefined),
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    res.status(200).json({
      ok: true,
      simbolos: [...simbolos].sort(),
      porCategoria,
      instrumentos,
      reglas: I.resumenReglas(),
      colisionesFCI: Object.keys(colisionesFCI),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e), simbolos: [], porCategoria: {}, instrumentos: [] });
  }
};
