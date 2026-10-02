// PRUEBA TEMPORAL — investigación de BYMA Open Data. No la usa la app.
// Solo lee datos públicos de BYMA y devuelve un informe. No escribe en ningún
// lado, no toca Firestore, ni precios, ni posiciones. Se borra al terminar la
// investigación.
//
// Uso:
//   /api/byma-test                      informe en texto
//   /api/byma-test?formato=json         mismo informe en JSON (con filas crudas)
//   /api/byma-test?simbolos=YFCGO,AL29  otros símbolos
//
// Certificado: NUNCA se desactiva la validación para pedir datos. Primero se
// intenta con los certificados del sistema. Si falla porque BYMA no envía el
// certificado intermedio, se lee el certificado del servidor (solo el
// handshake, sin enviar ni recibir datos), se descarga su intermedio desde la
// URL "CA Issuers" que figura en el propio certificado y se vuelve a conectar
// CON validación completa contra las raíces del sistema + ese intermedio.
const https = require('https');
const http = require('http');
const tls = require('tls');
const crypto = require('crypto');

const HOST = 'open.bymadata.com.ar';
const BASE = '/vanoms-be-core/rest/api/bymadata/free';
const ESPERA_MS = 350; // intervalo entre consultas consecutivas
const ND = 'NO DISPONIBLE';

const PANELES = [
  { clave: 'acciones-lideres', path: 'leading-equity', tipo: 'acción' },
  { clave: 'acciones-general', path: 'general-equity', tipo: 'acción' },
  { clave: 'cedears', path: 'cedears', tipo: 'CEDEAR' },
  { clave: 'bonos', path: 'public-bonds', tipo: 'bono' },
  { clave: 'on', path: 'negociable-obligations', tipo: 'ON' },
  { clave: 'letras', path: 'lebacs', tipo: 'letra' },
];
const SIMBOLOS_DEFECTO = ['YFCGO', 'MGCEO', 'AL29', 'AO27', 'GGAL', 'SPY', 'IVV', 'VEA', 'S30O6'];
const SIMBOLOS_FICHA = new Set(['YFCGO', 'MGCEO', 'AL29', 'AO27', 'S30O6']);

const esperar = ms => new Promise(r => setTimeout(r, ms));
let caExtra = null; // intermedio descargado, si hizo falta
let modoTLS = 'sin probar';

function pedir(path, body, ca) {
  return new Promise((resolve, reject) => {
    const datos = JSON.stringify(body || {});
    const t0 = Date.now();
    const req = https.request({
      host: HOST, path: BASE + '/' + path, method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        'Content-Length': Buffer.byteLength(datos),
        'User-Agent': 'Mozilla/5.0 (mi-cartera-personal, prueba de lectura)',
      },
      timeout: 20000,
      ...(ca ? { ca } : {}), // rejectUnauthorized queda en true (por defecto)
    }, res => {
      const partes = [];
      res.on('data', d => partes.push(d));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        let json = null;
        try { json = JSON.parse(texto); } catch (e) { /* se informa abajo */ }
        resolve({ status: res.statusCode, ms: Date.now() - t0, bytes: texto.length, json, inicio: json ? null : texto.slice(0, 200) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout 20s')));
    req.on('error', reject);
    req.end(datos);
  });
}

// Lee el certificado del servidor sin intercambiar datos de aplicación.
function leerCertificadoServidor() {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host: HOST, port: 443, servername: HOST, rejectUnauthorized: false }, () => {
      const cert = s.getPeerCertificate(true);
      const err = s.authorizationError;
      s.end();
      resolve({ cert, authorizationError: err ? String(err) : null });
    });
    s.setTimeout(10000, () => s.destroy(new Error('timeout handshake')));
    s.on('error', reject);
  });
}

function descargar(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    mod.get(url, { timeout: 10000 }, res => {
      const partes = [];
      res.on('data', d => partes.push(d));
      res.on('end', () => resolve(Buffer.concat(partes)));
    }).on('error', reject);
  });
}

function aPEM(buf) {
  const s = buf.toString('utf8');
  if (s.includes('BEGIN CERTIFICATE')) return s;
  return new crypto.X509Certificate(buf).toString();
}

