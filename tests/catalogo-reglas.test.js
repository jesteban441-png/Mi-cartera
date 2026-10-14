// Fase 2B: reglas por tipo/proveedor, evidencia, estados y lista conservadora aprobada.
const assert = require('assert');
const { ROOT, t, ta, fin, mockRes, fixture, herramientas } = require('./_util');
const I = require(ROOT + '/api/_instrumentos.js');

const fx = fixture();
global.fetch = fx.fetch;

const H = herramientas(I);
const { contraste, documentacion, conEvidencia } = H;

(async () => {
  const res = mockRes();
  await require(ROOT + '/api/catalogo.js')({}, res);
  const by = Object.fromEntries(res.b.instrumentos.map(x => [x.id, x]));
  const D = (panel, s) => by['data912:' + panel + ':' + s];

  // ---------------------------------------------------------------- lista aprobada
  t('CONFIRMADOS: Bitcoin y USDT son AUTOMATICO, validado, USD con conversión por MEP', () => {
    for (const id of ['coingecko:simple:bitcoin', 'coingecko:simple:tether']) {
      const d = by[id];
      assert.strictEqual(d.factorEstado, 'CONFIRMADO', id);
      assert.strictEqual(d.estadoOperativo, 'AUTOMATICO');
      assert.strictEqual(d.validacion, 'validado');
      assert.strictEqual(d.estado, 'soportado');
      assert.strictEqual(d.moneda, 'USD');
      assert.strictEqual(d.factor, 1);
      assert.deepStrictEqual(d.conversion, { a: 'ARS', tipoCambio: 'MEP' });
    }
  });

  t('CONTRASTADOS: solo AL29 y GD38 (bono cada 100 VN, factor 0,01, evidencia individual)', () => {
    for (const s of ['AL29', 'GD38']) {
      const d = D('arg_bonds', s);
      assert.strictEqual(d.factorEstado, 'CONTRASTADO', s);
      assert.strictEqual(d.estadoOperativo, 'AUTOMATICO');
      assert.strictEqual(d.evidenciaOrigen, 'instrumento');
      assert.strictEqual(d.factor, 0.01);
      assert.strictEqual(d.unidadFuente, '100VN');
      assert.strictEqual(d.unidadApp, '1VN');
      assert.strictEqual(d.moneda, 'ARS');
      assert.ok(Array.isArray(d.evidencia) && d.evidencia.length === 1 && d.evidencia[0].instrumento === s);
      assert.ok(d.evidencia[0].difMaxPct > 0 && d.evidencia[0].difMaxPct <= 3);
      assert.ok(d.evidencia[0].limite, 'la evidencia conserva sus límites');
    }
    const auto = res.b.instrumentos.filter(x => x.estadoOperativo === 'AUTOMATICO' && x.factorEstado === 'CONTRASTADO').map(x => x.simbolo).sort();
    assert.deepStrictEqual(auto, ['AL29', 'GD38']);
  });

  t('PENDIENTES: AO27, AO28, TX28 y el resto de bonos', () => {
    for (const s of ['AO27', 'AO28', 'TX28', 'GD30', 'AL29D', 'AL29C', 'GD38D', 'GD38C']) {
      const d = D('arg_bonds', s);
      assert.strictEqual(d.factorEstado, 'PENDIENTE', s);
      assert.strictEqual(d.estadoOperativo, 'MANUAL', s);
      assert.strictEqual(d.estado, 'sin-verificar', s);
      assert.strictEqual(d.factor, null);
    }
  });

  t('PENDIENTES: ningún CEDEAR ni acción queda automático por su categoría', () => {
    const lista = res.b.instrumentos.filter(x => x.tipo === 'cedear' || x.tipo === 'accion');
    assert.ok(lista.length >= 10);
    for (const d of lista) {
      assert.strictEqual(d.estadoOperativo, 'MANUAL', d.id);
      assert.strictEqual(d.factorEstado, 'PENDIENTE', d.id);
      assert.strictEqual(d.estado, 'sin-verificar', d.id);
      assert.strictEqual(d.factor, null, d.id);
      assert.strictEqual(d.moneda, null, d.id);
    }
    for (const s of ['SPY', 'XLK', 'VEA', 'IVV', 'GLD']) assert.strictEqual(D('arg_cedears', s).validacion, 'pendiente', s);
    for (const s of ['GGAL', 'YPFD']) assert.strictEqual(D('arg_stocks', s).validacion, 'pendiente', s);
  });

  t('YFCGO es una ON (obligaciones), no un CEDEAR; MGCEO también; ambas MANUAL con nota', () => {
    for (const s of ['YFCGO', 'MGCEO']) {
      const d = D('arg_corp', s);
      assert.strictEqual(d.tipo, 'on', s);
      assert.strictEqual(d.categoria, 'obligaciones', s);
      assert.strictEqual(d.estadoOperativo, 'MANUAL', s);
      assert.strictEqual(d.factorEstado, 'PENDIENTE', s);
      assert.ok(d.nota && d.nota.length > 20, s + ' debe explicar por qué es manual');
    }
    assert.ok(/no es CEDEAR/.test(D('arg_corp', 'YFCGO').nota));
    assert.strictEqual(by['data912:arg_cedears:YFCGO'], undefined, 'YFCGO no figura como CEDEAR');
    assert.ok(res.b.porCategoria.obligaciones.simbolos.includes('YFCGO'));
    assert.ok(!res.b.porCategoria.cedears.simbolos.includes('YFCGO'));
  });

  t('Letras y FCI quedan pendientes; los tres FCI de Juan sin automatización', () => {
    assert.strictEqual(D('arg_notes', 'S30O6').estadoOperativo, 'MANUAL');
    for (const n of ['Schroder Renta Plus - Clase A', 'MP Ahorro - Clase A', 'MP Empresas Argentinas - Clase A']) {
      const d = res.b.instrumentos.find(x => x.nombre === n);
      assert.ok(d, n);
      assert.strictEqual(d.estadoOperativo, 'MANUAL', n);
      assert.strictEqual(d.factorEstado, 'PENDIENTE', n);
      assert.strictEqual(d.factor, null);
      assert.strictEqual(d.moneda, null);
      assert.deepStrictEqual(d.verificacionPendiente, ['fondo', 'clase', 'moneda', 'unidad'], n);
    }
    for (const d of res.b.instrumentos.filter(x => x.tipo === 'fci')) assert.strictEqual(d.estadoOperativo, 'MANUAL', d.id);
  });

  t('Pesos es efectivo: sin cotización ni fuente, MANUAL, manual-sin-fuente', () => {
    const e = by['efectivo:ars:pesos'];
    assert.ok(e);
    assert.strictEqual(e.tipo, 'efectivo');
    assert.strictEqual(e.categoria, 'efectivo');
    assert.strictEqual(e.fuente, null);
    assert.strictEqual(e.cotiza, false);
    assert.strictEqual(e.estadoOperativo, 'MANUAL');
    assert.strictEqual(e.validacion, 'manual-sin-fuente');
    assert.strictEqual(e.estado, 'solo-manual');
    assert.strictEqual(e.factor, null);
  });

  // ---------------------------------------------------------------- invariantes
  t('Invariante: AUTOMATICO <=> factorEstado != PENDIENTE <=> estado soportado, con unidad, factor y moneda completos', () => {
    for (const d of res.b.instrumentos) {
      assert.ok(I.FACTOR_ESTADOS.includes(d.factorEstado), d.id);
      assert.ok(I.ESTADOS_OPERATIVOS.includes(d.estadoOperativo), d.id);
      assert.ok(I.VALIDACIONES.includes(d.validacion), d.id);
      assert.ok(I.ESTADOS.includes(d.estado), d.id);
      const auto = d.estadoOperativo === 'AUTOMATICO';
      assert.strictEqual(auto, d.factorEstado !== 'PENDIENTE', d.id);
      assert.strictEqual(auto, d.estado === 'soportado', d.id);
      assert.strictEqual(auto, d.validacion === 'validado', d.id);
      if (auto) {
        assert.ok(d.unidadFuente && d.unidadApp && d.moneda, d.id);
        assert.ok(Number.isFinite(d.factor) && d.factor > 0, d.id);
      } else {
        assert.strictEqual(d.factor, null, d.id);
        assert.strictEqual(d.unidadFuente, null, d.id);
        if (d.tipo !== 'efectivo') assert.strictEqual(d.moneda, null, d.id);
      }
    }
  });

  t('Invariante: las variantes de moneda (D/C) nunca son automáticas y señalan su base', () => {
    const variantes = res.b.instrumentos.filter(x => x.posibleVarianteDe);
    assert.ok(variantes.length >= 5);
    for (const d of variantes) { assert.strictEqual(d.estadoOperativo, 'MANUAL', d.id); assert.ok(d.id.endsWith(d.posibleVarianteDe + d.simbolo.slice(-1)), d.id); }
  });

  t('Compatibilidad: simbolos y porCategoria conservan su forma de siempre', () => {
    assert.deepStrictEqual(Object.keys(res.b.porCategoria), ['cedears', 'acciones', 'bonos', 'obligaciones', 'notas']);
    assert.deepStrictEqual(res.b.porCategoria.cedears.simbolos.slice(0, 3), ['AAPL', 'GLD', 'IVV']);
    assert.ok(res.b.simbolos.includes('AL29') && res.b.simbolos.includes('YFCGO'));
    assert.ok(!res.b.simbolos.some(s => /\s/.test(s)), 'los FCI no entran en simbolos');
    assert.ok(res.b.reglas.length === Object.keys(I.REGLAS).length);
  });

  // ---------------------------------------------------------------- mecanismo de reglas
  // Estas pruebas muestran que el sistema NO depende de una lista de símbolos:
  // una regla se valida con evidencia, y entonces cubre toda su clase. Las pruebas
  // de lo que NO debe heredarse están en herencia-reglas.test.js.
  const CED = 'cedears-data912-ars';
  const ALGD = 'bonos-al-gd-data912-ars';

  t('Regla por clase: con contrastes de 3 instrumentos distintos, todo CEDEAR no-variante pasa a CONTRASTADO', () => {
    conEvidencia(CED, [contraste(CED, 'SPY', 20800, 20700), contraste(CED, 'XLK', 7075, 7100), contraste(CED, 'VEA', 11540, 11500)], () => {
      const s = new Set(['SPY', 'SPYD', 'IVV']);
      const ivv = I.definirData912('arg_cedears', 'IVV', s);
      assert.strictEqual(ivv.factorEstado, 'CONTRASTADO');
      assert.strictEqual(ivv.evidenciaOrigen, 'regla');
      assert.strictEqual(ivv.estadoOperativo, 'AUTOMATICO');
      assert.strictEqual(ivv.factor, 1);
      assert.strictEqual(ivv.moneda, 'ARS');
      assert.strictEqual(I.definirData912('arg_cedears', 'SPYD', s).estadoOperativo, 'MANUAL', 'la variante D queda fuera');
      assert.strictEqual(I.definirData912('arg_stocks', 'GGAL', new Set(['GGAL'])).estadoOperativo, 'MANUAL', 'otra regla no se contagia');
      assert.ok(I.reglaValidadaParaClase(I.REGLAS[CED]));
    });
    assert.ok(!I.reglaValidadaParaClase(I.REGLAS[CED]), 'restaurado');
    assert.strictEqual(I.definirData912('arg_cedears', 'IVV', new Set(['IVV'])).estadoOperativo, 'MANUAL');
  });

  t('Regla por clase: con 2 instrumentos NO alcanza (solo esos dos quedan validados)', () => {
    conEvidencia(CED, [contraste(CED, 'SPY', 20800, 20700), contraste(CED, 'XLK', 7075, 7100)], () => {
      const s = new Set(['SPY', 'XLK', 'IVV']);
      assert.strictEqual(I.definirData912('arg_cedears', 'SPY', s).estadoOperativo, 'AUTOMATICO');
      assert.strictEqual(I.definirData912('arg_cedears', 'SPY', s).evidenciaOrigen, 'instrumento');
      assert.strictEqual(I.definirData912('arg_cedears', 'IVV', s).estadoOperativo, 'MANUAL');
      assert.ok(!I.reglaValidadaParaClase(I.REGLAS[CED]));
    });
  });

  t('Regla por clase: repetir el mismo instrumento 3 veces no cuenta como 3 instrumentos', () => {
    conEvidencia(CED, [contraste(CED, 'SPY', 100, 100), contraste(CED, 'SPY', 101, 100), contraste(CED, 'SPY', 99, 100)], () => {
      const s = new Set(['SPY', 'IVV']);
      assert.strictEqual(I.definirData912('arg_cedears', 'IVV', s).estadoOperativo, 'MANUAL');
    });
  });

  t('Evidencia inválida se ignora: diferencia > 3 %, datos faltantes, tipo desconocido, documentación vacía', () => {
    const malas = [
      contraste(CED, 'SPY', 100, 104), // 4 %
      { ...contraste(CED, 'XLK', 100, 100), a: { fuente: 'A' } },
      { ...contraste(CED, 'VEA', 100, 100), a: { fuente: 'A', valor: 0 } },
      { tipo: 'intuicion', instrumento: 'IVV', detalle: 'se ve bien', convencion: I.convencionDe(I.REGLAS[CED]) },
      { ...documentacion(CED, 'GLD'), detalle: '' },
      contraste(CED, '', 100, 100),
    ];
    conEvidencia(CED, malas, () => {
      const s = new Set(['SPY', 'XLK', 'VEA', 'IVV', 'GLD']);
      for (const x of ['SPY', 'XLK', 'VEA', 'IVV', 'GLD']) assert.strictEqual(I.definirData912('arg_cedears', x, s).estadoOperativo, 'MANUAL', x);
    });
    // La diferencia se mide respecto de la segunda cifra (b).
    assert.strictEqual(I.diferenciaMaxPct({ a: { valor: 103 }, b: { valor: 100 } }), 3);
    assert.ok(I.diferenciaMaxPct({ a: { valor: 103.5 }, b: { valor: 100 } }) > 3);
    assert.strictEqual(I.diferenciaMaxPct({ a: { min: 90, max: 110 }, b: { valor: 100 } }), 10);
  });

  t('Bonos AL/GD: un tercer contraste (AL30) habilita a los demás AL y GD, pero no variantes, letras, otras familias ni ONs', () => {
    conEvidencia(ALGD, [contraste(ALGD, 'AL30', 90000, 90500)], () => {
      const s = new Set(['AL29', 'AL29D', 'AL35', 'GD30', 'GD38D', 'AO27', 'AO28', 'TX28', 'S30O6']);
      for (const x of ['AL35', 'GD30']) {
        const d = I.definirData912('arg_bonds', x, s);
        assert.strictEqual(d.estadoOperativo, 'AUTOMATICO', x);
        assert.strictEqual(d.factor, 0.01, x);
        assert.strictEqual(d.evidenciaOrigen, 'regla', x);
      }
      assert.strictEqual(I.definirData912('arg_bonds', 'AL29', s).evidenciaOrigen, 'instrumento', 'la evidencia individual se conserva');
      for (const x of ['AL29D', 'GD38D', 'AO27', 'AO28', 'TX28', 'S30O6']) assert.strictEqual(I.definirData912('arg_bonds', x, s).estadoOperativo, 'MANUAL', x);
      assert.strictEqual(I.definirData912('arg_corp', 'MGCEO', s).estadoOperativo, 'MANUAL', 'otro panel no se contagia');
    });
  });

  t('Documentación de la fuente confirma toda la clase cripto, pero solo para las monedas que el catálogo ofrece', () => {
    const r = I.REGLAS['cripto-coingecko-usd'];
    assert.strictEqual(I.resolverFactor(r, 'bitcoin').factorEstado, 'CONFIRMADO');
    assert.strictEqual(I.resolverFactor(r, 'bitcoin').origen, 'regla');
    assert.strictEqual(I.resolverFactor(r, 'cualquier-otra').factorEstado, 'PENDIENTE', 'una moneda que el catálogo no ofrece no hereda');
    assert.ok(!r.alcance('cualquier-otra'));
    assert.strictEqual(I.definirCripto('no-existe'), null);
    assert.ok(I.reglaValidadaParaClase(r));
  });

  t('FCI: jamás se valida una clase completa; exige fondo, clase, moneda y unidad por instrumento', () => {
    const FCI = 'fci-argentinadatos-vcp';
    const conv = { proveedor: 'argentinadatos', panel: 'rentaFija', moneda: 'ARS', unidadFuente: '1000CP', unidadApp: '1CP', factor: 0.001 };
    const ev = (nombre, identidad, convencion) => ({ tipo: 'contraste', instrumento: nombre, fecha: '2026-10-14', convencion: convencion || conv, a: { fuente: 'A', valor: 1206 }, b: { fuente: 'B', valor: 1200 }, limite: 'prueba', identidad });
    const total = { fondo: true, clase: true, moneda: true, unidad: true, monedaValor: 'ARS' };
    const sinIdentidad = ['MP Ahorro - Clase A', 'MP Empresas Argentinas - Clase A', 'Schroder Renta Plus - Clase A'].map(n => ev(n, undefined));
    conEvidencia(FCI, sinIdentidad, () => {
      for (const n of ['MP Ahorro - Clase A', 'MP Empresas Argentinas - Clase A', 'Schroder Renta Plus - Clase A', 'Otro Fondo - Clase A']) {
        assert.strictEqual(I.definirFCI('rentaFija', n).estadoOperativo, 'MANUAL', n);
      }
    });
    conEvidencia(FCI, [ev('MP Ahorro - Clase A', { ...total, unidad: false })], () => assert.strictEqual(I.definirFCI('rentaFija', 'MP Ahorro - Clase A').estadoOperativo, 'MANUAL', 'falta la unidad'));
    conEvidencia(FCI, [ev('MP Ahorro - Clase A', { fondo: true, clase: true, moneda: true, unidad: true })], () => assert.strictEqual(I.definirFCI('rentaFija', 'MP Ahorro - Clase A').estadoOperativo, 'MANUAL', 'sin moneda explícita no hay automático'));
    conEvidencia(FCI, [ev('MP Ahorro - Clase A', total)], () => {
      const d = I.definirFCI('rentaFija', 'MP Ahorro - Clase A');
      assert.strictEqual(d.estadoOperativo, 'AUTOMATICO');
      assert.strictEqual(d.factor, 0.001);
      assert.strictEqual(d.unidadFuente, '1000CP');
      assert.strictEqual(d.moneda, 'ARS');
      assert.strictEqual(I.definirFCI('rentaFija', 'MP Ahorro - Clase C').estadoOperativo, 'MANUAL', 'otra clase NO se contagia');
      assert.strictEqual(I.definirFCI('mercadoDinero', 'MP Ahorro - Clase A').estadoOperativo, 'MANUAL', 'la evidencia es de la categoría rentaFija');
      assert.ok(!I.reglaValidadaParaClase(I.REGLAS[FCI]));
    });
    assert.strictEqual(I.definirFCI('rentaFija', 'MP Ahorro - Clase A').estadoOperativo, 'MANUAL', 'restaurado');
  });

  t('Estado inicial: solo la regla cripto está validada para su clase; AL/GD tiene 2 de 3 instrumentos', () => {
    const v = Object.fromEntries(I.resumenReglas().map(r => [r.id, r]));
    assert.strictEqual(v['cripto-coingecko-usd'].validadaParaClase, true);
    for (const id of Object.keys(v).filter(k => k !== 'cripto-coingecko-usd')) assert.strictEqual(v[id].validadaParaClase, false, id);
    assert.deepStrictEqual(v['bonos-al-gd-data912-ars'].instrumentosConEvidencia.sort(), ['AL29', 'GD38']);
    for (const id of ['bonos-ao-data912-ars', 'bonos-tx-data912-ars']) assert.deepStrictEqual(v[id].instrumentosConEvidencia, [], id);
    for (const r of Object.values(v)) assert.strictEqual(r.consistente, true, r.id);
  });

  fin('catálogo: reglas y evidencia');
})().catch(e => { console.error('FALLA general', e); process.exit(1); });
