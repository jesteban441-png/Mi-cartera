// Fase 2B (revisión de seguridad): una regla validada por clase solo puede
// habilitar instrumentos que compartan EXACTAMENTE proveedor, panel, moneda de
// cotización, unidad de origen, unidad de la app y factor. Estas pruebas intentan
// forzar herencias incorrectas y verifican que no ocurran.
const assert = require('assert');
const { ROOT, t, ta, fin, mockRes, fixture, herramientas } = require('./_util');
const I = require(ROOT + '/api/_instrumentos.js');
const { contraste, documentacion, conEvidencia, conRegla } = herramientas(I);

const CED = 'cedears-data912-ars';
const ACC = 'acciones-data912-ars';
const ALGD = 'bonos-al-gd-data912-ars';
const AO = 'bonos-ao-data912-ars';
const TX = 'bonos-tx-data912-ars';
const FCI = 'fci-argentinadatos-vcp';
const CRI = 'cripto-coingecko-usd';

const auto = (panel, simbolo, simbolos) => I.definirData912(panel, simbolo, new Set(simbolos)).estadoOperativo === 'AUTOMATICO';
const tres = (regla, a, b, c) => [contraste(regla, a, 100, 100), contraste(regla, b, 100, 101), contraste(regla, c, 100, 99)];
// Cada atributo de la convención con un valor DISTINTO del de la regla.
const OTRO_VALOR = { proveedor: 'otro-proveedor', panel: 'arg_stocks', moneda: 'USD', unidadFuente: '100', unidadApp: '2', factor: 2 };