async function prepararTLS(diag) {
  try {
    const r = await pedir('market-time', {});
    modoTLS = 'certificados del sistema (validación normal)';
    diag.push('TLS: conexión validada con los certificados del sistema. market-time respondió HTTP ' + r.status + (r.json ? '' : ' (no JSON: ' + r.inicio + ')') + '.');
    return true;
  } catch (e) {
    diag.push('TLS con certificados del sistema: falló (' + (e.code || e.message) + ').');
  }
  try {
    const { cert, authorizationError } = await leerCertificadoServidor();
    diag.push('Motivo informado por el handshake: ' + (authorizationError || 'ninguno'));
    const x = cert && cert.raw ? new crypto.X509Certificate(cert.raw) : null;
    if (x) diag.push('Certificado del servidor: emisor "' + x.issuer.replace(/\n/g, ', ') + '", vence ' + x.validTo + '.');
    const aia = x && x.infoAccess ? x.infoAccess : '';
    const m = aia.match(/CA Issuers - URI:(\S+)/);
    if (!m) { diag.push('El certificado no indica dónde descargar el intermedio (sin "CA Issuers").'); return false; }
    const intermedio = aPEM(await descargar(m[1]));
    caExtra = [...tls.rootCertificates, intermedio];
    const r2 = await pedir('market-time', {}, caExtra);
    diag.push('market-time respondió HTTP ' + r2.status + '.');
    modoTLS = 'raíces del sistema + intermedio descargado de ' + m[1] + ' (validación completa)';
    diag.push('TLS: conexión validada agregando el intermedio publicado en el propio certificado (' + m[1] + ').');
    return true;
  } catch (e) {
    diag.push('TLS con intermedio descargado: falló (' + (e.code || e.message) + ').');
    modoTLS = 'no se pudo validar';
    return false;
  }
}

