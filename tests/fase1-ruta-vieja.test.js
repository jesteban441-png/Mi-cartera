// Fase 1: la ruta vieja respeta precios manuales y posiciones vinculadas.
const ROOT=require('path').join(__dirname,'..');
const fs=require('fs'),assert=require('assert');
const html=fs.readFileSync(ROOT+'/index.html','utf8');
let n=0;const t=(k,f)=>{try{f();console.log('OK',k);n++;}catch(e){console.error('FALLA',k,'\n  ',e.message);process.exitCode=1;}};
const normSrc=html.match(/function norm\(s\) \{[^\n]*\}/)[0];
const bloque=html.slice(html.indexOf('// ==== MOTOR DE PRECIOS'),html.indexOf('// ==== FIN MOTOR DE PRECIOS'));
const M=new Function(normSrc+bloque+';return {norm,tieneInstrumento,puedeActualizarRutaVieja,aplicarPreciosRutaVieja,normalizarPrecio,aplicarCotizacion};')();
const deepFreeze=o=>{Object.values(o).forEach(v=>v&&typeof v==='object'&&deepFreeze(v));return Object.freeze(o);};
const P={SPY:20860,XLK:7075,VEA:11540,'ON Pampa':145020,Bitcoin:132546981.6,'USDT (staking)':1551.4};
const pn={};Object.keys(P).forEach(k=>pn[M.norm(k)]=P[k]);
const TS='2026-10-06T13:00:00.000Z';
const pos=(name,platform,origen,extra={})=>({id:'p_'+name+platform,name,platform,fecha:'2026-01-01',units:3,avgPrice:100,currentPrice:50,...(origen?{precioOrigen:origen,precioActualizado:'2026-10-01T00:00:00.000Z'}:{}),...extra});

// ---- Casos pedidos
t('VEA manual NO recibe el precio de la ruta vieja',()=>{
  const v=deepFreeze(pos('VEA','IOL','manual',{units:6,avgPrice:11400,currentPrice:11410}));
  const r=M.aplicarPreciosRutaVieja([v],pn,TS);
  assert.strictEqual(r.posiciones[0],v);assert.strictEqual(r.actualizadas,0);assert.strictEqual(r.omitidasManuales,1);
  assert.strictEqual(r.posiciones[0].currentPrice,11410);});
t('ON Pampa manual NO es modificada (aunque la lista fija la conozca)',()=>{
  const v=deepFreeze(pos('ON Pampa','IOL','manual',{units:0.13,avgPrice:151200,currentPrice:147060}));
  const r=M.aplicarPreciosRutaVieja([v],pn,TS);
  assert.strictEqual(r.posiciones[0],v);assert.strictEqual(r.posiciones[0].currentPrice,147060);});
t('Posición sin instrumentoId con precio automático anterior sigue actualizándose',()=>{
  const v=deepFreeze(pos('SPY','Bullmarket','auto',{units:17,avgPrice:16260,currentPrice:20000}));
  const r=M.aplicarPreciosRutaVieja([v],pn,TS);
  const p=r.posiciones[0];
  assert.strictEqual(p.currentPrice,20860);assert.strictEqual(p.precioOrigen,'auto');assert.strictEqual(p.precioActualizado,TS);
  assert.strictEqual(r.actualizadas,1);
  for(const k of ['id','name','platform','fecha','units','avgPrice'])assert.strictEqual(p[k],v[k],k+' no debe cambiar');});
t('Posición anterior al campo precioOrigen (sin dato) sigue como siempre',()=>{
  const v=deepFreeze(pos('Bitcoin','BingX',null));
  const r=M.aplicarPreciosRutaVieja([v],pn,TS);
  assert.strictEqual(r.posiciones[0].currentPrice,132546981.6);assert.strictEqual(r.posiciones[0].precioOrigen,'auto');});
t('Posición con instrumentoId NO es actualizada por la ruta vieja (auto, manual o sin origen)',()=>{
  for(const o of ['auto','manual',null]){
    const v=deepFreeze(pos('SPY','Bullmarket',o,{instrumentoId:'data912:arg_cedears:SPY'}));
    const r=M.aplicarPreciosRutaVieja([v],pn,TS);
    assert.strictEqual(r.posiciones[0],v);assert.strictEqual(r.omitidasVinculadas,1);assert.strictEqual(r.actualizadas,0);}});
t('instrumentoId vacío o con espacios cuenta como "sin instrumentoId"',()=>{
  for(const id of ['','  ',undefined,null,123]){
    assert.strictEqual(M.tieneInstrumento({instrumentoId:id}),false);}
  assert.strictEqual(M.tieneInstrumento({instrumentoId:'a:b:c'}),true);});