(async () => {
  // ------------------------------------------------------------------ 1. los seis atributos
  for (const [reglaId, panel, simbolos] of [[CED, 'arg_cedears', ['SPY', 'XLK', 'VEA', 'IVV']], [ALGD, 'arg_bonds', ['AL30', 'AL35', 'GD30', 'GD41']]]) {
    for (const campo of I.CAMPOS_CONVENCION) {
      t(`${reglaId}: evidencia con ${campo} distinto NO cuenta (ni para la clase ni para el propio instrumento)`, () => {
        const mala = simbolos.slice(0, 3).map(s => contraste(reglaId, s, 100, 100, { convencion: { [campo]: OTRO_VALOR[campo] } }));
        assert.notStrictEqual(mala[0].convencion[campo], I.REGLAS[reglaId][campo], 'la prueba debe cambiar el atributo');
        conEvidencia(reglaId, mala, () => {
          assert.ok(!I.reglaValidadaParaClase(I.REGLAS[reglaId]));
          for (const s of simbolos) assert.ok(!auto(panel, s, simbolos), s);
        });
      });
    }
  }

  t('Evidencia sin convención, con convención parcial o con campos de más/menos: no cuenta', () => {
    const base = contraste(CED, 'SPY', 100, 100);
    const sinConv = { ...base }; delete sinConv.convencion;
    const parcial = { ...base, convencion: { proveedor: 'data912', panel: 'arg_cedears' } };
    const nula = { ...base, convencion: null };
    const comoTexto = { ...base, convencion: 'data912/arg_cedears/ARS/1/1/1' };
    const factorTexto = { ...base, convencion: { ...base.convencion, factor: '1' } };
    conEvidencia(CED, [sinConv, parcial, nula, comoTexto, factorTexto], () => assert.ok(!auto('arg_cedears', 'SPY', ['SPY'])));
    assert.ok(I.mismaConvencion(base.convencion, I.convencionDe(I.REGLAS[CED])));
    assert.ok(!I.mismaConvencion(null, I.convencionDe(I.REGLAS[CED])));
    assert.ok(!I.mismaConvencion(factorTexto.convencion, I.convencionDe(I.REGLAS[CED])), '1 y "1" no son lo mismo');
  });

  t('Cambiar la convención de una regla invalida la evidencia ya registrada (AL29/GD38 vuelven a MANUAL)', () => {
    assert.ok(auto('arg_bonds', 'AL29', ['AL29']));
    conRegla(ALGD, { moneda: 'USD' }, () => { assert.ok(!auto('arg_bonds', 'AL29', ['AL29'])); assert.ok(!auto('arg_bonds', 'GD38', ['GD38'])); });
    conRegla(ALGD, { unidadFuente: '1', unidadApp: '1', factor: 1 }, () => assert.ok(!auto('arg_bonds', 'AL29', ['AL29'])));
    conRegla(ALGD, { panel: 'arg_corp' }, () => assert.ok(!auto('arg_bonds', 'AL29', ['AL29'])));
    conRegla(ALGD, { proveedor: 'bymadata' }, () => assert.ok(!auto('arg_bonds', 'AL29', ['AL29'])));
    assert.ok(auto('arg_bonds', 'AL29', ['AL29']), 'restaurado');
  });

  t('Coherencia: un factor que no corresponde a las unidades jamás habilita nada, aunque haya evidencia', () => {
    assert.ok(I.reglaConsistente(I.REGLAS[ALGD]) && I.reglaConsistente(I.REGLAS[CED]) && I.reglaConsistente(I.REGLAS[FCI]) && I.reglaConsistente(I.REGLAS[CRI]));
    for (const mal of [{ factor: 0.1 }, { factor: 1 }, { factor: 0 }, { factor: -0.01 }, { factor: NaN }, { factor: '0.01' }, { unidadApp: '1CP' }, { unidadFuente: 'cien' }, { unidadFuente: null }]) {
      conRegla(ALGD, mal, () => {
        assert.ok(!I.reglaConsistente(I.REGLAS[ALGD]), JSON.stringify(mal));
        // la evidencia se re-declara con la convención alterada para que solo falle la coherencia
        const ev = ['AL29', 'GD38', 'AL30'].map(s => contraste(ALGD, s, 100, 100));
        conEvidencia(ALGD, ev, () => { assert.ok(!auto('arg_bonds', 'AL29', ['AL29']), JSON.stringify(mal)); assert.ok(!I.reglaValidadaParaClase(I.REGLAS[ALGD])); });
      });
    }
    assert.ok(!I.reglaConsistente(null));
  });

  t('Documentación de la fuente con otra moneda / unidad / proveedor no confirma la regla cripto', () => {
    for (const campo of I.CAMPOS_CONVENCION) {
      // un valor distinto del que tiene la regla (la cripto ya cotiza en USD: probar con ARS)
      const distinto = I.REGLAS[CRI][campo] === OTRO_VALOR[campo] ? (campo === 'moneda' ? 'ARS' : 'x') : OTRO_VALOR[campo];
      assert.notStrictEqual(distinto, I.REGLAS[CRI][campo]);
      const doc = documentacion(CRI, null, { convencion: { [campo]: distinto } });
      conRegla(CRI, { evidencia: [doc] }, () => {
        assert.strictEqual(I.resolverFactor(I.REGLAS[CRI], 'bitcoin').factorEstado, 'PENDIENTE', campo);
        assert.ok(!I.reglaValidadaParaClase(I.REGLAS[CRI]), campo);
      });
    }
    assert.strictEqual(I.resolverFactor(I.REGLAS[CRI], 'bitcoin').factorEstado, 'CONFIRMADO', 'restaurado');
  });

  // ------------------------------------------------------------------ 2. variantes en dólares
  t('CEDEARs: con la regla validada por 3 instrumentos, las variantes D y C NO la heredan', () => {
    conEvidencia(CED, tres(CED, 'SPY', 'XLK', 'VEA'), () => {
      const s = ['SPY', 'SPYD', 'SPYC', 'XLK', 'VEA', 'IVV', 'IVVD', 'AAPL', 'AAPLD'];
      assert.ok(I.reglaValidadaParaClase(I.REGLAS[CED], { simbolosPanel: new Set(s) }));
      for (const x of ['SPY', 'XLK', 'VEA', 'IVV', 'AAPL']) assert.ok(auto('arg_cedears', x, s), x + ' sí hereda');
      for (const x of ['SPYD', 'SPYC', 'IVVD', 'AAPLD']) assert.ok(!auto('arg_cedears', x, s), x + ' NO hereda');
    });
  });

  t('Tickers terminados en D/C cuya base no figura (posible dólar): no heredan por clase; solo con evidencia propia', () => {
    conEvidencia(CED, tres(CED, 'SPY', 'XLK', 'VEA'), () => {
      const s = ['SPY', 'XLK', 'VEA', 'GLD', 'AMD', 'MCD'];
      for (const x of ['GLD', 'AMD', 'MCD']) assert.ok(!auto('arg_cedears', x, s), x + ' no hereda por clase');
      // con evidencia propia sí (ARS verificado para ese ticker), sin contagiar a otros
      conEvidencia(CED, [contraste(CED, 'GLD', 100, 101)], () => {
        assert.ok(auto('arg_cedears', 'GLD', s), 'GLD con evidencia propia');
        assert.strictEqual(I.definirData912('arg_cedears', 'GLD', new Set(s)).evidenciaOrigen, 'instrumento');
        assert.ok(!auto('arg_cedears', 'AMD', s), 'AMD no se contagia');
      });
    });
    // y esos tickers no cuentan como "uno de los tres" de la clase
    conEvidencia(CED, [contraste(CED, 'GLD', 100, 100), contraste(CED, 'AMD', 100, 100), contraste(CED, 'MCD', 100, 100)], () => {
      assert.ok(!I.reglaValidadaParaClase(I.REGLAS[CED]));
      assert.ok(!auto('arg_cedears', 'IVV', ['GLD', 'AMD', 'MCD', 'IVV']));
    });
  });

  t('Variantes de tickers cortos: KOD (base KO) es variante; GLD/AMD/MCD (sin base) no la heredan por clase', () => {
    assert.ok(I.esPosibleVarianteMoneda('KOD', new Set(['KO', 'KOD'])));
    assert.ok(!I.esPosibleVarianteMoneda('GLD', new Set(['GLD'])));
    assert.ok(!I.esPosibleVarianteMoneda('SPY', new Set(['SPY'])));
    conEvidencia(CED, tres(CED, 'SPY', 'XLK', 'VEA'), () => {
      const s = ['SPY', 'XLK', 'VEA', 'KO', 'KOD', 'GLD'];
      assert.ok(auto('arg_cedears', 'KO', s));
      assert.ok(!auto('arg_cedears', 'KOD', s), 'KOD es la variante de KO');
      assert.ok(!auto('arg_cedears', 'GLD', s));
      assert.strictEqual(I.definirData912('arg_cedears', 'KOD', new Set(s)).posibleVarianteDe, 'KO');
    });
  });

  t('La evidencia de una variante de moneda no cuenta para el umbral de la clase', () => {
    conEvidencia(CED, [contraste(CED, 'SPY', 100, 100), contraste(CED, 'XLK', 100, 100), contraste(CED, 'SPYD', 100, 100)], () => {
      const s = ['SPY', 'SPYD', 'XLK', 'IVV'];
      assert.ok(!auto('arg_cedears', 'IVV', s));
      assert.ok(!auto('arg_cedears', 'SPYD', s), 'la variante tampoco queda validada por su propia evidencia');
    });
  });

  t('Acciones: YPFD (ARS, termina en D) y las variantes no heredan por clase; GGAL y PAMP sí', () => {
    conEvidencia(ACC, tres(ACC, 'GGAL', 'PAMP', 'BMA'), () => {
      const s = ['GGAL', 'GGALD', 'PAMP', 'BMA', 'YPFD', 'TECO2'];
      for (const x of ['GGAL', 'PAMP', 'BMA', 'TECO2']) assert.ok(auto('arg_stocks', x, s), x);
      for (const x of ['GGALD', 'YPFD']) assert.ok(!auto('arg_stocks', x, s), x);
      assert.strictEqual(I.definirData912('arg_stocks', 'GGAL', new Set(s)).moneda, 'ARS');
    });
  });

  t('Bonos: AL29D, AL29C, GD38D y GD38C nunca heredan ni cuentan, aunque AL/GD esté validada por clase', () => {
    conEvidencia(ALGD, [contraste(ALGD, 'AL30', 100, 100)], () => {
      const s = ['AL29', 'AL29D', 'AL29C', 'GD38', 'GD38D', 'GD38C', 'AL30', 'AL35'];
      assert.ok(I.reglaValidadaParaClase(I.REGLAS[ALGD]));
      assert.ok(auto('arg_bonds', 'AL35', s));
      for (const x of ['AL29D', 'AL29C', 'GD38D', 'GD38C']) { assert.ok(!auto('arg_bonds', x, s), x); assert.strictEqual(I.definirData912('arg_bonds', x, new Set(s)).regla, undefined, x + ' no tiene regla'); }
    });
    conEvidencia(ALGD, [contraste(ALGD, 'AL29D', 100, 100), contraste(ALGD, 'GD38D', 100, 100), contraste(ALGD, 'GD38C', 100, 100)], () => {
      assert.ok(!I.reglaValidadaParaClase(I.REGLAS[ALGD]), 'AL29 y GD38 siguen siendo 2 de 3: las variantes no suman');
      assert.ok(!auto('arg_bonds', 'AL35', ['AL35']), 'evidencia de variantes no habilita a nadie');
    });
  });

  // ------------------------------------------------------------------ 3. bonos de otras convenciones
  t('Bonos: AL/GD validada NO habilita AO ni TX; cada familia necesita su propia evidencia', () => {
    conEvidencia(ALGD, [contraste(ALGD, 'AL30', 100, 100)], () => {
      const s = ['AL29', 'GD38', 'AL30', 'AO27', 'AO28', 'TX28', 'TX26'];
      assert.ok(I.reglaValidadaParaClase(I.REGLAS[ALGD]));
      for (const x of ['AO27', 'AO28', 'TX28', 'TX26']) assert.ok(!auto('arg_bonds', x, s), x);
    });
    assert.ok(!I.reglaValidadaParaClase(I.REGLAS[AO]) && !I.reglaValidadaParaClase(I.REGLAS[TX]));
  });

  t('Bonos: la evidencia de AO27 puesta en la regla AL/GD no cuenta (otra familia)', () => {
    conEvidencia(ALGD, [contraste(ALGD, 'AO27', 100, 100), contraste(ALGD, 'TX28', 100, 100), contraste(ALGD, 'AO28', 100, 100)], () => {
      assert.ok(!I.reglaValidadaParaClase(I.REGLAS[ALGD]), 'AL29 y GD38 siguen siendo 2 de 3');
      assert.ok(!auto('arg_bonds', 'AL35', ['AL35']));
      assert.ok(!auto('arg_bonds', 'AO27', ['AO27']));
    });
  });

  t('Bonos: tres contrastes de la familia AO validan solo la familia AO', () => {
    conEvidencia(AO, tres(AO, 'AO26', 'AO27', 'AO28'), () => {
      const s = ['AO26', 'AO27', 'AO28', 'AO29', 'AL29', 'GD38', 'TX28', 'AO27D'];
      assert.ok(auto('arg_bonds', 'AO29', s));
      assert.strictEqual(I.definirData912('arg_bonds', 'AO29', new Set(s)).regla, AO);
      assert.ok(!auto('arg_bonds', 'TX28', s));
      assert.ok(!auto('arg_bonds', 'AO27D', s));
      assert.ok(auto('arg_bonds', 'AL29', s), 'AL29 conserva su evidencia individual');
    });
  });

  t('resolverFactor directo: la evidencia de un instrumento fuera del alcance de la regla no lo valida (defensa independiente de definirData912)', () => {
    conEvidencia(ALGD, [contraste(ALGD, 'AO27', 100, 100), contraste(ALGD, 'AL29D', 100, 100), contraste(ALGD, 'TX28', 100, 100)], () => {
      for (const x of ['AO27', 'AL29D', 'TX28']) assert.strictEqual(I.resolverFactor(I.REGLAS[ALGD], x, { simbolosPanel: new Set([x]) }).factorEstado, 'PENDIENTE', x);
      assert.strictEqual(I.resolverFactor(I.REGLAS[ALGD], 'AL29', { simbolosPanel: new Set() }).factorEstado, 'CONTRASTADO', 'control: AL29 sigue validado por su evidencia');
    });
    conEvidencia(CED, [contraste(CED, 'SPYD', 100, 100)], () => assert.strictEqual(I.resolverFactor(I.REGLAS[CED], 'SPYD', { simbolosPanel: new Set(['SPY', 'SPYD']) }).factorEstado, 'PENDIENTE'));
  });

  t('Bonos: un ticker de otra familia o con otra forma (S30O6, AL29X, ALX29, TX2) nunca se asigna a una regla de bonos', () => {
    for (const x of ['S30O6', 'AL29X', 'ALX29', 'TX2', 'AL', 'GD3', 'AO270', 'XAL29']) {
      assert.strictEqual(I.definirData912('arg_bonds', x, new Set([x])).regla, undefined, x);
    }
  });

  // ------------------------------------------------------------------ 4. ON, letras y otros paneles
  t('ONs y letras no tienen regla: ni siquiera con TODAS las demás reglas validadas heredan algo', () => {
    const todo = [
      [CED, tres(CED, 'SPY', 'XLK', 'VEA')], [ACC, tres(ACC, 'GGAL', 'PAMP', 'BMA')], [ALGD, [contraste(ALGD, 'AL30', 100, 100)]],
      [AO, tres(AO, 'AO26', 'AO27', 'AO28')], [TX, tres(TX, 'TX26', 'TX27', 'TX28')],
    ];
    const anidar = (i, f) => (i === todo.length ? f() : conEvidencia(todo[i][0], todo[i][1], () => anidar(i + 1, f)));
    anidar(0, () => {
      for (const [panel, x] of [['arg_corp', 'MGCEO'], ['arg_corp', 'YFCGO'], ['arg_corp', 'AL29'], ['arg_notes', 'S30O6'], ['arg_notes', 'AL30'], ['arg_corp', 'SPY']]) {
        const d = I.definirData912(panel, x, new Set([x]));
        assert.strictEqual(d.estadoOperativo, 'MANUAL', panel + ':' + x);
        assert.strictEqual(d.regla, undefined, panel + ':' + x);
        assert.strictEqual(d.factor, null);
      }
      assert.strictEqual(I.definirData912('arg_cedears', 'AL30', new Set(['AL30'])).regla, CED, 'cada panel solo usa las reglas de su panel');
    });
  });

  t('Evidencia de un panel puesta en la regla de otro panel (misma moneda y unidad) tampoco cuenta', () => {
    const deAcciones = ['GGAL', 'PAMP', 'BMA'].map(s => contraste(ACC, s, 100, 100));
    conEvidencia(CED, deAcciones, () => { assert.ok(!I.reglaValidadaParaClase(I.REGLAS[CED])); assert.ok(!auto('arg_cedears', 'IVV', ['IVV'])); });
    const deCedears = ['SPY', 'XLK', 'VEA'].map(s => contraste(CED, s, 100, 100));
    conEvidencia(ACC, deCedears, () => assert.ok(!I.reglaValidadaParaClase(I.REGLAS[ACC])));
    const deBonos = ['AL29', 'GD38', 'AL30'].map(s => contraste(ALGD, s, 100, 100));
    conEvidencia(CED, deBonos, () => assert.ok(!I.reglaValidadaParaClase(I.REGLAS[CED])));
  });

  // ------------------------------------------------------------------ 5. FCI
  t('FCI: aun con evidencia completa de tres fondos, solo esos tres (en su categoría) quedan automáticos', () => {
    const conv = c => ({ proveedor: 'argentinadatos', panel: c, moneda: 'ARS', unidadFuente: '1000CP', unidadApp: '1CP', factor: 0.001 });
    const ev = (n, c) => ({ tipo: 'contraste', instrumento: n, fecha: '2026-10-14', convencion: conv(c), a: { fuente: 'A', valor: 1000 }, b: { fuente: 'B', valor: 1001 }, limite: 'prueba', identidad: { fondo: true, clase: true, moneda: true, unidad: true, monedaValor: 'ARS' } });
    conEvidencia(FCI, [ev('F1 - Clase A', 'rentaFija'), ev('F2 - Clase A', 'rentaFija'), ev('F3 - Clase A', 'rentaVariable')], () => {
      for (const [c, n] of [['rentaFija', 'F1 - Clase A'], ['rentaFija', 'F2 - Clase A'], ['rentaVariable', 'F3 - Clase A']]) assert.strictEqual(I.definirFCI(c, n).estadoOperativo, 'AUTOMATICO', n);
      for (const [c, n] of [['rentaFija', 'F1 - Clase C'], ['rentaFija', 'F4 - Clase A'], ['rentaVariable', 'F1 - Clase A'], ['mercadoDinero', 'F2 - Clase A']]) assert.strictEqual(I.definirFCI(c, n).estadoOperativo, 'MANUAL', c + ' ' + n);
      assert.ok(!I.reglaValidadaParaClase(I.REGLAS[FCI]));
    });
  });

  t('FCI: tres fondos con evidencia completa en la MISMA categoría tampoco habilitan a los demás de esa categoría', () => {
    const conv = { proveedor: 'argentinadatos', panel: 'rentaFija', moneda: 'ARS', unidadFuente: '1000CP', unidadApp: '1CP', factor: 0.001 };
    const ev = n => ({ tipo: 'contraste', instrumento: n, fecha: '2026-10-14', convencion: conv, a: { fuente: 'A', valor: 1000 }, b: { fuente: 'B', valor: 1001 }, limite: 'prueba', identidad: { fondo: true, clase: true, moneda: true, unidad: true, monedaValor: 'ARS' } });
    conEvidencia(FCI, ['F1 - Clase A', 'F2 - Clase A', 'F3 - Clase A'].map(ev), () => {
      for (const n of ['F1 - Clase A', 'F2 - Clase A', 'F3 - Clase A']) assert.strictEqual(I.definirFCI('rentaFija', n).estadoOperativo, 'AUTOMATICO', n);
      for (const n of ['F4 - Clase A', 'F1 - Clase C', 'Schroder Renta Plus - Clase A', 'MP Ahorro - Clase A']) assert.strictEqual(I.definirFCI('rentaFija', n).estadoOperativo, 'MANUAL', n);
      assert.strictEqual(I.resolverFactor(I.REGLAS[FCI], 'F4 - Clase A', { categoria: 'rentaFija' }).factorEstado, 'PENDIENTE');
      assert.ok(!I.reglaValidadaParaClase(I.REGLAS[FCI]));
    });
  });

  t('FCI: la moneda o la unidad de la evidencia deben coincidir con lo declarado', () => {
    const base = (convencion, identidad) => ({ tipo: 'contraste', instrumento: 'F1 - Clase A', fecha: '2026-10-14', convencion, a: { fuente: 'A', valor: 1000 }, b: { fuente: 'B', valor: 1001 }, limite: 'prueba', identidad });
    const conv = { proveedor: 'argentinadatos', panel: 'rentaFija', moneda: 'ARS', unidadFuente: '1000CP', unidadApp: '1CP', factor: 0.001 };
    const id = { fondo: true, clase: true, moneda: true, unidad: true, monedaValor: 'ARS' };
    const casos = [
      base({ ...conv, moneda: 'USD' }, id), // la convención dice USD pero la identidad ARS
      base({ ...conv, unidadFuente: '1CP' }, id),
      base({ ...conv, factor: 1 }, id),
      base({ ...conv, proveedor: 'cafci' }, id),
      base({ ...conv, panel: 'otraCategoria' }, id),
    ];
    for (const e of casos) conEvidencia(FCI, [e], () => assert.strictEqual(I.definirFCI('rentaFija', 'F1 - Clase A').estadoOperativo, 'MANUAL', JSON.stringify(e.convencion)));
    conEvidencia(FCI, [base(conv, id)], () => assert.strictEqual(I.definirFCI('rentaFija', 'F1 - Clase A').estadoOperativo, 'AUTOMATICO', 'control: la bien formada sí'));
  });

  // ------------------------------------------------------------------ 6. estrés sobre el catálogo completo
  await ta('Estrés: con TODAS las reglas validadas por clase, cada instrumento automático comparte exactamente la convención de su regla', async () => {
    const fx = fixture();
    global.fetch = fx.fetch;
    const todo = [
      [CED, tres(CED, 'SPY', 'XLK', 'VEA')], [ACC, tres(ACC, 'GGAL', 'PAMP', 'BMA')], [ALGD, [contraste(ALGD, 'AL30', 100, 100)]],
      [AO, tres(AO, 'AO26', 'AO27', 'AO28')], [TX, tres(TX, 'TX26', 'TX27', 'TX28')],
    ];
    const anidar = async (i, f) => { if (i === todo.length) return f(); const r = I.REGLAS[todo[i][0]]; const antes = r.evidencia.slice(); r.evidencia.push(...todo[i][1]); try { return await anidar(i + 1, f); } finally { r.evidencia.length = 0; r.evidencia.push(...antes); } };
    await anidar(0, async () => {
      const res = mockRes();
      await require(ROOT + '/api/catalogo.js')({}, res);
      const automaticos = res.b.instrumentos.filter(x => x.estadoOperativo === 'AUTOMATICO');
      const simbolosAuto = automaticos.map(x => x.simbolo);
      assert.ok(automaticos.length > 10, 'el estrés debe habilitar varios instrumentos');
      for (const d of automaticos) {
        const regla = I.REGLAS[d.regla];
        assert.ok(regla, d.id + ' automático sin regla');
        const c = I.convencionDe(regla);
        assert.deepStrictEqual({ proveedor: d.fuente.proveedor, panel: d.fuente.panel, moneda: d.moneda, unidadFuente: d.unidadFuente, unidadApp: d.unidadApp, factor: d.factor }, { ...c, panel: c.panel || d.fuente.panel }, d.id);
        assert.ok(regla.alcance(d.fuente.clave, { simbolosPanel: new Set() }) || d.tipo === 'cripto', d.id + ' fuera del alcance de su regla');
        for (const e of regla.evidencia.filter(x => I.evidenciaValida(x, regla, { simbolosPanel: new Set() }))) assert.ok(I.mismaConvencion(e.convencion, c), d.id + ': evidencia con otra convención');
      }
      // nunca automáticos: variantes, ONs, letras, FCI, efectivo, bonos AO/TX/otros no cubiertos
      for (const d of res.b.instrumentos) {
        if (d.posibleVarianteDe || ['on', 'letra', 'fci', 'efectivo'].includes(d.tipo)) assert.strictEqual(d.estadoOperativo, 'MANUAL', d.id);
      }
      assert.deepStrictEqual(['SPYD', 'AL29D', 'AL29C', 'GD38D', 'GD38C', 'MGCEO', 'YFCGO', 'S30O6', 'GLD', 'YPFD', 'GD30X'].filter(x => simbolosAuto.includes(x)), []);
      for (const x of ['SPY', 'XLK', 'VEA', 'IVV', 'AAPL', 'MELI', 'MSFT', 'GGAL', 'PAMP', 'AL29', 'GD38', 'GD30', 'AO27', 'AO28', 'TX28', 'BTC', 'USDT']) assert.ok(simbolosAuto.includes(x), x + ' debería estar habilitado en el estrés');
      assert.ok(res.b.instrumentos.filter(x => x.tipo === 'fci').every(x => x.estadoOperativo === 'MANUAL'));
    });
    // y al terminar todo vuelve al estado conservador
    const res2 = mockRes();
    await require(ROOT + '/api/catalogo.js')({}, res2);
    assert.deepStrictEqual(res2.b.instrumentos.filter(x => x.estadoOperativo === 'AUTOMATICO').map(x => x.simbolo).sort(), ['AL29', 'BTC', 'GD38', 'USDT']);
  });

  t('resolverFactor / evidenciaValida no fallan con datos ausentes o extraños', () => {
    assert.strictEqual(I.resolverFactor(null, 'X').factorEstado, 'PENDIENTE');
    assert.strictEqual(I.resolverFactor(I.REGLAS[CED], 'SPY').factorEstado, 'PENDIENTE');
    assert.strictEqual(I.resolverFactor(I.REGLAS[CED], 'SPY', undefined).factorEstado, 'PENDIENTE');
    for (const e of [null, undefined, 0, 'x', [], {}, { tipo: 'contraste' }]) assert.strictEqual(I.evidenciaValida(e, I.REGLAS[CED], { simbolosPanel: new Set() }), false);
    assert.strictEqual(I.evidenciaValida(contraste(CED, 'SPY', 1, 1), null), false);
  });

  fin('herencia de reglas por clase');
})().catch(e => { console.error('FALLA general', e); process.exit(1); });
