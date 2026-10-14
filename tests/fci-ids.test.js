// Fase 2B: ids estables provisionales de FCI, equivalencias, colisiones y
// asociaciones explícitas (sin recorrer categorías).
const assert = require('assert');
const { ROOT, t, ta, fin, mockRes, fixture, FCI_NOMBRES: N } = require('./_util');
const I = require(ROOT + '/api/_instrumentos.js');

const fx = fixture();
global.fetch = fx.fetch;

const llamarPrecios = async ids => {
  fx.pedidos.length = 0;
  const r = mockRes();
  await require(ROOT + '/api/precios.js')({ url: '/api/precios?ids=' + ids.map(encodeURIComponent).join('%2C'), query: { ids: ids.join(',') } }, r);
  return r.b;
};

(async () => {
  t('slugFCI: minúsculas, sin acentos, sin símbolos; la clase forma parte del id', () => {
    assert.strictEqual(I.slugFCI('Schroder Renta Plus - Clase A'), 'schroder-renta-plus-clase-a');
    assert.strictEqual(I.slugFCI('  MP   Ahorro -- Clase  A '), 'mp-ahorro-clase-a');
    assert.strictEqual(I.slugFCI('Fondo Ñandú'), 'fondo-nandu');
    assert.strictEqual(I.slugFCI(''), '');
    assert.strictEqual(I.idEstableFCI(''), null);
    assert.strictEqual(I.idEstableFCI(null), null);
    assert.notStrictEqual(I.idEstableFCI(N.mpAhorro), I.idEstableFCI(N.mpAhorroC), 'Clase A y Clase C son ids distintos');
    assert.notStrictEqual(I.idEstableFCI(N.schroder), I.idEstableFCI(N.schroderC));
  });

  t('El id estable NO depende de la categoría, el id viejo sí; ambos figuran como equivalentes', () => {
    const a = I.definirFCI('rentaFija', N.mpAhorro);
    const b = I.definirFCI('mercadoDinero', N.mpAhorro);
    assert.strictEqual(a.idEstable, b.idEstable);
    assert.notStrictEqual(a.id, b.id);
    assert.strictEqual(a.id, 'argentinadatos:rentaFija:MP Ahorro - Clase A', 'el id existente se conserva');
    assert.deepStrictEqual(a.equivalencias, [a.id], 'asociado: declara su id viejo como equivalente');
    assert.strictEqual(b.equivalencias, undefined, 'no asociado: el id del catálogo ya es el id viejo');
    assert.strictEqual(a.categoria, 'fci');
    assert.strictEqual(a.subcategoria, 'rentaFija');
  });

  t('Tabla de asociaciones: consistente (id <-> nombre exacto), sin repetidos ni colisiones', () => {
    assert.deepStrictEqual(I.validarAsociacionesFCI(), []);
    assert.strictEqual(I.FCI_ASOCIACIONES.length, 3);
    for (const a of I.FCI_ASOCIACIONES) {
      assert.strictEqual(a.fuente, 'argentinadatos');
      assert.ok(I.CATEGORIAS_FCI.includes(a.categoria));
      assert.deepStrictEqual(a.pendiente, ['fondo', 'clase', 'moneda', 'unidad']);
    }
  });

  t('Colisiones: nombres distintos con el mismo slug, o el mismo nombre en dos categorías, NO se fusionan', () => {
    const col = I.detectarColisionesFCI([
      { categoria: 'rentaMixta', nombre: 'Fondo Ñandú' },
      { categoria: 'rentaMixta', nombre: 'Fondo Nandu' },
      { categoria: 'otros', nombre: 'Fondo Doble' },
      { categoria: 'retornoTotal', nombre: 'Fondo Doble' },
      { categoria: 'rentaFija', nombre: N.mpAhorro },
      { categoria: 'rentaFija', nombre: N.mpAhorroC },
      { categoria: 'rentaFija', nombre: N.mpAhorro }, // misma entrada repetida: no es colisión
    ]);
    assert.deepStrictEqual(Object.keys(col).sort(), ['fci:fondo-doble', 'fci:fondo-nandu']);
    assert.strictEqual(col['fci:fondo-nandu'].length, 2);
    assert.strictEqual(col['fci:fondo-doble'].length, 2);
  });

  await ta('Catálogo: el id estable de un fondo en colisión se retira; el id viejo sigue; los demás conservan el suyo', async () => {
    const res = mockRes();
    await require(ROOT + '/api/catalogo.js')({}, res);
    const fci = res.b.instrumentos.filter(x => x.tipo === 'fci');
    assert.deepStrictEqual(res.b.colisionesFCI.sort(), ['fci:fondo-doble', 'fci:fondo-nandu']);
    for (const nom of ['Fondo Ñandú', 'Fondo Nandu', 'Fondo Doble']) {
      const d = fci.filter(x => x.nombre === nom);
      assert.ok(d.length >= 1, nom);
      for (const x of d) { assert.strictEqual(x.idEstable, null, nom); assert.ok(x.idEstableEnColision, nom); assert.ok(x.id.startsWith('argentinadatos:'), nom); }
    }
    assert.strictEqual(fci.filter(x => x.nombre === 'Fondo Doble').length, 2, 'las dos categorías siguen listadas por separado');
    const a = fci.find(x => x.nombre === N.mpAhorro);
    const c = fci.find(x => x.nombre === N.mpAhorroC);
    assert.strictEqual(a.idEstable, 'fci:mp-ahorro-clase-a');
    assert.strictEqual(c.idEstable, 'fci:mp-ahorro-clase-c');
    assert.notStrictEqual(a.id, c.id, 'las clases nunca se fusionan');
    assert.ok(fci.some(x => x.subcategoria === 'retornoTotal' && x.nombre === 'Fondo Solo Retorno'), 'retornoTotal incluido');
    assert.ok(fx.pedidos.includes('https://api.argentinadatos.com/v1/finanzas/fci/retornoTotal/ultimo'));
  });

  await ta('precios: id estable de un fondo asociado -> consulta SOLO su categoría y responde bajo el id pedido', async () => {
    const b = await llamarPrecios(['fci:schroder-renta-plus-clase-a']);
    const r = b.resultados['fci:schroder-renta-plus-clase-a'];
    assert.ok(r && r.ok);
    assert.strictEqual(r.id, 'fci:schroder-renta-plus-clase-a');
    assert.strictEqual(r.idInterno, 'argentinadatos:rentaFija:Schroder Renta Plus - Clase A');
    assert.strictEqual(r.precioFuente, 132295.509);
    assert.strictEqual(r.fechaCotizacion, '2026-09-30');
    assert.strictEqual(r.estado, 'sin-verificar');
    assert.strictEqual(r.estadoOperativo, 'MANUAL');
    assert.strictEqual(r.unidadFuente, null);
    assert.strictEqual(r.monedaFuente, null);
    assert.deepStrictEqual(Object.keys(b.resultados), ['fci:schroder-renta-plus-clase-a'], 'no devuelve además el id interno');
    assert.deepStrictEqual(fx.pedidos, ['https://api.argentinadatos.com/v1/finanzas/fci/rentaFija/ultimo'], 'no recorre otras categorías');
  });

  await ta('precios: los 3 fondos asociados, cada uno en su categoría (2 categorías, 2 consultas)', async () => {
    const ids = ['fci:schroder-renta-plus-clase-a', 'fci:mp-ahorro-clase-a', 'fci:mp-empresas-argentinas-clase-a'];
    const b = await llamarPrecios(ids);
    assert.deepStrictEqual(Object.keys(b.resultados).sort(), ids.slice().sort());
    assert.strictEqual(b.resultados['fci:mp-ahorro-clase-a'].precioFuente, 1206.333);
    assert.strictEqual(b.resultados['fci:mp-empresas-argentinas-clase-a'].precioFuente, 884.502);
    assert.deepStrictEqual(fx.pedidos.slice().sort(), [
      'https://api.argentinadatos.com/v1/finanzas/fci/rentaFija/ultimo',
      'https://api.argentinadatos.com/v1/finanzas/fci/rentaVariable/ultimo',
    ]);
  });

  await ta('precios: id estable SIN asociación explícita se rechaza (aunque el fondo exista) y no consulta la fuente', async () => {
    const b = await llamarPrecios(['fci:schroder-renta-plus-clase-c', 'fci:no-existe', 'fci:']);
    for (const id of Object.keys(b.resultados)) { assert.strictEqual(b.resultados[id].ok, false, id); assert.ok(/asociación explícita/.test(b.resultados[id].motivo), id); }
    assert.strictEqual(Object.keys(b.resultados).length, 3);
    assert.deepStrictEqual(fx.pedidos, [], 'no hizo ninguna consulta');
    const clase = await llamarPrecios([ 'argentinadatos:rentaFija:' + N.schroderC ]);
    assert.strictEqual(clase.resultados['argentinadatos:rentaFija:' + N.schroderC].precioFuente, 120000.1, 'por su id con categoría sí se puede');
  });

  await ta('precios: el id viejo con categoría sigue funcionando igual; pedir ambos devuelve ambos', async () => {
    const viejo = 'argentinadatos:rentaFija:' + N.mpAhorro;
    const b1 = await llamarPrecios([viejo]);
    assert.strictEqual(b1.resultados[viejo].precioFuente, 1206.333);
    assert.strictEqual(b1.resultados[viejo].idInterno, undefined);
    const b2 = await llamarPrecios([viejo, 'fci:mp-ahorro-clase-a']);
    assert.deepStrictEqual(Object.keys(b2.resultados).sort(), [viejo, 'fci:mp-ahorro-clase-a'].sort());
    assert.strictEqual(b2.resultados[viejo].precioFuente, b2.resultados['fci:mp-ahorro-clase-a'].precioFuente);
    assert.strictEqual(fx.pedidos.length, 1, 'una sola consulta a la categoría');
  });

  await ta('precios: efectivo no cotiza y no consulta ninguna fuente', async () => {
    const b = await llamarPrecios(['efectivo:ars:pesos']);
    const r = b.resultados['efectivo:ars:pesos'];
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.estado, 'solo-manual');
    assert.strictEqual(r.validacion, 'manual-sin-fuente');
    assert.strictEqual(r.precioFuente, undefined);
    assert.deepStrictEqual(fx.pedidos, []);
  });

  await ta('precios: campos de validación informativos; los de siempre no cambian (AL29 y Bitcoin automáticos, SPY manual)', async () => {
    const b = await llamarPrecios(['data912:arg_bonds:AL29', 'coingecko:simple:bitcoin', 'data912:arg_cedears:SPY']);
    const al = b.resultados['data912:arg_bonds:AL29'];
    assert.strictEqual(al.estado, 'soportado');
    assert.strictEqual(al.unidadFuente, '100VN');
    assert.strictEqual(al.monedaFuente, 'ARS');
    assert.strictEqual(al.factorEstado, 'CONTRASTADO');
    assert.strictEqual(al.estadoOperativo, 'AUTOMATICO');
    const bt = b.resultados['coingecko:simple:bitcoin'];
    assert.strictEqual(bt.factorEstado, 'CONFIRMADO');
    assert.strictEqual(bt.monedaFuente, 'USD');
    assert.strictEqual(b.tiposCambio.MEP.valor, 1539.4);
    const spy = b.resultados['data912:arg_cedears:SPY'];
    assert.strictEqual(spy.estado, 'sin-verificar');
    assert.strictEqual(spy.unidadFuente, null);
    assert.strictEqual(spy.precioFuente, 20000, 'el precio crudo igual se informa');
  });

  fin('FCI: ids, equivalencias y asociaciones');
})().catch(e => { console.error('FALLA general', e); process.exit(1); });
