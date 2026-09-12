// Asistente de cartera, usando la API gratuita de Gemini (Google).
// La clave vive en una variable de entorno de Vercel (GEMINI_API_KEY) — nunca en el
// código del navegador, para que nadie pueda robarla ni gastar tu cuota gratuita.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método no permitido' });
    return;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: 'Falta configurar GEMINI_API_KEY en Vercel (Settings → Environment Variables).' });
    return;
  }

  try {
    const { mensaje, historial, contexto } = req.body || {};
    if (!mensaje || typeof mensaje !== 'string') {
      res.status(400).json({ ok: false, error: 'Falta el mensaje' });
      return;
    }

    const systemInstruction = `Sos un asistente educativo dentro de una app personal de seguimiento de cartera de inversión, en pesos argentinos. Hablás con el dueño de la cartera.

Reglas estrictas, no las rompas:
- NUNCA dés una orden de compra o venta ("comprá X", "vendé Y", "pasate a Z"). En vez de eso, presentá los ángulos a favor y en contra de cada opción, y dejá la decisión a él.
- Basate solo en los datos de cartera de abajo. No inventes precios, activos ni noticias que no estén ahí — si falta un dato para responder bien, decilo.
- Cuando haya más de una forma válida de verlo, mostrá más de una — no des un solo veredicto como si fuera la única verdad posible.
- Mencioná, con naturalidad y sin sonar repetitivo, que esto es educativo y no asesoramiento financiero regulado.
- Respondé corto (se lee en un celular): párrafos cortos, sin relleno.
- Español rioplatense.

Datos actuales de la cartera:
${JSON.stringify(contexto || {}, null, 2)}`;

    const contents = [];
    (Array.isArray(historial) ? historial : []).slice(-8).forEach(h => {
      contents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(h.text || '') }] });
    });
    contents.push({ role: 'user', parts: [{ text: mensaje }] });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.6, maxOutputTokens: 700 },
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Gemini respondió ${r.status}: ${errText.slice(0, 300)}`);
    }
    const data = await r.json();
    const texto = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [])
      .map(p => p.text || '').join('');
    if (!texto) throw new Error('Gemini no devolvió texto (puede haber bloqueado la respuesta por sus filtros de seguridad).');

    res.status(200).json({ ok: true, respuesta: texto });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};
