// Service worker mínimo: lo que hace instalable a la app (el requisito técnico de
// los navegadores para el "Agregar a pantalla de inicio"), y de paso un respaldo
// básico si en algún momento te quedás sin conexión.
//
// Estrategia "network-first": siempre intenta traer la versión más nueva de internet
// primero, y solo si no hay conexión usa lo último que quedó guardado. Así nunca te
// va a mostrar una versión vieja de la app por error mientras la sigamos actualizando.
const CACHE_NAME = 'cartera-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add('/')));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
