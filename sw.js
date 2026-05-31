const CACHE_NAME = 'guess-challenge-v2';
const urlsToCache = [
    '/',
    '/index.html',
    '/lobby.html',
    '/game.html',
    '/style.css',
    '/auth.js',
    '/lobby.js',
    '/game.js',
    '/friends.js',
    '/chat.js',
    '/manifest.json'  // <-- BUNU EKLEYİN!
];

self.addEventListener('install', event => {
    self.skipWaiting(); // Hemen aktif ol
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .catch(err => console.error('Cache error:', err))
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Sadece kendi domainimizdeki istekleri cache'le
    if (url.origin !== self.location.origin) {
        event.respondWith(fetch(event.request));
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) return response;
                // redirect: 'follow' ekledik!
                return fetch(event.request, { redirect: 'follow' });
            })
            .catch(() => {
                return new Response('Bağlantı hatası - Sayfa yenileyin', { status: 503 });
            })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        ))
    );
    self.clients.claim();
});