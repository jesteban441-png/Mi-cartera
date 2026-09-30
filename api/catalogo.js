// Trae la lista de símbolos disponibles en el mercado argentino (bonos, CEDEARs,
// acciones, ONs) desde data912.com, para usar como sugerencias de autocompletado
// al cargar una posición o un activo objetivo, y como opciones en la "ruleta" de
// activos ideales al armar la Cartera objetivo. No son precios — es solo la lista
// de tickers que existen, así no hay que adivinar cómo se escribe cada uno.
// Se cachea 1 día porque el catálogo cambia poco (a diferencia de los precios).
//
// Además (motor de precios genérico), devuelve `instrumentos`: cada instrumento
// descripto con id estable, fuente, unidad, factor, moneda y estado
// (soportado / sin-verificar / solo-manual). Incluye los FCI de ArgentinaDatos y
// la cripto. `simbolos` y `porCategoria` se mantienen igual que antes.
const I = require('./_instrumentos');

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
    I.CATEGORIAS_FCI.forEach((cat, i) => {
      const arr = resultadosFCI[i];
      if (!Array.isArray(arr)) return;
      const vistos = new Set();
      arr.forEach(f => {
        if (f && typeof f.fondo === 'string' && f.fondo.trim() && !vistos.has(f.fondo)) {
          vistos.add(f.fondo);
          instrumentos.push(I.definirFCI(cat, f.fondo));
        }
      });
    });
    Object.keys(I.CRIPTO).forEach(id => instrumentos.push(I.definirCripto(id)));
    res.status(200).json({ ok: true, simbolos: [...simbolos].sort(), porCategoria, instrumentos, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e), simbolos: [], porCategoria: {}, instrumentos: [] });
  }
};
