// Fase 3.0: funciones puras de vinculación posición <-> instrumento.
// Se extraen de index.html (bloque marcado) y se prueban aisladas: sin red, sin interfaz.
const assert = require('assert');
const fs = require('fs');
const { ROOT, t, fin } = require('./_util');

const html = fs.readFileSync(ROOT + '/index.html', 'utf8');
const corte = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); assert.ok(i >= 0 && j > i, 'marcador ' + a); return html.slice(i, j); };
const normSrc = html.match(/function norm\(s\) \{[^\n]*\}/)[0];
const platSrc = html.match(/const PLATFORMS = \[[^\]]*\];/)[0];
const fusionSrc = corte('const CAMPOS_DOC', '/* ---------- backup');
const backupSrc = corte('const APP_BACKUP', '/* ---------- app ----------');
const motor = corte('// ==== MOTOR DE PRECIOS', '// ==== FIN MOTOR DE PRECIOS');
const vinc = corte('// ==== VINCULACIÓN DE POSICIONES (Fase 3.0)', '// ==== FIN VINCULACIÓN DE POSICIONES');
const exportar = [
  'norm', 'PLATFORMS', 'CAMPOS_PRECIO', 'normalizarPrecio', 'aplicarCotizacion', 'aplicarPreciosRutaVieja', 'puedeActualizarRutaVieja', 'tieneInstrumento',
  'indexarCatalogo', 'esInstrumentoAutomatico', 'motorDePosicion', 'cotizacionActual', 'estadoCotizacion', 'calcularRendimiento',
  'evaluarVinculo', 'vincularPosicion', 'desvincularPosicion', 'restaurarPrecioPrevio', 'editarPrecioManual', 'volverAAutomatico',
  'iniciarActualizacion', 'aplicarCotizacionVigente', 'crearPosicionDesdeInstrumento', 'validarVinculo', 'resolverConflictoPosicion',
  'fusionarCampo', 'fusionarDocumento', 'validarBackup', 'aplicarRestauracion', 'copiaProfunda', 'mismoValor',
];
const M = new Function(normSrc + platSrc + motor + fusionSrc + backupSrc + vinc + ';return {' + exportar.join(',') + '};')();

