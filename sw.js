/* ==========================================================================
   sw.js — Service Worker "brise-cache" de Synchrophoto.

   Stratégie :
   - CACHE_VERSION doit être incrémentée à chaque déploiement. Le navigateur
     détecte alors un fichier sw.js différent, installe une nouvelle instance,
     et l'étape "activate" supprime systématiquement tous les caches dont le
     nom ne correspond pas à la version courante : aucun résidu de cache
     obsolète ne peut s'accrocher ("brise-cache").
   - En fonctionnement normal, le réseau est toujours interrogé en priorité
     (network-first) pour l'ensemble des ressources de l'application ; le
     cache ne sert que de repli hors-ligne. Ainsi, dès qu'une connexion est
     disponible, l'utilisateur reçoit la version la plus fraîche possible.
   ========================================================================== */

const CACHE_VERSION = 'synchrophoto-v1';

const RESSOURCES_APPLICATION = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/gpxkml.js',
  './js/geo-utils.js',
  './js/exif-io.js',
  './js/map-view.js',
  './lib/leaflet/leaflet.css',
  './lib/leaflet/leaflet.js',
  './lib/leaflet/images/marker-icon.png',
  './lib/leaflet/images/marker-icon-2x.png',
  './lib/leaflet/images/marker-shadow.png',
  './lib/leaflet/images/layers.png',
  './lib/leaflet/images/layers-2x.png',
  './lib/exifr/exifr.js',
  './lib/piexifjs/piexif.js',
  './lib/jszip/jszip.min.js',
  './icons/icon192.png',
  './icons/icon512.png'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(RESSOURCES_APPLICATION))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(
        noms.filter((nom) => nom !== CACHE_VERSION).map((nom) => caches.delete(nom))
      ))
      .then(() => self.clients.claim())
  );
});

// Permet à la page (app.js) de déclencher immédiatement le passage à la
// nouvelle version, sans attendre la fermeture de tous les onglets.
self.addEventListener('message', (evt) => {
  if (evt.data === 'SAUTER_ATTENTE') self.skipWaiting();
});

self.addEventListener('fetch', (evt) => {
  const requete = evt.request;
  if (requete.method !== 'GET') return;

  // Les tuiles de fond de carte (OSM / IGN) ne sont pas mises en cache ici :
  // elles relèvent de services tiers et seraient vite obsolètes/volumineuses.
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;

  evt.respondWith(
    fetch(requete)
      .then((reponse) => {
        const copie = reponse.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(requete, copie));
        return reponse;
      })
      .catch(() => caches.match(requete))
  );
});