t('Valor de precioOrigen desconocido se trata como manual (no se pisa)',()=>{
  const v=deepFreeze(pos('SPY','IOL','raro'));
  assert.strictEqual(M.aplicarPreciosRutaVieja([v],pn,TS).posiciones[0],v);});
t('Nombre con mayúsculas/espacios sigue coincidiendo (manual se respeta igual)',()=>{
  const v=deepFreeze(pos('  vea ','IOL','manual'));
  assert.strictEqual(M.aplicarPreciosRutaVieja([v],pn,TS).posiciones[0],v);
  const w=deepFreeze(pos('  vea ','IOL','auto'));
  assert.strictEqual(M.aplicarPreciosRutaVieja([w],pn,TS).posiciones[0].currentPrice,11540);});
t('Mismo nombre en dos plataformas: solo se actualiza la automática',()=>{
  const a=deepFreeze(pos('USDT (staking)','BingX','auto')),b=deepFreeze(pos('USDT (staking)','IOL','manual'));
  const r=M.aplicarPreciosRutaVieja([a,b],pn,TS);
  assert.strictEqual(r.posiciones[0].currentPrice,1551.4);assert.strictEqual(r.posiciones[1],b);});
t('Precio inválido de la API (0, null, texto, negativo) no cambia nada',()=>{
  const v=deepFreeze(pos('SPY','IOL','auto'));
  for(const x of [0,null,undefined,'20860',-1,NaN])assert.strictEqual(M.aplicarPreciosRutaVieja([v],{spy:x},TS).posiciones[0],v);});
t('Pesos y posiciones fuera de la lista fija no se tocan',()=>{
  const a=deepFreeze(pos('Pesos','IOL',null)),b=deepFreeze(pos('GGAL','IOL','auto'));
  const r=M.aplicarPreciosRutaVieja([a,b],pn,TS);assert.strictEqual(r.posiciones[0],a);assert.strictEqual(r.posiciones[1],b);assert.strictEqual(r.actualizadas,0);});

