// Trae titulares reales de Google News (búsqueda de economía/mercados/Argentina).
// No inventa nada: son títulos y links tal cual los devuelve Google News.
// Cache de 30 minutos para no golpear la fuente en cada apertura de la app.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  try {
    const q = 'bolsa OR inflacion OR dolar OR bitcoin OR mercados Argentina';
    const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=es-419&gl=AR&ceid=AR:es-419';
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; mi-cartera-personal/1.0)' } });
    if (!r.ok) throw new Error('No se pudo leer Google News (status ' + r.status + ')');
    const xml = await r.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRegex.exec(xml)) && items.length < 6) {
      const block = m[1];
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
      if (!titleMatch) continue;
      let title = decodeEntities(titleMatch[1].replace('<![CDATA[', '').replace(']]>', ''));
      let source = '';
      const dash = title.lastIndexOf(' - ');
      if (dash > -1) { source = title.slice(dash + 3).trim(); title = title.slice(0, dash).trim(); }
      items.push({ title, source, link: linkMatch ? linkMatch[1].trim() : '' });
    }
    res.status(200).json({ ok: true, items, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e), items: [] });
  }
};

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