const deepFreeze = o => { Object.values(o).forEach(v => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
const T0 = '2026-10-20T12:00:00.000Z', T1 = '2026-10-20T12:05:00.000Z', T2 = '2026-10-20T12:10:00.000Z', T3 = '2026-10-20T12:15:00.000Z';
const INMUTABLES = ['id', 'name', 'platform', 'fecha', 'units', 'avgPrice'];
const igualesInmutables = (a, b) => INMUTABLES.forEach(k => assert.deepStrictEqual(a[k], b[k], k + ' no debe cambiar'));
const sinUndefined = (o, ruta = '') => { Object.entries(o).forEach(([k, v]) => { assert.notStrictEqual(v, undefined, 'undefined en ' + ruta + k); if (v && typeof v === 'object') sinUndefined(v, ruta + k + '.'); }); };

// Instrumentos (formato del catálogo)
const BTC = { id: 'cripto:coingecko:bitcoin', simbolo: 'Bitcoin', estado: 'soportado', estadoOperativo: 'AUTOMATICO', factorEstado: 'CONFIRMADO', moneda: 'USD', unidadFuente: '1 BTC', unidadApp: '1 BTC', factor: 1, conversion: { a: 'ARS', tipoCambio: 'MEP' } };
const AL29 = { id: 'data912:arg_bonds:AL29', simbolo: 'AL29', estado: 'soportado', estadoOperativo: 'AUTOMATICO', factorEstado: 'CONTRASTADO', moneda: 'ARS', unidadFuente: '100 VN', unidadApp: '1 VN', factor: 0.01 };
const SPY = { id: 'data912:arg_cedears:SPY', simbolo: 'SPY', estado: 'pendiente', estadoOperativo: 'MANUAL', factorEstado: 'PENDIENTE', moneda: 'ARS', unidadFuente: 'x', unidadApp: 'x', factor: 1 };
const CAT = M.indexarCatalogo([BTC, AL29, SPY]);

const pos = (extra = {}) => ({ id: 'p1', name: 'AL29', platform: 'IOL', fecha: '2026-03-01', units: 1000, avgPrice: 700, currentPrice: 800, precioOrigen: 'auto', precioActualizado: T0, ...extra });
const vinculable = (p, ins, extra) => M.vincularPosicion(p, ins, { ahora: T1, cotizacion: 805, cantidadConfirmada: ins.unidadApp, ...(extra || {}) });
const normOk = (precio, consultadoEn) => ({ ok: true, precio, cotizacion: { consultadoEn, precioFuente: precio } });

// ---------- motorDePosicion: un solo motor ----------
t('motorDePosicion: sin instrumentoId y origen auto o sin dato -> viejo', () => {
  assert.strictEqual(M.motorDePosicion(pos(), CAT), 'viejo');
  const { precioOrigen, ...sinOrigen } = pos();
  assert.strictEqual(M.motorDePosicion(sinOrigen, CAT), 'viejo');
});
t('motorDePosicion: manual sin instrumentoId -> ninguno', () => assert.strictEqual(M.motorDePosicion(pos({ precioOrigen: 'manual' }), CAT), 'ninguno'));
t('motorDePosicion: con instrumentoId automático y no manual -> nuevo', () => {
  assert.strictEqual(M.motorDePosicion(pos({ instrumentoId: AL29.id }), CAT), 'nuevo');
  assert.strictEqual(M.motorDePosicion(pos({ instrumentoId: AL29.id, precioOrigen: null }), CAT), 'nuevo');
});
t('motorDePosicion: con instrumentoId pero manual, instrumento manual, inexistente o sin catálogo -> ninguno (jamás viejo)', () => {
  assert.strictEqual(M.motorDePosicion(pos({ instrumentoId: AL29.id, precioOrigen: 'manual' }), CAT), 'ninguno');
  assert.strictEqual(M.motorDePosicion(pos({ instrumentoId: SPY.id }), CAT), 'ninguno');
  assert.strictEqual(M.motorDePosicion(pos({ instrumentoId: 'no:existe' }), CAT), 'ninguno');
  assert.strictEqual(M.motorDePosicion(pos({ instrumentoId: AL29.id }), null), 'ninguno');
  assert.strictEqual(M.motorDePosicion(pos({ instrumentoId: '__proto__' }), CAT), 'ninguno');
});
t('motorDePosicion: origen desconocido nunca se actualiza sola', () => {
  assert.strictEqual(M.motorDePosicion(pos({ precioOrigen: 'otro' }), CAT), 'ninguno');
  assert.strictEqual(M.motorDePosicion(pos({ instrumentoId: AL29.id, precioOrigen: 'otro' }), CAT), 'ninguno');
});
t('Exclusión mutua: en todas las combinaciones, la ruta vieja y el motor nuevo no actualizan la misma posición', () => {
  const origenes = [undefined, null, 'auto', 'manual', 'x'];
  const ids = [undefined, null, '', AL29.id, SPY.id, 'no:existe'];
  const nombres = ['AL29', 'Bitcoin', 'SPY'];
  let n = 0;
  for (const o of origenes) for (const id of ids) for (const nombre of nombres) {
    const p = { id: 'p', name: nombre, platform: 'IOL', fecha: '2026-01-01', units: 1, avgPrice: 1, currentPrice: 5 };
    if (o !== undefined) p.precioOrigen = o;
    if (id !== undefined) p.instrumentoId = id;
    const vieja = M.aplicarPreciosRutaVieja([p], { [M.norm(nombre)]: 99 }, T1).actualizadas === 1;
    const nueva = M.motorDePosicion(p, CAT) === 'nuevo';
    assert.ok(!(vieja && nueva), 'doble actualización: ' + JSON.stringify(p));
    assert.strictEqual(vieja, M.motorDePosicion(p, CAT) === 'viejo', 'la ruta vieja y motorDePosicion deben coincidir: ' + JSON.stringify(p));
    n++;
  }
  assert.strictEqual(n, 90);
});
t('indexarCatalogo: ids repetidos o vacíos se excluyen (ambiguo)', () => {
  const c = M.indexarCatalogo([BTC, { ...BTC }, AL29, null, { simbolo: 'X' }]);
  assert.deepStrictEqual(Object.keys(c), [AL29.id]);
});

// ---------- vincular ----------
t('vincular: agrega instrumentoId/vinculo y NO cambia id, name, platform, fecha, units, avgPrice ni el precio actual', () => {
  const p = deepFreeze(pos());
  const r = vinculable(p, AL29);
  assert.ok(r.ok, JSON.stringify(r));
  igualesInmutables(r.posicion, p);
  assert.strictEqual(r.posicion.currentPrice, 800);
  assert.strictEqual(r.posicion.precioActualizado, T0);
  assert.strictEqual(r.posicion.instrumentoId, AL29.id);
  assert.strictEqual(r.posicion.precioOrigen, 'auto');
  assert.deepStrictEqual(r.posicion.vinculo, { en: T1, instrumentoId: AL29.id, previo: { currentPrice: 800, precioOrigen: 'auto', precioActualizado: T0 } });
  assert.strictEqual(M.motorDePosicion(r.posicion, CAT), 'nuevo');
  sinUndefined(r.posicion);
});
t('vincular: no modifica el objeto original (inmutable)', () => {
  const p = deepFreeze(pos());
  const copia = JSON.parse(JSON.stringify(p));
  vinculable(p, AL29);
  assert.deepStrictEqual(p, copia);
});
t('vincular: guarda un estado previo "sin precioOrigen" tal cual (sin inventar claves)', () => {
  const { precioOrigen, precioActualizado, ...legado } = pos();
  const r = vinculable(legado, AL29);
  assert.deepStrictEqual(r.posicion.vinculo.previo, { currentPrice: 800 });
});
t('vincular: bloquea si el instrumento no es automático (pendiente/manual/null)', () => {
  for (const ins of [SPY, null, {}, { ...AL29, estado: 'pendiente' }, { ...AL29, estadoOperativo: 'MANUAL' }, { ...AL29, factorEstado: 'PENDIENTE' }]) {
    const r = M.vincularPosicion(pos(), ins, { ahora: T1, cotizacion: 805, cantidadConfirmada: '1 VN' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.bloqueos.some(b => b.codigo === 'instrumento-no-automatico'));
  }
});
t('vincular: exige confirmar la convención de cantidad (unidadApp)', () => {
  for (const c of [undefined, '', '100 VN', 'otra']) {
    const r = M.vincularPosicion(pos(), AL29, { ahora: T1, cotizacion: 805, cantidadConfirmada: c });
    assert.strictEqual(r.ok, false);
    assert.ok(r.bloqueos.some(b => b.codigo === 'cantidad-no-confirmada'), String(c));
  }
});
t('vincular: moneda incompatible o sin conversión a ARS se bloquea; USD con conversión MEP es compatible', () => {
  const eur = { ...AL29, moneda: 'EUR' };
  assert.ok(M.vincularPosicion(pos(), eur, { ahora: T1, cotizacion: 805, cantidadConfirmada: '1 VN' }).bloqueos.some(b => b.codigo === 'moneda-incompatible'));
  const usdSin = { ...BTC, conversion: undefined };
  assert.ok(M.vincularPosicion(pos(), usdSin, { ahora: T1, cotizacion: 805, cantidadConfirmada: '1 BTC' }).bloqueos.some(b => b.codigo === 'moneda-incompatible'));
  const r = M.vincularPosicion(pos({ name: 'Bitcoin', currentPrice: 100000000 }), BTC, { ahora: T1, cotizacion: 101000000, cantidadConfirmada: '1 BTC' });
  assert.ok(r.ok, JSON.stringify(r));
});
t('vincular: unidad o factor sin verificar se bloquea', () => {
  for (const ins of [{ ...AL29, factor: undefined }, { ...AL29, factor: 0 }, { ...AL29, unidadApp: '' }, { ...AL29, unidadFuente: undefined }]) {
    const r = M.vincularPosicion(pos(), ins, { ahora: T1, cotizacion: 805, cantidadConfirmada: ins.unidadApp });
    assert.strictEqual(r.ok, false);
    assert.ok(r.bloqueos.some(b => b.codigo === 'unidad-no-verificada'));
  }
});
t('vincular: advertencia >10 % exige confirmarla; 10 % exacto no advierte; con confirmación vincula', () => {
  const lejos = M.vincularPosicion(pos(), AL29, { ahora: T1, cotizacion: 900, cantidadConfirmada: '1 VN' }); // +12,5 %
  assert.strictEqual(lejos.ok, false);
  assert.deepStrictEqual(lejos.advertencias.map(a => a.codigo), ['diferencia-precio']);
  assert.strictEqual(lejos.diferenciaPct, 12.5);
  const okConf = M.vincularPosicion(pos(), AL29, { ahora: T1, cotizacion: 900, cantidadConfirmada: '1 VN', confirmadas: ['diferencia-precio'] });
  assert.ok(okConf.ok);
  const justo = M.vincularPosicion(pos(), AL29, { ahora: T1, cotizacion: 880, cantidadConfirmada: '1 VN' }); // 10 %
  assert.ok(justo.ok, 'exactamente 10 % no es advertencia');
  const baja = M.vincularPosicion(pos(), AL29, { ahora: T1, cotizacion: 700, cantidadConfirmada: '1 VN' }); // -12,5 %
  assert.strictEqual(baja.ok, false);
});
t('vincular: confirmar otra advertencia no sirve; sin cotización para comparar también pide confirmación', () => {
  assert.strictEqual(M.vincularPosicion(pos(), AL29, { ahora: T1, cotizacion: 900, cantidadConfirmada: '1 VN', confirmadas: ['precio-manual'] }).ok, false);
  const r = M.vincularPosicion(pos(), AL29, { ahora: T1, cotizacion: null, cantidadConfirmada: '1 VN' });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.advertencias.map(a => a.codigo), ['sin-comparacion']);
});
t('vincular: una posición con precio manual advierte que será reemplazado y requiere confirmación', () => {
  const r = M.vincularPosicion(pos({ precioOrigen: 'manual' }), AL29, { ahora: T1, cotizacion: 805, cantidadConfirmada: '1 VN' });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.advertencias.map(a => a.codigo), ['precio-manual']);
  const ok = M.vincularPosicion(pos({ precioOrigen: 'manual' }), AL29, { ahora: T1, cotizacion: 805, cantidadConfirmada: '1 VN', confirmadas: ['precio-manual'] });
  assert.ok(ok.ok);
  assert.strictEqual(ok.posicion.vinculo.previo.precioOrigen, 'manual');
});
t('vincular: una posición sin precio actual no tiene nada que comparar y vincula sin advertencias', () => {
  const r = vinculable(pos({ currentPrice: null }), AL29);
  assert.ok(r.ok);
});
t('vincular: no se puede vincular dos veces ni sin fecha ni con datos inválidos', () => {
  const v = vinculable(pos(), AL29).posicion;
  assert.ok(M.vincularPosicion(v, AL29, { ahora: T2, cotizacion: 805, cantidadConfirmada: '1 VN' }).bloqueos.some(b => b.codigo === 'ya-vinculada'));
  assert.strictEqual(M.vincularPosicion(pos(), AL29, { cotizacion: 805, cantidadConfirmada: '1 VN' }).ok, false);
  assert.ok(M.vincularPosicion(pos({ units: 0 }), AL29, { ahora: T1, cotizacion: 805, cantidadConfirmada: '1 VN' }).bloqueos.some(b => b.codigo === 'posicion-sin-datos'));
  assert.ok(M.vincularPosicion(null, AL29, { ahora: T1 }).bloqueos.length > 0);
});
t('vincular: la misma inversión en dos plataformas son dos posiciones independientes', () => {
  const a = pos({ id: 'pA', platform: 'IOL', units: 1000, avgPrice: 700 });
  const b = pos({ id: 'pB', platform: 'Bullmarket', units: 250, avgPrice: 750, fecha: '2026-05-05' });
  const ra = vinculable(a, AL29).posicion;
  assert.strictEqual(ra.instrumentoId, AL29.id);
  assert.deepStrictEqual(b, pos({ id: 'pB', platform: 'Bullmarket', units: 250, avgPrice: 750, fecha: '2026-05-05' }));
  const rb = vinculable(b, AL29).posicion;
  assert.strictEqual(rb.instrumentoId, ra.instrumentoId);
  igualesInmutables(ra, a); igualesInmutables(rb, b);
  assert.notStrictEqual(ra.platform, rb.platform);
});

// ---------- desvincular y restaurar ----------
t('desvincular: conserva el último precio y su fecha, pasa a MANUAL, quita instrumentoId y cotizacion', () => {
  const v = vinculable(pos(), AL29).posicion;
  const aplicada = M.aplicarCotizacion(v, normOk(812.5, T2));
  const r = M.desvincularPosicion(aplicada, T3);
  assert.ok(r.ok);
  const p = r.posicion;
  assert.strictEqual(p.currentPrice, 812.5);
  assert.strictEqual(p.precioActualizado, T2);
  assert.strictEqual(p.precioOrigen, 'manual');
  assert.ok(!('instrumentoId' in p) && !('cotizacion' in p) && !('cotizacionAviso' in p));
  assert.strictEqual(p.vinculo.hasta, T3);
  assert.strictEqual(p.vinculo.instrumentoId, AL29.id);
  igualesInmutables(p, aplicada);
  assert.strictEqual(M.motorDePosicion(p, CAT), 'ninguno');
  assert.strictEqual(M.aplicarPreciosRutaVieja([p], { al29: 1 }, T3).actualizadas, 0, 'la ruta vieja tampoco la toca');
  sinUndefined(p);
});
t('desvincular: NO restaura el precio previo automáticamente', () => {
  const v = vinculable(pos(), AL29).posicion;
  const aplicada = M.aplicarCotizacion(v, normOk(900, T2));
  const p = M.desvincularPosicion(aplicada, T3).posicion;
  assert.strictEqual(p.currentPrice, 900);
  assert.notStrictEqual(p.currentPrice, v.vinculo.previo.currentPrice);
});
t('desvincular: posición sin precio válido queda sin cotización y manual (sin inventar precio)', () => {
  const nueva = M.crearPosicionDesdeInstrumento(AL29, { platform: 'IOL', units: 10, avgPrice: 700, fecha: '2026-10-01' }, { id: 'n1', ahora: T0 }).posicion;
  const p = M.desvincularPosicion(nueva, T1).posicion;
  assert.strictEqual(p.currentPrice, null);
  assert.strictEqual(p.precioOrigen, 'manual');
  assert.strictEqual(M.estadoCotizacion(p, CAT), 'sin-cotizacion');
  assert.strictEqual(M.calcularRendimiento(p).gananciaPct, null);
  assert.strictEqual(p.vinculo.previo, null);
});
t('desvincular: rechaza posición no vinculada o sin fecha', () => {
  assert.strictEqual(M.desvincularPosicion(pos(), T1).ok, false);
  assert.strictEqual(M.desvincularPosicion(vinculable(pos(), AL29).posicion).ok, false);
});
t('restaurarPrecioPrevio: acción separada; deja la posición EXACTAMENTE como estaba antes de vincular', () => {
  for (const original of [pos(), pos({ precioOrigen: undefined, precioActualizado: undefined }), pos({ precioOrigen: 'manual' })]) {
    const o = JSON.parse(JSON.stringify(original));
    const v = M.vincularPosicion(o, AL29, { ahora: T1, cotizacion: 805, cantidadConfirmada: '1 VN', confirmadas: ['precio-manual'] }).posicion;
    const quote = M.aplicarCotizacion(v, normOk(900, T2));
    const d = M.desvincularPosicion(quote, T3).posicion;
    const r = M.restaurarPrecioPrevio(d);
    assert.ok(r.ok);
    assert.deepStrictEqual(r.posicion, o);
    assert.strictEqual(r.precioReemplazado, 900);
  }
});
t('restaurarPrecioPrevio: rechaza posiciones vinculadas o sin vínculo previo', () => {
  assert.strictEqual(M.restaurarPrecioPrevio(vinculable(pos(), AL29).posicion).ok, false);
  assert.strictEqual(M.restaurarPrecioPrevio(pos()).ok, false);
  const nueva = M.crearPosicionDesdeInstrumento(AL29, { platform: 'IOL', units: 10, avgPrice: 700, fecha: '2026-10-01' }, { id: 'n1', ahora: T0 }).posicion;
  assert.strictEqual(M.restaurarPrecioPrevio(M.desvincularPosicion(nueva, T1).posicion).ok, false, 'una posición creada ya vinculada no tiene precio previo');
});
t('vincular, desvincular, volver a vincular: el nuevo previo es el estado justo antes del último vínculo', () => {
  const v1 = vinculable(pos(), AL29).posicion;
  const d = M.desvincularPosicion(M.aplicarCotizacion(v1, normOk(900, T2)), T3).posicion;
  const v2 = M.vincularPosicion(d, AL29, { ahora: T3, cotizacion: 905, cantidadConfirmada: '1 VN', confirmadas: ['precio-manual'] }).posicion;
  assert.strictEqual(v2.vinculo.previo.currentPrice, 900);
  assert.strictEqual(v2.vinculo.previo.precioOrigen, 'manual');
  assert.strictEqual(M.validarVinculo(v2).length, 0);
});

// ---------- edición manual y cotización pendiente ----------
t('editarPrecioManual: fija manual, borra cotizacion, no toca cantidades; acepta vaciar; rechaza inválidos', () => {
  const v = M.aplicarCotizacion(vinculable(pos(), AL29).posicion, normOk(900, T2));
  const r = M.editarPrecioManual(v, 950, T3);
  assert.ok(r.ok);
  assert.strictEqual(r.posicion.currentPrice, 950);
  assert.strictEqual(r.posicion.precioOrigen, 'manual');
  assert.strictEqual(r.posicion.precioActualizado, T3);
  assert.ok(!('cotizacion' in r.posicion));
  assert.strictEqual(r.posicion.instrumentoId, AL29.id, 'sigue vinculada');
  igualesInmutables(r.posicion, v);
  const vacio = M.editarPrecioManual(v, '', T3);
  assert.strictEqual(vacio.posicion.currentPrice, null);
  assert.strictEqual(vacio.posicion.precioActualizado, null);
  for (const mal of [0, -5, NaN, Infinity, 'abc', '12', {}, true]) assert.strictEqual(M.editarPrecioManual(v, mal, T3).ok, false, String(mal));
  sinUndefined(r.posicion); sinUndefined(vacio.posicion);
});
t('volverAAutomatico: acción explícita; solo vinculada + manual + instrumento automático', () => {
  const v = M.editarPrecioManual(vinculable(pos(), AL29).posicion, 950, T3).posicion;
  assert.strictEqual(M.motorDePosicion(v, CAT), 'ninguno');
  const r = M.volverAAutomatico(v, AL29);
  assert.ok(r.ok);
  assert.strictEqual(r.posicion.precioOrigen, 'auto');
  assert.strictEqual(r.posicion.currentPrice, 950, 'el precio no cambia hasta la próxima cotización');
  assert.strictEqual(M.motorDePosicion(r.posicion, CAT), 'nuevo');
  assert.strictEqual(M.volverAAutomatico(r.posicion, AL29).ok, false, 'ya estaba automática');
  assert.strictEqual(M.volverAAutomatico(v, SPY).ok, false);
  assert.strictEqual(M.volverAAutomatico(pos({ precioOrigen: 'manual' }), AL29).ok, false, 'sin instrumentoId no aplica');
});
t('Cotización pendiente NO sobrescribe una edición manual posterior', () => {
  const v = vinculable(pos(), AL29).posicion;
  const token = M.iniciarActualizacion(v);                       // se pide la cotización
  const editada = M.editarPrecioManual(v, 777, T2).posicion;     // el usuario edita a mano mientras tanto
  const r = M.aplicarCotizacionVigente(editada, token, normOk(900, T3), CAT); // llega la respuesta
  assert.strictEqual(r.aplicada, false);
  assert.strictEqual(r.posicion, editada);
  assert.strictEqual(r.posicion.currentPrice, 777);
  assert.strictEqual(r.posicion.precioOrigen, 'manual');
});
t('Cotización pendiente tampoco pisa: desvinculación, baja de la posición, otra cotización más nueva ni edición al mismo valor', () => {
  const v = vinculable(pos(), AL29).posicion;
  const token = M.iniciarActualizacion(v);
  assert.strictEqual(M.aplicarCotizacionVigente(M.desvincularPosicion(v, T2).posicion, token, normOk(900, T3), CAT).aplicada, false);
  assert.strictEqual(M.aplicarCotizacionVigente(null, token, normOk(900, T3), CAT).motivo, 'posicion-eliminada');
  const otra = M.aplicarCotizacion(v, normOk(850, T3));
  assert.strictEqual(M.aplicarCotizacionVigente(otra, token, normOk(900, T2), CAT).motivo, 'cambio-durante-la-consulta');
  // edición manual al MISMO valor y vuelta a automático: cambia precioOrigen/fecha durante la consulta -> se descarta
  const tok2 = M.iniciarActualizacion(M.aplicarCotizacion(v, normOk(850, T2)));
  const ida = M.editarPrecioManual(M.aplicarCotizacion(v, normOk(850, T2)), 850, T3).posicion;
  const vuelta = M.volverAAutomatico(ida, AL29).posicion;
  assert.strictEqual(M.aplicarCotizacionVigente(vuelta, tok2, normOk(900, T3), CAT).aplicada, false);
  assert.strictEqual(M.aplicarCotizacionVigente(v, { ...token, id: 'otro' }, normOk(900, T3), CAT).motivo, 'otra-posicion');
});
t('Cotización vigente: se aplica si nada cambió, sin tocar cantidades; una cotización más vieja se descarta; fallo conserva el precio', () => {
  const base = M.aplicarCotizacion(vinculable(pos(), AL29).posicion, normOk(850, T2));
  const tok = M.iniciarActualizacion(base);
  const ok = M.aplicarCotizacionVigente(base, tok, normOk(870, T3), CAT);
  assert.ok(ok.aplicada);
  assert.strictEqual(ok.posicion.currentPrice, 870);
  assert.strictEqual(ok.posicion.precioOrigen, 'auto');
  igualesInmutables(ok.posicion, base);
  const vieja = M.aplicarCotizacionVigente(base, tok, normOk(700, T0), CAT);
  assert.strictEqual(vieja.motivo, 'cotizacion-antigua'); assert.strictEqual(vieja.posicion, base);
  const falla = M.aplicarCotizacionVigente(base, tok, { ok: false, motivo: 'sin datos' }, CAT);
  assert.strictEqual(falla.aplicada, false);
  assert.strictEqual(falla.posicion.currentPrice, 850, 'conserva el último precio');
  assert.strictEqual(falla.posicion.cotizacionAviso, 'sin datos');
});

// ---------- altas ----------
t('crearPosicionDesdeInstrumento: automático sin cotización todavía -> "actualizando", sin P/L falso', () => {
  const r = M.crearPosicionDesdeInstrumento(AL29, { platform: 'IOL', units: 10, avgPrice: 700, fecha: '2026-10-01' }, { id: 'n1', ahora: T0 });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.posicion, { id: 'n1', name: 'AL29', platform: 'IOL', fecha: '2026-10-01', units: 10, avgPrice: 700, instrumentoId: AL29.id, currentPrice: null, precioOrigen: 'auto', precioActualizado: null });
  assert.strictEqual(M.estadoCotizacion(r.posicion, CAT), 'actualizando');
  assert.deepStrictEqual(M.calcularRendimiento(r.posicion), { invertido: 7000, valor: null, ganancia: null, gananciaPct: null });
  assert.strictEqual(M.motorDePosicion(r.posicion, CAT), 'nuevo');
  sinUndefined(r.posicion);
});
t('crearPosicionDesdeInstrumento: manual sin precio -> sin cotización, NO 0 %; con precio -> manual', () => {
  const sin = M.crearPosicionDesdeInstrumento(SPY, { platform: 'Bullmarket', units: 3, avgPrice: 20000, fecha: '2026-10-01', currentPrice: '' }, { id: 'n2', ahora: T0 });
  assert.ok(sin.ok);
  assert.strictEqual(sin.posicion.currentPrice, null);
  assert.strictEqual(sin.posicion.precioOrigen, 'manual');
  assert.strictEqual(M.estadoCotizacion(sin.posicion, CAT), 'sin-cotizacion');
  assert.strictEqual(M.calcularRendimiento(sin.posicion).gananciaPct, null);
  assert.strictEqual(M.motorDePosicion(sin.posicion, CAT), 'ninguno');
  const con = M.crearPosicionDesdeInstrumento(SPY, { platform: 'Bullmarket', units: 3, avgPrice: 20000, fecha: '2026-10-01', currentPrice: 21000 }, { id: 'n3', ahora: T0 });
  assert.strictEqual(con.posicion.currentPrice, 21000);
  assert.strictEqual(con.posicion.precioActualizado, T0);
  assert.strictEqual(M.calcularRendimiento(con.posicion).gananciaPct, 5);
  assert.strictEqual(M.estadoCotizacion(con.posicion, CAT), 'manual');
});
t('crearPosicionDesdeInstrumento: name = símbolo (no editable), instrumentoId = identidad; validaciones', () => {
  const ok = { platform: 'IOL', units: 1, avgPrice: 1, fecha: '2026-10-01' };
  assert.strictEqual(M.crearPosicionDesdeInstrumento({ ...SPY, simbolo: '  SPY ' }, ok, { id: 'x', ahora: T0 }).posicion.name, 'SPY');
  const malos = [
    [SPY, { ...ok, platform: 'Banco X' }], [SPY, { ...ok, units: 0 }], [SPY, { ...ok, units: '5' }], [SPY, { ...ok, avgPrice: -1 }],
    [SPY, { ...ok, fecha: '01/10/2026' }], [SPY, { ...ok, fecha: '2026-13-45' }], [SPY, { ...ok, currentPrice: -3 }], [SPY, { ...ok, currentPrice: 'abc' }],
    [{ ...SPY, simbolo: '' }, ok], [{ ...SPY, id: '' }, ok], [AL29, { ...ok, currentPrice: 800 }],
  ];
  for (const [ins, d] of malos) assert.strictEqual(M.crearPosicionDesdeInstrumento(ins, d, { id: 'x', ahora: T0 }).ok, false, JSON.stringify(d));
  assert.strictEqual(M.crearPosicionDesdeInstrumento(SPY, ok, { ahora: T0 }).ok, false);
});
t('crearPosicionDesdeInstrumento: el mismo instrumento en dos plataformas = dos posiciones con el mismo name e instrumentoId', () => {
  const a = M.crearPosicionDesdeInstrumento(AL29, { platform: 'IOL', units: 10, avgPrice: 700, fecha: '2026-10-01' }, { id: 'a', ahora: T0 }).posicion;
  const b = M.crearPosicionDesdeInstrumento(AL29, { platform: 'Bullmarket', units: 4, avgPrice: 730, fecha: '2026-10-02' }, { id: 'b', ahora: T0 }).posicion;
  assert.strictEqual(a.name, b.name); assert.strictEqual(a.instrumentoId, b.instrumentoId);
  assert.notStrictEqual(a.id, b.id); assert.notStrictEqual(a.platform, b.platform);
});
t('calcularRendimiento: con precio coincide con units*(precio-avg); valores inválidos no producen NaN', () => {
  assert.deepStrictEqual(M.calcularRendimiento(pos({ units: 10, avgPrice: 100, currentPrice: 110 })), { invertido: 1000, valor: 1100, ganancia: 100, gananciaPct: 10 });
  for (const mal of [{ currentPrice: 0 }, { currentPrice: -1 }, { currentPrice: 'x' }, { currentPrice: NaN }]) assert.strictEqual(M.calcularRendimiento(pos(mal)).gananciaPct, null);
  assert.strictEqual(M.calcularRendimiento(pos({ avgPrice: 0 })).gananciaPct, null);
});
t('estadoCotizacion: un precio anterior al vínculo se muestra como "actualizando"; luego, automática', () => {
  const v = vinculable(pos(), AL29).posicion;
  assert.strictEqual(M.estadoCotizacion(v, CAT), 'actualizando');
  assert.strictEqual(M.estadoCotizacion(M.aplicarCotizacion(v, normOk(850, T2)), CAT), 'automatica');
  assert.strictEqual(M.estadoCotizacion(pos(), CAT), 'ruta-vieja');
});

