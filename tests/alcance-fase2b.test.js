// Fase 2B: guardas de alcance. Comprueba que NO se tocó lo que no debía tocarse
// y que las pruebas no afectan el despliegue. Mide además el tamaño del catálogo.
//
// Las comparaciones contra el commit base (8f56573, fin de la Fase 1) valen
// mientras index.html y la ruta vieja no cambien a propósito. Fase 3.0 solo
// agregó un bloque de funciones puras; al conectar el motor (3.1) hay que
// actualizar esta guarda.
const assert = require('assert');
const fs = require('fs');
const cp = require('child_process');
const zlib = require('zlib');
const { ROOT, t, ta, fin, mockRes, fixture } = require('./_util');

const BASE = '8f56573';
const git = args => cp.execFileSync('git', ['-C', ROOT, ...args], { maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
let hayBase = true;
try { git(['cat-file', '-e', BASE + '^{commit}']); } catch (e) { hayBase = false; }
const conBase = (nombre, f) => (hayBase ? t(nombre, f) : console.log('SALTADA ' + nombre + ' (no está el commit ' + BASE + ')'));

(async () => {
  // Fase 3.0 agregó UN bloque de funciones puras sin conectar. Fuera de ese bloque,
  // index.html tiene que seguir idéntico al de la Fase 1 (formulario, posiciones, guardado y metas).
  conBase('index.html = Fase 1 + únicamente el bloque de funciones puras de la Fase 3.0 (sin cambios en interfaz, guardado ni posiciones)', () => {
    const ahora = fs.readFileSync(ROOT + '/index.html', 'utf8');
    const i = ahora.indexOf('\n// ==== VINCULACIÓN DE POSICIONES (Fase 3.0)');
    const finMarca = '// ==== FIN VINCULACIÓN DE POSICIONES ====\n';
    const j = ahora.indexOf(finMarca);
    assert.ok(i > 0 && j > i, 'bloque 3.0 presente');
    assert.strictEqual(ahora.indexOf('// ==== VINCULACIÓN DE POSICIONES (Fase 3.0)', i + 5), -1, 'un solo bloque');
    assert.strictEqual(ahora.slice(0, i) + ahora.slice(j + finMarca.length), git(['show', BASE + ':index.html']));
  });

  conBase('La ruta antigua de precios.js (TICKERS y cálculo sin ids) es idéntica', () => {
    const corte = s => s.slice(0, s.indexOf('// Motor genérico (Fase 5A)'));
    const antes = corte(git(['show', BASE + ':api/precios.js']));
    const ahora = corte(fs.readFileSync(ROOT + '/api/precios.js', 'utf8'));
    assert.ok(antes.length > 1500);
    assert.strictEqual(ahora, antes);
  });

  conBase('leerIds no cambió', () => {
    const f = s => s.slice(s.indexOf('function leerIds'), s.indexOf('async function preciosPorIds'));
    assert.strictEqual(f(fs.readFileSync(ROOT + '/api/precios.js', 'utf8')), f(git(['show', BASE + ':api/precios.js'])));
  });

  t('api/byma-test.js sigue presente y sin cambios (se retira solo si Juan lo pide)', () => {
    assert.ok(fs.existsSync(ROOT + '/api/byma-test.js'));
    if (hayBase) assert.strictEqual(fs.readFileSync(ROOT + '/api/byma-test.js', 'utf8'), git(['show', BASE + ':api/byma-test.js']));
  });

  t('api/ contiene solo funciones y módulos esperados (las pruebas no están dentro de api/)', () => {
    const base = hayBase ? git(['ls-tree', '--name-only', BASE, 'api/']).split('\n').filter(Boolean).map(x => x.replace('api/', '')) : null;
    const esperado = (base || fs.readdirSync(ROOT + '/api')).concat(['_alias.js']).filter((x, i, a) => a.indexOf(x) === i).sort();
    assert.deepStrictEqual(fs.readdirSync(ROOT + '/api').sort(), esperado);
    assert.ok(!fs.readdirSync(ROOT + '/api').some(x => /test/i.test(x) && x !== 'byma-test.js'), 'ninguna prueba dentro de api/');
  });

  t('Despliegue: tests/ queda excluido por .vercelignore; sin package.json ni vercel.json nuevos', () => {
    const v = fs.readFileSync(ROOT + '/.vercelignore', 'utf8').split('\n').map(s => s.trim());
    assert.ok(v.includes('tests') || v.includes('tests/'));
    assert.ok(!fs.existsSync(ROOT + '/package.json'));
    assert.ok(!fs.existsSync(ROOT + '/vercel.json'));
  });

  t('La búsqueda y el catálogo no consultan BYMA ni hacen red propia', () => {
    for (const f of ['_alias.js']) assert.ok(!/fetch\s*\(|require\(['"]https?['"]\)|byma/i.test(fs.readFileSync(ROOT + '/api/' + f, 'utf8').replace(/\/\/.*$/gm, '')), f);
    // "BYMA" figura como nombre de fuente en la evidencia registrada; lo que no puede haber es una URL de BYMA.
    for (const f of ['catalogo.js', '_instrumentos.js', '_alias.js']) assert.ok(!/https?:\/\/[^\s'"`]*byma/i.test(fs.readFileSync(ROOT + '/api/' + f, 'utf8')), f + ' no debe consultar BYMA');
  });

  t('Ningún módulo toca Firestore ni posiciones: sin referencias a firebase, usuarios ni positions en api/', () => {
    for (const f of ['_alias.js', '_instrumentos.js', 'catalogo.js']) {
      assert.ok(!/firebase|firestore|usuarios\/|positions|setPositions/i.test(fs.readFileSync(ROOT + '/api/' + f, 'utf8')), f);
    }
  });

  await ta('Tamaño del catálogo con un mercado realista simulado (informativo; tope de crecimiento)', async () => {
    const fx = fixture();
    const mk = (pref, n, base) => Array.from({ length: n }, (_, i) => ({ symbol: pref + String(i).padStart(3, '0'), c: base + i }));
    const bonos = [];
    for (let i = 0; i < 70; i++) { const s = 'GD' + String(i).padStart(2, '0'); bonos.push({ symbol: s, c: 1 }, { symbol: s + 'D', c: 1 }, { symbol: s + 'C', c: 1 }); }
    fx.data['https://data912.com/live/arg_cedears'] = mk('CE', 700, 100);
    fx.data['https://data912.com/live/arg_stocks'] = mk('AC', 150, 100);
    fx.data['https://data912.com/live/arg_bonds'] = bonos;
    fx.data['https://data912.com/live/arg_corp'] = mk('ON', 120, 100);
    fx.data['https://data912.com/live/arg_notes'] = mk('LE', 40, 100);
    const fci = (cat, n) => Array.from({ length: n }, (_, i) => ({ fondo: `Fondo ${cat} Numero ${i} - Clase ${i % 2 ? 'A' : 'B'}`, vcp: 1, fecha: '2026-09-30' }));
    ['mercadoDinero', 'rentaVariable', 'rentaFija', 'rentaMixta', 'retornoTotal', 'otros'].forEach(c => { fx.data[`https://api.argentinadatos.com/v1/finanzas/fci/${c}/ultimo`] = fci(c, 250); });
    global.fetch = fx.fetch;
    const res = mockRes();
    await require(ROOT + '/api/catalogo.js')({}, res);
    const ahora = Buffer.byteLength(JSON.stringify(res.b));
    const CAMPOS_5A = ['id', 'simbolo', 'nombre', 'tipo', 'fuente', 'unidadFuente', 'unidadApp', 'factor', 'moneda', 'estado', 'conversion'];
    const antes = Buffer.byteLength(JSON.stringify({ ...res.b, instrumentos: res.b.instrumentos.map(x => Object.fromEntries(CAMPOS_5A.filter(k => k in x).map(k => [k, x[k]]))), reglas: undefined, colisionesFCI: undefined }));
    const n = res.b.instrumentos.length;
    const gz = o => zlib.gzipSync(JSON.stringify(o)).length;
    const gzAhora = gz(res.b);
    const gzAntes = gz({ ...res.b, instrumentos: res.b.instrumentos.map(x => Object.fromEntries(CAMPOS_5A.filter(k => k in x).map(k => [k, x[k]]))), reglas: undefined, colisionesFCI: undefined });
    console.log(`     instrumentos: ${n} | crudo: ${(antes / 1024).toFixed(0)} KB -> ${(ahora / 1024).toFixed(0)} KB (+${(((ahora - antes) / antes) * 100).toFixed(0)} %) | comprimido (lo que viaja): ${(gzAntes / 1024).toFixed(0)} KB -> ${(gzAhora / 1024).toFixed(0)} KB`);
    assert.ok(ahora < 1.6 * antes, 'el catálogo crudo no debería crecer más de 60 % respecto del formato 5A');
    assert.ok(gzAhora < 100 * 1024, 'comprimido debería pesar menos de 100 KB');
    assert.ok(ahora < 2 * 1024 * 1024, 'muy por debajo del límite de 4,5 MB de una respuesta de Vercel');
  });

  fin('alcance de Fase 2B');
})().catch(e => { console.error('FALLA general', e); process.exit(1); });
