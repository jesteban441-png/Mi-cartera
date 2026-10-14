// Corre todas las pruebas de esta carpeta:   node tests/run-all.js
// No usan red (fuentes simuladas) ni modifican nada. Salen con código distinto de
// cero si alguna falla.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const archivos = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let total = 0;
let malos = 0;
const filas = [];
for (const f of archivos) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  const salida = (r.stdout || '') + (r.stderr || '');
  const ok = (salida.match(/^(OK|ok)\b/gm) || []).length;
  const saltadas = (salida.match(/^SALTADA/gm) || []).length;
  const fallas = (salida.match(/^FALLA/gm) || []).length;
  total += ok;
  const bien = r.status === 0 && fallas === 0;
  if (!bien) { malos++; process.stdout.write(salida + '\n'); }
  filas.push(`${bien ? 'OK   ' : 'FALLA'} ${f.padEnd(34)} ${String(ok).padStart(3)} pruebas${saltadas ? `, ${saltadas} saltadas` : ''}`);
}
console.log(filas.join('\n'));
console.log(`\n${total} pruebas OK en ${archivos.length} archivos` + (malos ? ` — ${malos} archivo(s) con FALLAS` : ''));
process.exit(malos ? 1 : 0);
