const CACHE_NAME = 'sumed2026-v2'; // ⚠️ Sempre incremente esta versão a cada deploy em produção.
// Trocar o nome força o navegador a descartar tudo que estava em cache
// (veja o listener 'activate' abaixo) em vez de continuar servindo
// arquivos antigos indefinidamente.

// App shell — arquivos estáticos que não mudam de conteúdo dinâmico.
const APP_SHELL = [
  '/index.html',
  '/admin.html',
  '/login.html',
  '/style.css',
  '/index.js',
  '/admin.js',
  '/login.js',
  '/data.js',
  '/supabaseClient.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca cachear chamadas ao Supabase (auth, banco, storage) — sempre
  // precisam ir pra rede para refletir dados/sessão atuais.
  if (url.hostname.endsWith('.supabase.co')) {
    return;
  }

  // App shell: cache-first, com atualização em background (stale-while-revalidate).
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
