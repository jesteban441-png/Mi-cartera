// /api/precios?ids= con 1, 2, 3, 5, 17 y 120 ids, espacios, +, %20, %2C, repetidos y vacios.
// Pruebas reproducibles de /api/precios?ids= (lectura de ids + handler completo con fuentes simuladas).
// Uso: node test-ids.js   (no toca el repo ni la red)
const path=require('path').join(__dirname,'..','api')+'/';
const http=require('http'), url=require('url');
let fails=0; const ok=(c,m)=>{ if(!c){fails++;console.log('FALLA:',m);} else console.log('ok   :',m); };
// --- fuentes simuladas ---
const FCI='Schroder Renta Plus - Clase A', FCI2='MP Empresas Argentinas - Clase A', FCI3='MP Ahorro - Clase A';
const data={
 'https://data912.com/live/arg_bonds':['AL29','GD38','TX28','AO27','AO28','S30O6'].map((s,i)=>({symbol:s,c:80+i})),
 'https://data912.com/live/arg_cedears':['SPY','XLK','VEA','GLD','IVV'].map((s,i)=>({symbol:s,c:100+i})),
 'https://data912.com/live/arg_stocks':['GGAL','YPFD'].map((s,i)=>({symbol:s,c:5000+i})),
 'https://data912.com/live/arg_corp':['MGCEO','YFCGO'].map((s,i)=>({symbol:s,c:140000+i})),
 'https://api.argentinadatos.com/v1/finanzas/fci/rentaFija/ultimo':[{fondo:FCI,vcp:132295.5,fecha:'2026-09-30'},{fondo:FCI3,vcp:1206.3,fecha:'2026-09-28'}],
 'https://api.argentinadatos.com/v1/finanzas/fci/rentaVariable/ultimo':[{fondo:FCI2,vcp:884.5,fecha:'2026-09-30'}],
};
global.fetch=async u=>{
  if(data[u]) return {ok:true,json:async()=>data[u]};
  if(u.startsWith('https://api.coingecko.com')) return {ok:true,json:async()=>({bitcoin:{usd:81311},tether:{usd:0.999}})};
  if(u.includes('dolarapi')) return {ok:true,json:async()=>({compra:1530,venta:1548})};
  return {ok:false,status:404,json:async()=>[]};
};
const handler=require(path+'precios.js');
// Servidor local que imita a Vercel: req.query = parámetros ya decodificados.
const modo=process.argv[2];
if(!modo){ // sin argumento: corre los dos modos (con y sin req.query, como Vercel)
  const r=require('child_process').spawnSync;let mal=0;
  for(const m of ['con-query','sin-query']){const x=r(process.execPath,[__filename,m],{stdio:'inherit'});if(x.status)mal++;}
  process.exit(mal?1:0);
}
const srv=http.createServer((req,res)=>{
  const u=url.parse(req.url,true);
  if(modo==='con-query') req.query=u.query; // como Vercel
  res.status=c=>{res.statusCode=c;return res;};
  res.json=o=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(o));};
  handler(req,res);
});
const net=require('net');
function getRaw(p){return new Promise(r=>{const c=net.connect(srv.address().port,'127.0.0.1');let b='';c.write('GET '+p+' HTTP/1.0\r\nHost: x\r\n\r\n');c.on('data',d=>b+=d);c.on('end',()=>r(JSON.parse(b.slice(b.indexOf('\r\n\r\n')+4))));});}
function get(p){ if(/ /.test(p)) return getRaw(p); return new Promise((r,j)=>http.get({host:'127.0.0.1',port:srv.address().port,path:p},x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>r(JSON.parse(b)));}).on('error',j));}
const E=encodeURIComponent;
const B=['data912:arg_bonds:AO27','data912:arg_bonds:AO28','data912:arg_bonds:TX28','data912:arg_bonds:GD38','data912:arg_bonds:AL29'];
const F=['argentinadatos:rentaFija:'+FCI,'argentinadatos:rentaVariable:'+FCI2,'argentinadatos:rentaFija:'+FCI3];
const MIX=['data912:arg_cedears:SPY','data912:arg_cedears:XLK','data912:arg_cedears:VEA','data912:arg_stocks:GGAL','data912:arg_stocks:YPFD','data912:arg_corp:MGCEO','data912:arg_corp:YFCGO','coingecko:simple:bitcoin','coingecko:simple:tether',...F,...B];
const casos=[
 ['1 id', '?ids='+B[0], 1],
 ['2 ids coma literal', '?ids='+B.slice(0,2).join(','), 2],
 ['3 ids coma literal', '?ids='+B.slice(0,3).join(','), 3],
 ['5 ids coma literal', '?ids='+B.join(','), 5],
 ['5 ids codificados (%3A y %2C)', '?ids='+B.map(E).join('%2C'), 5],
 ['5 ids repitiendo ids=', '?'+B.map(b=>'ids='+b).join('&'), 5],
 ['3 FCI, espacios como %20', '?ids='+F.map(E).join(','), 3],
 ['3 FCI, espacios como +', '?ids='+F.map(f=>E(f).replace(/%20/g,'+')).join(','), 3],
 ['mezcla de 17 ids', '?ids='+MIX.map(E).join(','), MIX.length],
 ['120 ids (tope 100)', '?ids='+Array.from({length:120},(_,i)=>'data912:arg_bonds:X'+i).join(','), 100],
 ['ids repetidos se deduplican', '?ids='+[B[0],B[0],B[1]].join(','), 2],
 ['comas dobles y espacios sobrantes', '?ids='+E(' '+B[0]+' ,, '+B[1]+' ,'), 2],
];
srv.listen(0,async()=>{
  console.log('Modo:',modo);
  for(const [n,q,esp] of casos){
    const r=await get('/api/precios'+q);
    const k=r.resultados?Object.keys(r.resultados):null;
    ok(k&&k.length===esp, `${n}: ${k?k.length:'FORMATO VIEJO'} resultados (esperado ${esp})`);
  }
  const r=await get('/api/precios?ids='+F.map(E).join(','));
  ok(F.every(f=>r.resultados[f]&&r.resultados[f].ok&&r.resultados[f].estado==='sin-verificar'), 'FCI con espacios: ok y sin-verificar');
  const v=await get('/api/precios');
  ok(!v.resultados&&v.prices, 'sin ids: formato viejo intacto');
  const v2=await get('/api/precios?ids=');
  ok(!v2.resultados&&v2.prices, 'ids vacío: formato viejo (cae a ruta vieja)');
  srv.close(); console.log(fails?`\n${fails} fallas`:'\nTodo ok'); process.exit(fails?1:0);
});