// ---------- validarVinculo ----------
t('validarVinculo: detecta metadatos incoherentes', () => {
  const v = vinculable(pos(), AL29).posicion;
  assert.deepStrictEqual(M.validarVinculo(v), []);
  assert.deepStrictEqual(M.validarVinculo(pos()), []);
  assert.deepStrictEqual(M.validarVinculo(M.desvincularPosicion(v, T3).posicion), []);
  assert.deepStrictEqual(M.validarVinculo({ ...v, vinculo: { ...v.vinculo, instrumentoId: 'otro' } }), ['vinculo-incoherente']);
  assert.deepStrictEqual(M.validarVinculo({ ...v, vinculo: { ...v.vinculo, hasta: T3 } }), ['vinculo-cerrado-con-instrumento']);
  const { instrumentoId, ...sinId } = v;
  assert.deepStrictEqual(M.validarVinculo(sinId), ['vinculo-abierto-sin-instrumento']);
  assert.deepStrictEqual(M.validarVinculo({ ...v, instrumentoId: 5 }), ['instrumentoId-invalido', 'vinculo-abierto-sin-instrumento']);
  assert.ok(M.validarVinculo({ ...v, precioOrigen: 'x' }).includes('origen-invalido'));
});

// ---------- Firestore: fusión entre dispositivos y backups ----------
const doc = (positions) => ({ targets: [], positions, aportes: [], movimientos: [], diario: [], metas: [], history: [] });
const fusion = (base, local, remoto) => M.fusionarCampo('positions', base, local, remoto);

