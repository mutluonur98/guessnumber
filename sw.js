const CACHE_NAME = 'guess-challenge-v1';
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
    '/chat.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Cache opened');
                return cache.addAll(urlsToCache).catch(err => {
                    console.error('Cache addAll error:', err);
                });
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request).catch(() => {
                    return new Response('Offline - Sayfa yüklenemedi', {
                        status: 503,
                        statusText: 'Service Unavailable'
                    });
                });
            })
    );
});