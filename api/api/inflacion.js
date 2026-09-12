// Trae la serie de inflación mensual de Argentina (fuente: BCRA, vía ArgentinaDatos).
// Se usa para dos cosas en el frontend:
//   1) Mostrar "Cartera vs. ahorro" en pesos de hoy (ajustando los valores viejos por la
//      inflación acumulada desde esa fecha hasta el mes más reciente disponible).
//   2) Sugerir una tasa de inflación anual de partida en la proyección, calculada
//      componiendo los últimos 12 meses.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800'); // cache 1 día
  try {
    const r = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/inflacion', {
      headers: { 'User-Agent': 'mi-cartera-personal/1.0' },
    });
    if (!r.ok) throw new Error('No se pudo leer inflación (status ' + r.status + ')');
    const data = await r.json(); // [{ fecha: "YYYY-MM-DD", valor: <% mensual> }, ...]
    const mensual = (Array.isArray(data) ? data : []).slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

    let anualizada = null;
    const ultimos12 = mensual.slice(-12);
    if (ultimos12.length > 0) {
      let factor = 1;
      ultimos12.forEach(m => { factor *= (1 + (Number(m.valor) || 0) / 100); });
      anualizada = Math.round((factor - 1) * 1000) / 10;
    }

    res.status(200).json({ ok: true, mensual, anualizada, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e), mensual: [], anualizada: null });
  }
};