t('Fusión: vincular en un dispositivo mientras el otro no cambió -> gana el vínculo completo y coherente', () => {
  const base = [pos()], v = vinculable(pos(), AL29).posicion;
  const r = fusion(base, [v], base);
  assert.deepStrictEqual(r.valor, [v]); assert.deepStrictEqual(r.conflictos, []);
  const r2 = fusion(base, base, [v]);
  assert.deepStrictEqual(r2.valor, [v]);
  assert.deepStrictEqual(M.validarVinculo(r.valor[0]), []);
});
t('Fusión: dos dispositivos vinculan la MISMA posición igual -> sin conflicto', () => {
  const base = [pos()], v = vinculable(pos(), AL29).posicion;
  const r = fusion(base, [JSON.parse(JSON.stringify(v))], [JSON.parse(JSON.stringify(v))]);
  assert.deepStrictEqual(r.conflictos, []); assert.deepStrictEqual(r.valor, [v]);
});
t('Fusión: conflicto -> se conserva una versión COMPLETA (nunca instrumentoId de uno y precioOrigen de otro)', () => {
  const base = [pos()];
  const A = vinculable(pos(), AL29).posicion;                       // dispositivo A vincula
  const B = M.editarPrecioManual(pos(), 820, T2).posicion;          // dispositivo B edita a mano
  const r = fusion(base, [A], [B]);
  assert.strictEqual(r.conflictos.length, 1);
  assert.deepStrictEqual(r.valor, [B], 'política vigente: gana la remota, completa');
  assert.deepStrictEqual(M.validarVinculo(r.valor[0]), []);
  const r2 = fusion(base, [B], [A]);
  assert.deepStrictEqual(r2.valor, [A]);
  assert.deepStrictEqual(M.validarVinculo(r2.valor[0]), []);
});
t('Fusión: cambios en posiciones DISTINTAS se combinan; vincular una no altera la otra', () => {
  const p1 = pos({ id: 'p1' }), p2 = pos({ id: 'p2', platform: 'Bullmarket', units: 5 });
  const v1 = vinculable(p1, AL29).posicion;
  const p2e = M.editarPrecioManual(p2, 810, T2).posicion;
  const r = fusion([p1, p2], [v1, p2], [p1, p2e]);
  assert.deepStrictEqual(r.conflictos, []);
  assert.deepStrictEqual(r.valor.find(x => x.id === 'p1'), v1);
  assert.deepStrictEqual(r.valor.find(x => x.id === 'p2'), p2e);
});
t('Fusión: desvincular en A y cotización automática en B sobre la misma posición -> conflicto con versión completa (sin estado mixto)', () => {
  const v = vinculable(pos(), AL29).posicion;
  const A = M.desvincularPosicion(v, T3).posicion;
  const B = M.aplicarCotizacion(v, normOk(850, T2));
  for (const [l, r] of [[A, B], [B, A]]) {
    const res = fusion([v], [l], [r]);
    assert.strictEqual(res.conflictos.length, 1);
    assert.deepStrictEqual(M.validarVinculo(res.valor[0]), []);
    assert.deepStrictEqual(res.valor[0], r);
  }
});
t('Concurrencia entre dispositivos: la edición manual NO se pierde frente a una cotización automática (con resolverConflictoPosicion)', () => {
  const v = M.aplicarCotizacion(vinculable(pos(), AL29).posicion, normOk(850, T1));
  const manual = M.editarPrecioManual(v, 777, T2).posicion;                     // A: edición manual
  const auto = M.aplicarCotizacion(v, normOk(860, T3));                          // B: cotización automática (aún sin ver la edición)
  // Hallazgo: con la política vigente (gana la remota), si B guarda primero la edición de A se pierde.
  const hoy = fusion([v], [manual], [auto]);
  assert.strictEqual(hoy.conflictos.length, 1);
  assert.strictEqual(hoy.valor[0].precioOrigen, 'auto', 'hoy la política vigente perdería la edición manual de A');
  // Con el resolvedor propuesto, la manual gana en ambos órdenes y la salida es una versión completa.
  assert.strictEqual(M.resolverConflictoPosicion(manual, auto), manual);
  assert.strictEqual(M.resolverConflictoPosicion(auto, manual), manual);
});
t('resolverConflictoPosicion: mismo origen -> más reciente; empate -> remoto; otros campos distintos -> null (política vigente)', () => {
  const v = M.aplicarCotizacion(vinculable(pos(), AL29).posicion, normOk(850, T1));
  const nueva = M.aplicarCotizacion(v, normOk(860, T3)), vieja = M.aplicarCotizacion(v, normOk(855, T2));
  assert.strictEqual(M.resolverConflictoPosicion(nueva, vieja), nueva);
  assert.strictEqual(M.resolverConflictoPosicion(vieja, nueva), nueva);
  const empateA = { ...vieja, currentPrice: 1 }, empateB = { ...vieja, currentPrice: 2 };
  assert.strictEqual(M.resolverConflictoPosicion(empateA, empateB), empateB);
  assert.strictEqual(M.resolverConflictoPosicion({ ...v, units: 999 }, nueva), null);
  assert.strictEqual(M.resolverConflictoPosicion(v, M.desvincularPosicion(v, T3).posicion), null);
  assert.strictEqual(M.resolverConflictoPosicion(v, { ...v, id: 'otra' }), null);
  const m1 = M.editarPrecioManual(v, 700, T2).posicion, m2 = M.editarPrecioManual(v, 710, T3).posicion;
  assert.strictEqual(M.resolverConflictoPosicion(m1, m2), m2);
});
t('Documento completo: fusionarDocumento acepta posiciones con campos nuevos y otros dispositivos viejos las conservan', () => {
  const v = vinculable(pos(), AL29).posicion;
  const r = M.fusionarDocumento(doc([pos()]), doc([v]), doc([pos()]));
  assert.deepStrictEqual(r.doc.positions, [v]); assert.deepStrictEqual(r.conflictos, []);
  // un dispositivo "viejo" guarda otra posición sin tocar la vinculada: no la pierde
  const otra = pos({ id: 'p9', name: 'SPY' });
  const r2 = M.fusionarDocumento(doc([pos()]), doc([pos(), otra]), doc([v]));
  assert.deepStrictEqual(r2.doc.positions.map(x => x.id).sort(), ['p1', 'p9']);
  assert.deepStrictEqual(r2.doc.positions.find(x => x.id === 'p1'), v);
});
t('Firestore: las posiciones con campos nuevos sobreviven a JSON (guardado) sin cambios y sin undefined', () => {
  const casos = [
    vinculable(pos(), AL29).posicion,
    M.desvincularPosicion(vinculable(pos(), AL29).posicion, T3).posicion,
    M.crearPosicionDesdeInstrumento(SPY, { platform: 'IOL', units: 1, avgPrice: 1, fecha: '2026-10-01' }, { id: 'z', ahora: T0 }).posicion,
    M.editarPrecioManual(pos(), null, T2).posicion,
  ];
  for (const c of casos) {
    sinUndefined(c);
    assert.deepStrictEqual(M.copiaProfunda(c), c);
    assert.ok(M.mismoValor(JSON.parse(JSON.stringify(c)), c));
  }
});
t('Backup: validarBackup/aplicarRestauracion aceptan posiciones con instrumentoId/vinculo y las devuelven idénticas', () => {
  const v = vinculable(pos(), AL29).posicion, d = M.desvincularPosicion(vinculable(pos({ id: 'p2' }), AL29).posicion, T3).posicion;
  const backup = JSON.parse(JSON.stringify({ app: 'cartera-inversiones', formatoBackup: 2, positions: [v, d] }));
  const val = M.validarBackup(backup);
  assert.ok(val.ok, val.error);
  const fin = M.aplicarRestauracion({ positions: [pos({ id: 'viejo' })] }, val.campos);
  assert.deepStrictEqual(fin.positions, [v, d]);
  for (const p of fin.positions) assert.deepStrictEqual(M.validarVinculo(p), []);
});
t('Backup viejo (sin campos nuevos) sigue restaurándose y la ruta vieja lo sigue actualizando', () => {
  const viejo = JSON.parse(JSON.stringify({ positions: [pos({ name: 'SPY' })] }));
  const val = M.validarBackup(viejo);
  assert.ok(val.ok);
  const p = M.aplicarRestauracion({}, val.campos).positions[0];
  assert.strictEqual(M.motorDePosicion(p, CAT), 'viejo');
});

// ---------- el bloque es PURO ----------
t('Las funciones del bloque no usan Date.now/new Date/Math.random ni red y no están conectadas a la interfaz', () => {
  const sinComentarios = vinc.replace(/\/\/.*$/gm, '');
  assert.ok(!/Date\.now|new Date|Math\.random|fetch\s*\(|localStorage|setPositions|useState|firebase|firestore/i.test(sinComentarios));
  const resto = html.replace(vinc, '').replace(/\/\/.*$/gm, '');
  for (const f of ['motorDePosicion', 'vincularPosicion', 'desvincularPosicion', 'restaurarPrecioPrevio', 'editarPrecioManual', 'volverAAutomatico',
    'aplicarCotizacionVigente', 'crearPosicionDesdeInstrumento', 'resolverConflictoPosicion', 'evaluarVinculo', 'estadoCotizacion', 'calcularRendimiento', 'indexarCatalogo']) {
    assert.ok(!new RegExp('\\b' + f + '\\b').test(resto), f + ' no debe usarse fuera del bloque en Fase 3.0');
  }
});

fin('Fase 3.0: vinculación');
