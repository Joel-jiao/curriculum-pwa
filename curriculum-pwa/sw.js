var VERSION = 'v1';
var CACHE_NAME = 'cqie-cc-viewer-' + VERSION;
var ASSETS = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(CACHE_NAME).then(function (c) { return c.addAll(ASSETS); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) {
                if (k.indexOf('cqie-cc-viewer-') === 0 && k !== CACHE_NAME) return caches.delete(k);
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;
    var url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    if (req.mode === 'navigate') {
        // 导航请求：网络优先，失败回退缓存壳（hash 不受 SW 控制，天然保留）
        e.respondWith(
            fetch(req).then(function (res) {
                if (res && res.ok) {
                    var copy = res.clone();
                    caches.open(CACHE_NAME).then(function (c) { c.put('./index.html', copy); });
                }
                return res;
            }).catch(function () {
                return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
            })
        );
        return;
    }

    // 其它同源静态资源：缓存优先，网络回填
    e.respondWith(
        caches.match(req).then(function (hit) {
            if (hit) return hit;
            return fetch(req).then(function (res) {
                if (res && res.ok) {
                    var copy = res.clone();
                    caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
                }
                return res;
            });
        })
    );
});
