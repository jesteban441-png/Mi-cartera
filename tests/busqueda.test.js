// Fase 2B: búsqueda por símbolo, nombre y alias curados (sin consultas extra).
const assert = require('assert');
const { ROOT, t, ta, fin, mockRes, fixture, FCI_NOMBRES: N } = require('./_util');
const I = require(ROOT + '/api/_instrumentos.js');
const A = require(ROOT + '/api/_alias.js');

const fx = fixture();
global.fetch = fx.fetch;

(async () => {
  const res = mockRes();
  await require(ROOT + '/api/catalogo.js')({}, res);
  const inst = res.b.instrumentos;
  const ids = (q, lim) => A.buscarInstrumentos(q, inst, lim).map(r => r.id);
  const simb = (q, lim) => A.buscarInstrumentos(q, inst, lim).map(r => r.simbolo);

  // Desde acá, cualquier consulta de red sería un error de la búsqueda.
  const antes = fx.pedidos.length;

  t('normalizarTexto: sin acentos, minúsculas, símbolos como espacio', () => {
    assert.strictEqual(A.normalizarTexto('  Obligación NEGOCIABLE — Pampa! '), 'obligacion negociable pampa');
    assert.strictEqual(A.normalizarTexto(null), '');
  });

  t('Símbolo exacto primero: GD38 devuelve el bono y después sus variantes D y C, SEPARADAS', () => {
    const r = A.buscarInstrumentos('gd38', inst);
    assert.deepStrictEqual(r.map(x => x.simbolo), ['GD38', 'GD38C', 'GD38D']);
    assert.strictEqual(r[0].posibleVarianteDe, undefined);
    assert.strictEqual(r[1].posibleVarianteDe, 'GD38');
    assert.strictEqual(r[0].estadoOperativo, 'AUTOMATICO');
    assert.strictEqual(r[1].estadoOperativo, 'MANUAL');
    assert.strictEqual(new Set(r.map(x => x.id)).size, 3);
  });

  t('SPY no se confunde con SPYD; AL29 con AL29D/AL29C', () => {
    assert.deepStrictEqual(simb('spy').slice(0, 2), ['SPY', 'SPYD']);
    assert.strictEqual(A.buscarInstrumentos('spy', inst)[0].estadoOperativo, 'MANUAL');
    assert.deepStrictEqual(simb('al29'), ['AL29', 'AL29C', 'AL29D']);
  });

  t('Alias A027 (con cero) encuentra AO27 (con O); solo para buscar, no unifica', () => {
    const r = A.buscarInstrumentos('A027', inst);
    assert.strictEqual(r[0].simbolo, 'AO27');
    assert.strictEqual(r[0].coincidencia, 'alias');
    assert.strictEqual(r[0].aliasUsado, 'A027');
    assert.deepStrictEqual(simb('ao27'), ['AO27']);
    assert.ok(!simb('ao27').includes('AO28'));
  });

  t('Cripto: bitcoin / btc, usdt / tether / "usdt staking" -> su instrumento', () => {
    for (const q of ['bitcoin', 'BTC', 'Bitcoin BTC']) assert.strictEqual(ids(q)[0], 'coingecko:simple:bitcoin', q);
    for (const q of ['usdt', 'tether', 'usdt staking', 'USDT (staking)']) assert.strictEqual(ids(q)[0], 'coingecko:simple:tether', q);
    assert.strictEqual(A.buscarInstrumentos('btc', inst)[0].estadoOperativo, 'AUTOMATICO');
  });

  t('Pesos: efectivo sin cotización, encontrado por "pesos", "efectivo" y "ars"', () => {
    for (const q of ['pesos', 'efectivo', 'ARS', 'pesos argentinos']) {
      const r = A.buscarInstrumentos(q, inst);
      assert.strictEqual(r[0].id, 'efectivo:ars:pesos', q);
      assert.strictEqual(r[0].validacion, 'manual-sin-fuente');
    }
  });

  t('ONs por nombre: "on ypf" -> YFCGO, "on pampa" / "obligación negociable pampa" -> MGCEO', () => {
    assert.strictEqual(ids('on ypf')[0], 'data912:arg_corp:YFCGO');
    assert.strictEqual(ids('ON Pampa')[0], 'data912:arg_corp:MGCEO');
    assert.strictEqual(ids('obligación negociable pampa')[0], 'data912:arg_corp:MGCEO');
    assert.strictEqual(A.buscarInstrumentos('yfcgo', inst)[0].tipo, 'on');
  });

  t('Nombres conocidos: galicia -> GGAL, apple -> AAPL, mercado libre -> MELI (si existen en el catálogo)', () => {
    assert.strictEqual(ids('galicia')[0], 'data912:arg_stocks:GGAL');
    assert.strictEqual(ids('apple')[0], 'data912:arg_cedears:AAPL');
    assert.strictEqual(ids('Mercado Libre')[0], 'data912:arg_cedears:MELI');
    assert.strictEqual(ids('ypf')[0], 'data912:arg_stocks:YPFD', 'ypf no se confunde con la ON YFCGO');
    assert.deepStrictEqual(ids('oro gld')[0], 'data912:arg_cedears:GLD');
  });

  t('Un alias cuyo instrumento no está en el catálogo no produce resultados', () => {
    const sinMeli = inst.filter(x => x.simbolo !== 'MELI');
    assert.deepStrictEqual(A.buscarInstrumentos('mercado libre', sinMeli), []);
  });

  t('FCI: SCRTAPA -> Schroder Clase A; "mp ahorro" lista Clase A y Clase C por separado', () => {
    const s = A.buscarInstrumentos('scrtapa', inst);
    assert.strictEqual(s[0].nombre, N.schroder);
    assert.strictEqual(s[0].coincidencia, 'alias');
    assert.strictEqual(s[0].idEstable, 'fci:schroder-renta-plus-clase-a');
    const mp = A.buscarInstrumentos('mp ahorro', inst).map(r => r.nombre);
    assert.ok(mp.includes(N.mpAhorro) && mp.includes(N.mpAhorroC));
    assert.strictEqual(mp[0], N.mpAhorro, 'la clase A (alias curado) primero');
    assert.deepStrictEqual(A.buscarInstrumentos('mp ahorro clase c', inst).map(r => r.nombre), [N.mpAhorroC]);
    assert.deepStrictEqual(A.buscarInstrumentos('mp ahorro clase a', inst).map(r => r.nombre), [N.mpAhorro]);
    assert.deepStrictEqual(ids('schroder renta plus clase c'), ['argentinadatos:rentaFija:' + N.schroderC]);
    for (const r of A.buscarInstrumentos('mp', inst)) assert.strictEqual(r.estadoOperativo, 'MANUAL');
  });

  t('Orden: ante igual coincidencia, primero los automáticos; límite y entradas vacías', () => {
    assert.deepStrictEqual(A.buscarInstrumentos('', inst), []);
    assert.deepStrictEqual(A.buscarInstrumentos('   ', inst), []);
    assert.deepStrictEqual(A.buscarInstrumentos('x', null), []);
    assert.deepStrictEqual(A.buscarInstrumentos('zzzz-no-existe', inst), []);
    assert.strictEqual(A.buscarInstrumentos('fondo', inst, 2).length, 2);
    assert.ok(A.buscarInstrumentos('a', inst, 1000).length <= 100);
    const r = A.buscarInstrumentos('gd', inst);
    assert.strictEqual(r[0].estadoOperativo, 'AUTOMATICO');
  });

  t('La búsqueda no hizo ninguna consulta de red (ni BYMA ni otra fuente)', () => {
    assert.strictEqual(fx.pedidos.length, antes);
  });

  await ta('Endpoint /api/catalogo?q=: devuelve resultados; sin q el catálogo completo no cambia', async () => {
    const r = mockRes();
    await require(ROOT + '/api/catalogo.js')({ query: { q: 'a027' } }, r);
    assert.strictEqual(r.b.ok, true);
    assert.strictEqual(r.b.resultados[0].simbolo, 'AO27');
    assert.strictEqual(r.b.instrumentos, undefined, 'con q no devuelve el catálogo entero');
    const r2 = mockRes();
    await require(ROOT + '/api/catalogo.js')({ url: '/api/catalogo?q=mp%20ahorro&limite=1' }, r2);
    assert.strictEqual(r2.b.resultados.length, 1);
    const r3 = mockRes();
    await require(ROOT + '/api/catalogo.js')({ query: {} }, r3);
    assert.ok(Array.isArray(r3.b.instrumentos) && Array.isArray(r3.b.simbolos));
  });

  t('Integridad de alias: refs válidos, sin alias repetido entre instrumentos distintos', () => {
    const vistos = new Map();
    for (const a of A.ALIAS) {
      assert.ok(a.ref && Array.isArray(a.alias) && a.alias.length, JSON.stringify(a));
      if (a.ref.startsWith('fci:')) assert.ok(I.FCI_ASOCIACIONES.some(x => x.idEstable === a.ref), a.ref + ' sin asociación');
      else {
        const p = I.parsearId(a.ref);
        assert.ok(p, a.ref);
        if (p.proveedor === 'data912') assert.ok(I.PANELES_DATA912[p.panel], a.ref);
        else if (p.proveedor === 'coingecko') assert.ok(I.CRIPTO[p.clave], a.ref);
        else if (p.proveedor === 'efectivo') assert.ok(I.EFECTIVO[p.clave], a.ref);
        else assert.fail('proveedor desconocido en ' + a.ref);
      }
      for (const x of a.alias) {
        const n = A.normalizarTexto(x);
        assert.ok(n, 'alias vacío en ' + a.ref);
        assert.ok(!vistos.has(n) || vistos.get(n) === a.ref, `alias "${x}" apunta a dos instrumentos`);
        vistos.set(n, a.ref);
      }
    }
  });

  fin('búsqueda y alias');
})().catch(e => { console.error('FALLA general', e); process.exit(1); });