const listaDe = j => (Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : null);
const v = x => (x === undefined || x === null || x === '' ? ND : x);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const inicio = Date.now();
  const q = req.query || {};
  const simbolos = (q.simbolos ? String(q.simbolos).split(',') : SIMBOLOS_DEFECTO).map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 20);
  const diag = [];
  const consultas = [];
  const filas = {}; // simbolo -> [{panel, fila}]

  const tlsOk = await prepararTLS(diag);
  if (tlsOk) {
    for (const p of PANELES) {
      await esperar(ESPERA_MS);
      try {
        // T1 = liquidación 24 hs (según la documentación comunitaria)
        const r = await pedir(p.path, { excludeZeroPxAndQty: false, T1: true, T0: false, page_size: 5000 }, caExtra);
        const lista = listaDe(r.json);
        consultas.push({ consulta: p.path, status: r.status, ms: r.ms, bytes: r.bytes, items: lista ? lista.length : ND, camposEjemplo: lista && lista[0] ? Object.keys(lista[0]) : ND, error: r.json ? null : r.inicio });
        (lista || []).forEach(f => {
          const s = f && typeof f.symbol === 'string' ? f.symbol.trim().toUpperCase() : null;
          if (s && simbolos.includes(s)) (filas[s] = filas[s] || []).push({ panel: p, fila: f });
        });
      } catch (e) {
        consultas.push({ consulta: p.path, error: String(e.message || e) });
      }
    }
  }

  const fichas = {};
  if (tlsOk) {
    for (const s of simbolos.filter(x => SIMBOLOS_FICHA.has(x) || q.fichas === 'todas')) {
      await esperar(ESPERA_MS);
      try {
        const r = await pedir('bnown/fichatecnica/especies/general', { symbol: s }, caExtra);
        const d = r.json && Array.isArray(r.json.data) ? r.json.data[0] : null;
        consultas.push({ consulta: 'bond-info ' + s, status: r.status, ms: r.ms, bytes: r.bytes, items: d ? 1 : 0, camposEjemplo: d ? Object.keys(d) : ND, error: r.json ? null : r.inicio });
        fichas[s] = d || null;
      } catch (e) {
        consultas.push({ consulta: 'bond-info ' + s, error: String(e.message || e) });
      }
    }
  }

  // Informe por símbolo: solo lo que BYMA devuelve literalmente.
  const informe = simbolos.map(s => {
    const encontradas = filas[s] || [];
    const f = encontradas[0] ? encontradas[0].fila : null;
    const ficha = fichas[s];
    return {
      simbolo: s,
      encontrado: encontradas.length > 0,
      paneles: encontradas.length ? [...new Set(encontradas.map(e => e.panel.path))] : ND,
      filasEncontradas: encontradas.length,
      monedaCotizacion: f ? v(f.denominationCcy) : ND,
      unidadCotizacion: ND + ' (BYMA no publica un campo de unidad de cotización)',
      precioUltimo: f ? v(f.trade) : ND,
      precioCierre: f ? v(f.closingPrice) : ND,
      horaUltimaOperacion: f ? v(f.tradeHour) : ND,
      fechaCotizacion: f ? v(f.tradeDate || f.date) : ND,
      liquidacion: f ? v(f.settlementType) : ND,
      tipoInstrumento: f ? v(f.securityType) + ' / ' + v(f.securitySubType) : ND,
      vencimientoPanel: f ? v(f.maturityDate) : ND,
      ficha: ficha === undefined ? 'no consultada' : ficha === null ? ND : {
        denominacion: v(ficha.denominacion), emisor: v(ficha.emisor), tipoEspecie: v(ficha.tipoEspecie),
        monedaEmision: v(ficha.moneda), fechaVencimiento: v(ficha.fechaVencimiento),
        denominacionMinima: v(ficha.denominacionMinima), montoNominal: v(ficha.montoNominal),
        montoResidual: v(ficha.montoResidual), codigoIsin: v(ficha.codigoIsin), ley: v(ficha.ley),
      },
      filasCrudas: encontradas.map(e => ({ panel: e.panel.path, ...e.fila })),
    };
  });

  const tiempos = consultas.filter(c => typeof c.ms === 'number').map(c => c.ms);
  const resumen = {
    tls: modoTLS, diagnosticoTLS: diag,
    duracionTotalMs: Date.now() - inicio,
    consultas, msPromedio: tiempos.length ? Math.round(tiempos.reduce((a, b) => a + b, 0) / tiempos.length) : ND,
    msMaximo: tiempos.length ? Math.max(...tiempos) : ND,
    intervaloEntreConsultasMs: ESPERA_MS,
  };

  if (q.formato === 'json') return res.status(200).json({ ok: tlsOk, resumen, informe });

  const L = ['BYMA TEST', '', 'TLS: ' + modoTLS, ...diag.map(d => '  ' + d), ''];
  L.push('CONSULTAS (consecutivas, ' + ESPERA_MS + ' ms entre cada una)');
  consultas.forEach(c => L.push('  ' + c.consulta + ': ' + (c.error && !c.status ? 'ERROR ' + c.error : 'HTTP ' + c.status + ' · ' + c.ms + ' ms · ' + c.items + ' items' + (c.error ? ' · respuesta no JSON: ' + c.error : ''))));
  L.push('  duración total: ' + resumen.duracionTotalMs + ' ms · promedio ' + resumen.msPromedio + ' ms · máximo ' + resumen.msMaximo + ' ms', '');
  informe.forEach(i => {
    const ok = x => (String(x).startsWith(ND) ? '✗' : '✓');
    L.push(i.simbolo);
    L.push((i.encontrado ? '✓ encontrado en ' + i.paneles.join(', ') + ' (' + i.filasEncontradas + ' filas)' : '✗ ' + ND + ' en los paneles consultados'));
    L.push(ok(i.monedaCotizacion) + ' moneda de cotización: ' + i.monedaCotizacion);
    L.push('✗ unidad: ' + i.unidadCotizacion);
    L.push(ok(i.precioUltimo) + ' precio último: ' + i.precioUltimo + ' · cierre: ' + i.precioCierre);
    L.push(ok(i.fechaCotizacion) + ' fecha: ' + i.fechaCotizacion + ' · hora última operación: ' + i.horaUltimaOperacion);
    L.push(ok(i.tipoInstrumento) + ' tipo: ' + i.tipoInstrumento);
    L.push(ok(i.vencimientoPanel) + ' vencimiento (panel): ' + i.vencimientoPanel);
    if (i.ficha === 'no consultada') L.push('· ficha técnica: no consultada');
    else if (i.ficha === ND) L.push('✗ ficha técnica: ' + ND);
    else {
      const f = i.ficha;
      L.push('✓ ficha técnica: ' + f.denominacion);
      L.push('   emisor: ' + f.emisor + ' · tipo: ' + f.tipoEspecie + ' · moneda de emisión: ' + f.monedaEmision);
      L.push('   vencimiento: ' + f.fechaVencimiento + ' · denominación mínima: ' + f.denominacionMinima);
      L.push('   valor nominal: ' + f.montoNominal + ' · residual: ' + f.montoResidual + ' · ISIN: ' + f.codigoIsin + ' · ley: ' + f.ley);
    }
    L.push('');
  });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.status(200).send(L.join('\n'));
};