// ---- Integración: la función REAL fetchLivePrices del componente
const i=html.indexOf('async function fetchLivePrices() {'),j=html.indexOf('\n  useEffect(() => {\n    if (loaded && positions.length > 0) fetchLivePrices();');
assert(i>0&&j>i,'no se encontró fetchLivePrices');
const src=html.slice(i,j);
const cartera=()=>[
  pos('XLK','IOL','auto'),pos('ON YPF','IOL','manual'),pos('VEA','IOL','manual'),pos('USDT (staking)','IOL','auto'),
  pos('Acciones argentinas','Mercado Pago','manual'),pos('Bitcoin','BingX','auto'),pos('Pesos','IOL',null),pos('Pesos','Bullmarket',null),
  pos('SPY','Bullmarket','auto'),pos('IVV','Bullmarket','manual'),pos('SCRTAPA','Bullmarket','manual'),pos('USDT (staking)','BingX','auto'),
  pos('ON Pampa','IOL','manual'),pos('Bonos argentinos','Mercado Pago','manual'),
];
async function correr(inicial){
  let estado=inicial,llamadas=[],estatus=[],setCalls=[];
  const fake=async u=>{llamadas.push(u);return{json:async()=>({ok:true,prices:P,usdArs:1551.6,notFound:['ON YPF (ticker: YFCDO)'],fuentesConError:[],updatedAt:TS})};};
  const f=new Function('setLiveLoading','setLiveStatus','setPositions','setUsdArs','setLastUpdated','norm','aplicarPreciosRutaVieja','fetch',src+';return fetchLivePrices;')(
    ()=>{},m=>estatus.push(m),fn=>{setCalls.push('positions');estado=fn(estado);},()=>{},()=>{},M.norm,M.aplicarPreciosRutaVieja,fake);
  await f();return {estado,llamadas,estatus,setCalls};
}
(async()=>{
  const ini=deepFreeze(cartera());
  const r=await correr(ini);
  const por=(nombre,plat)=>r.estado.find(p=>p.name===nombre&&p.platform===plat);
  t('Integración: usa solo /api/precios sin ids (ruta vieja)',()=>assert.deepStrictEqual(r.llamadas,['/api/precios']));
  t('Integración: se actualizan solo XLK, SPY, Bitcoin y las dos USDT automáticas',()=>{
    const cambiadas=r.estado.filter((p,k)=>p!==ini[k]).map(p=>p.name+'@'+p.platform).sort();
    assert.deepStrictEqual(cambiadas,['Bitcoin@BingX','SPY@Bullmarket','USDT (staking)@BingX','USDT (staking)@IOL','XLK@IOL']);
    assert.strictEqual(por('XLK','IOL').currentPrice,7075);assert.strictEqual(por('SPY','Bullmarket').currentPrice,20860);});
  t('Integración: VEA, ON Pampa, ON YPF, IVV, SCRTAPA, MP y Pesos quedan idénticos',()=>{
    for(const [nom,pl] of [['VEA','IOL'],['ON Pampa','IOL'],['ON YPF','IOL'],['IVV','Bullmarket'],['SCRTAPA','Bullmarket'],['Acciones argentinas','Mercado Pago'],['Bonos argentinos','Mercado Pago'],['Pesos','IOL'],['Pesos','Bullmarket']]){
      const k=ini.findIndex(p=>p.name===nom&&p.platform===pl);assert.strictEqual(r.estado[k],ini[k],nom+' '+pl);}});
  t('Integración: units, avgPrice, name, fecha y platform intactos en TODAS',()=>{
    r.estado.forEach((p,k)=>{for(const c of ['id','name','platform','fecha','units','avgPrice'])assert.strictEqual(p[c],ini[k][c]);});
    assert.strictEqual(r.estado.length,ini.length);});
  t('Integración: mensaje informa 5 actualizadas',()=>assert.ok(/Actualizadas 5 posiciones/.test(r.estatus[r.estatus.length-1]),r.estatus.join('|')));
  // Posiciones vinculadas al motor nuevo: la ruta vieja no las toca y el motor nuevo todavía no actúa
  const vinc=deepFreeze(cartera().map(p=>['SPY','XLK','Bitcoin'].includes(p.name)?{...p,instrumentoId:'x:y:'+p.name}:p));
  const r2=await correr(vinc);
  t('Integración: con instrumentoId SPY/XLK/Bitcoin NO se actualizan (ni por ruta vieja ni por motor nuevo)',()=>{
    for(const nom of ['SPY','XLK','Bitcoin']){const k=vinc.findIndex(p=>p.name===nom);assert.strictEqual(r2.estado[k],vinc[k],nom);}
    assert.deepStrictEqual(r2.llamadas,['/api/precios']);});
  const sola=deepFreeze([pos('VEA','IOL','manual')]);
  const r3=await correr(sola);
  t('Integración: si no cambia nada, el estado queda con la misma referencia',()=>{assert.ok(/Actualizadas 0 posiciones/.test(r3.estatus[r3.estatus.length-1]));assert.strictEqual(r3.estado,sola);});
  // ---- Estático
  t('fetchLivePrices solo toca posiciones (ni historial, aportes, movimientos, metas, objetivo ni diario)',()=>{
    const setters=[...new Set(src.match(/\bset[A-Z]\w*\(/g))].sort();
    assert.deepStrictEqual(setters,['setLastUpdated(','setLiveLoading(','setLiveStatus(','setPositions(','setUsdArs(']);});
  t('El motor nuevo NO se invoca desde ninguna parte de la app (solo se define)',()=>{
    // Fase 3.0 agregó un segundo bloque de funciones puras (también sin conectar): se excluye igual que el motor.
    const sinBloque=(h,a,b)=>{const i=h.indexOf(a),j=h.indexOf(b);return i<0?h:h.slice(0,i)+h.slice(j);};
    const fuera=sinBloque(sinBloque(html,'// ==== VINCULACIÓN DE POSICIONES','// ==== FIN VINCULACIÓN DE POSICIONES'),'// ==== MOTOR DE PRECIOS','// ==== FIN MOTOR DE PRECIOS');
    for(const f of ['pedirPreciosCrudos','aplicarCotizacion','normalizarPrecio'])assert.ok(!new RegExp('\\b'+f+'\\b').test(fuera),f+' se usa fuera del bloque');
    assert.ok(!/api\/precios\?ids/.test(fuera.replace(/\/\/.*$/gm,'')));});
  t('La lógica de guardado versionado no cambió (fusionarCampo, runTransaction, rev)',()=>{
    const antes=require('child_process').execSync('git -C '+ROOT+' show HEAD:index.html',{maxBuffer:1e8}).toString();
    for(const fn of ['function fusionarCampo','runTransaction','function mismoValor']){
      const a=antes.indexOf(fn),b=html.indexOf(fn);assert(a>0&&b>0,fn);
      assert.strictEqual(antes.slice(a,a+1500),html.slice(b,b+1500),fn+' cambió');}
    assert.strictEqual((antes.match(/runTransaction/g)||[]).length,(html.match(/runTransaction/g)||[]).length);});
  console.log('\n'+n+' pruebas OK (Fase 1)');
})();
