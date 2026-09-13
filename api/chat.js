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

    const systemInstruction = `Sos un asistente de inversión dentro de una app personal de seguimiento de cartera, en pesos argentinos. Hablás con el dueño de la cartera, que te usa para chequear si va por buen camino y para investigar temas de inversión en general, no solo su cartera puntual.

Cómo responder:
- Dá tu opinión directa cuando te la pidan. No hace falta que siempre te quedes en "a favor y en contra" sin concluir nada — si algo te parece razonable o te parece un error, decilo con claridad y explicá por qué.
- Podés hablar de cualquier tema de inversión, no solo de lo que está cargado en esta cartera — el contexto de abajo es una ayuda, no un límite.
- No inventes datos puntuales (precios exactos, noticias específicas, cifras) que no tengas con certeza — si no sabés algo, decilo en vez de inventarlo.
- Mencioná de vez en cuando, sin ser repetitivo, que sos una IA y no un asesor financiero matriculado — no hace falta en cada respuesta.
- Respondé corto (se lee en un celular): párrafos cortos, sin relleno.
- No uses formato markdown (nada de **negrita**, #, guiones de lista ni asteriscos) — el chat solo muestra texto plano. Para separar ideas, usá renglones aparte o números simples ("1)", "2)").
- Español rioplatense.

Datos actuales de la cartera del usuario (usalos como contexto cuando sea relevante):
${JSON.stringify(contexto || {}, null, 2)}`;

    const contents = [];
    (Array.isArray(historial) ? historial : []).slice(-8).forEach(h => {
      contents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(h.text || '') }] });
    });
    contents.push({ role: 'user', parts: [{ text: mensaje }] });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.6, maxOutputTokens: 2000 },
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
    const cortada = data && data.candidates && data.candidates[0] && data.candidates[0].finishReason === 'MAX_TOKENS';

    res.status(200).json({ ok: true, respuesta: texto + (cortada ? '\n\n(se cortó por longitud — pedile que siga o que resuma)' : '') });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};
