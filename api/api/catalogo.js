// Trae la lista de símbolos disponibles en el mercado argentino (bonos, CEDEARs,
// acciones, ONs) desde data912.com, para usar como sugerencias de autocompletado
// al cargar una posición o un activo objetivo. No son precios — es solo la lista
// de tickers que existen, así no hay que adivinar cómo se escribe cada uno.
// Se cachea 1 día porque el catálogo cambia poco (a diferencia de los precios).
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
  try {
    const paneles = ['arg_bonds', 'arg_cedears', 'arg_corp', 'arg_notes', 'arg_stocks'];
    const resultados = await Promise.all(paneles.map(p =>
      fetch(`https://data912.com/live/${p}`, { headers: { 'User-Agent': 'mi-cartera-personal/1.0' } })
        .then(r => (r.ok ? r.json() : []))
        .catch(() => [])
    ));
    const simbolos = new Set();
    resultados.forEach(arr => {
      if (Array.isArray(arr)) {
        arr.forEach(item => {
          if (item && typeof item.symbol === 'string' && item.symbol.trim()) simbolos.add(item.symbol.trim().toUpperCase());
        });
      }
    });
    res.status(200).json({ ok: true, simbolos: [...simbolos].sort(), updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e), simbolos: [] });
  }
};
