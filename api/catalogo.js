// Trae la lista de símbolos disponibles en el mercado argentino (bonos, CEDEARs,
// acciones, ONs) desde data912.com, para usar como sugerencias de autocompletado
// al cargar una posición o un activo objetivo, y como opciones en la "ruleta" de
// activos ideales al armar la Cartera objetivo. No son precios — es solo la lista
// de tickers que existen, así no hay que adivinar cómo se escribe cada uno.
// Se cachea 1 día porque el catálogo cambia poco (a diferencia de los precios).
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
  try {
    const paneles = [
      { key: 'cedears', url: 'arg_cedears', label: 'CEDEARs' },
      { key: 'acciones', url: 'arg_stocks', label: 'Acciones argentinas' },
      { key: 'bonos', url: 'arg_bonds', label: 'Bonos argentinos' },
      { key: 'obligaciones', url: 'arg_corp', label: 'Obligaciones negociables' },
      { key: 'notas', url: 'arg_notes', label: 'Notas / letras' },
    ];
    const resultados = await Promise.all(paneles.map(p =>
      fetch(`https://data912.com/live/${p.url}`, { headers: { 'User-Agent': 'mi-cartera-personal/1.0' } })
        .then(r => (r.ok ? r.json() : []))
        .catch(() => [])
    ));
    const simbolos = new Set();
    const porCategoria = {};
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
    });
    res.status(200).json({ ok: true, simbolos: [...simbolos].sort(), porCategoria, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e), simbolos: [], porCategoria: {} });
  }
};
