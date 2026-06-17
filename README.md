# Synchrophoto

PWA (application web progressive) pour géolocaliser des photos de randonnée à
partir d'une trace GPX ou KML, avec vérification sur fond de carte OpenStreetMap
ou IGN Plan V2. **Tout le traitement se fait localement dans le navigateur** :
aucune photo ni aucune trace n'est envoyée à un serveur.

## Fonctionnement en bref

1. **Trace** — on charge un fichier `.gpx` (recommandé) ou `.kml` horodaté
   (export `gx:Track`). Synchrophoto en tire la liste des points
   (latitude, longitude, altitude, heure UTC).
2. **Photos** — on charge une ou plusieurs photos : JPEG, ou RAW d'appareil
   Minolta/Sony (`.ARW`, `.MRW`…). Synchrophoto lit la date de prise de vue
   (EXIF `DateTimeOriginal`) de chaque photo.
3. **Méthode de synchronisation** :
   - *Réglage direct* : l'heure de l'appareil est supposée correcte (ou vous
     entrez un décalage connu, en secondes).
   - *Photo témoin* : vous indiquez quelle photo correspond à un point précis
     de la trace (en cliquant ce point sur la carte). Synchrophoto compare
     alors l'heure de cette photo à l'heure GPS de ce point et en déduit le
     **décalage appareil ↔ GPS**, qui est ensuite appliqué automatiquement à
     toutes les autres photos. Cette méthode absorbe aussi bien la dérive de
     l'horloge de l'appareil qu'un éventuel mauvais réglage de fuseau horaire.
4. **Géolocalisation** — pour chaque photo, l'heure corrigée est replacée sur
   la trace par interpolation linéaire entre les deux points GPX encadrants,
   ce qui donne latitude, longitude et altitude. Les marqueurs apparaissent
   sur la carte de vérification (OSM ou IGN Plan V2, au choix).
5. **Export** — un JPEG est produit pour chaque photo traitée, nommé
   `nomdorigine_loc.jpg`, contenant les tags EXIF GPS
   (`GPSLatitude`, `GPSLongitude`, `GPSAltitude`, `GPSDateStamp`, ainsi que
   les tags associés requis par la norme EXIF : `GPSLatitudeRef`,
   `GPSLongitudeRef`, `GPSAltitudeRef`, `GPSTimeStamp`, `GPSMapDatum`).
   **Les fichiers RAW d'origine ne sont jamais modifiés** : pour un RAW, le
   JPEG produit est dérivé d'un aperçu extrait du fichier (voir plus bas).

## Structure du projet

```
synchrophoto/
├── index.html              page unique de l'application
├── manifest.json           manifeste PWA (icônes, nom, couleurs)
├── sw.js                   service worker « brise-cache »
├── css/style.css           feuille de style
├── js/
│   ├── gpxkml.js            lecture des traces GPX / KML
│   ├── geo-utils.js         interpolation temporelle, projection sur la trace, conversions EXIF
│   ├── exif-io.js           lecture de la date EXIF, extraction d'aperçu RAW, écriture GPS EXIF
│   ├── map-view.js          encapsulation Leaflet (fonds OSM / IGN, marqueurs)
│   └── app.js               orchestration de l'interface et du pipeline
├── icons/
│   ├── icon192.png          icône PWA — placeholder
│   └── icon512.png          icône PWA — placeholder
└── lib/                    librairies tierces vendorisées (pas de CDN)
    ├── leaflet/              cartographie
    ├── exifr/                lecture EXIF (y compris fichiers RAW de type TIFF)
    ├── piexifjs/              écriture des tags EXIF GPS dans un JPEG
    └── jszip/                 génération de l'archive .zip d'export
```

Aucune dépendance n'est chargée depuis un CDN : tout est servi depuis le
dossier `lib/`, ce qui permet à la PWA de fonctionner hors-ligne une fois
installée (à l'exception des tuiles de fond de carte OSM/IGN, qui nécessitent
une connexion).

## Remplacer les icônes

`icons/icon192.png` et `icons/icon512.png` sont des **placeholders** (repère
de localisation sur fond de courbes de niveau). Remplacez-les par vos propres
fichiers PNG carrés (192×192 et 512×512 px) en conservant les mêmes noms.

## Tester en local

Les service workers exigent un contexte sécurisé (`http://localhost` ou
`https://`), pas un simple double-clic sur `index.html` (`file://`). Depuis
le dossier du projet :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000 dans le navigateur
```

ou, avec Node :

```bash
npx serve .
```

## Déploiement sur GitHub Pages (`BernardHoyez.github.io/synchrophoto`)

1. Dans le dépôt `BernardHoyez.github.io` (ou un nouveau dépôt nommé
   `synchrophoto`, selon l'organisation choisie), copier l'ensemble du
   contenu de ce dossier dans un sous-dossier `synchrophoto/` du dépôt
   `BernardHoyez.github.io` — ou à la racine d'un dépôt `synchrophoto` dédié,
   si vous activez Pages avec ce dépôt directement.
2. **Avant de pousser**, ouvrir `sw.js` et incrémenter `CACHE_VERSION`
   (ex. `synchrophoto-v2`) à chaque nouvelle mise en ligne : c'est ce qui
   force la purge des caches obsolètes chez les visiteurs déjà installés
   (mécanisme « brise-cache », voir plus bas).
3. Valider et pousser :
   ```bash
   git add .
   git commit -m "Déploiement Synchrophoto"
   git push
   ```
4. Dans les paramètres du dépôt sur GitHub (*Settings → Pages*), vérifier que
   la branche et le dossier servis correspondent à l'emplacement choisi.
5. L'application sera accessible à `https://BernardHoyez.github.io/synchrophoto/`.
   Les chemins du projet (manifeste, service worker, librairies) sont tous
   **relatifs** : aucune adaptation de chemin n'est nécessaire pour ce
   sous-dossier.

## Le service worker « brise-cache »

`sw.js` met en cache la coquille de l'application (HTML/CSS/JS/icônes/
librairies) pour un fonctionnement hors-ligne, mais privilégie toujours le
réseau quand il est disponible (stratégie *network-first*) : dès qu'une
connexion existe, la version la plus récente est servie et le cache est
rafraîchi silencieusement. À l'activation d'une nouvelle version (détectée
via le changement de `CACHE_VERSION`), **tous les caches de version
différente sont supprimés** — aucun résidu obsolète ne peut s'accrocher.
Quand une mise à jour est détectée pendant qu'un onglet est ouvert, un message
discret apparaît en haut de l'écran (« nouvelle version disponible ») ; un
clic y bascule immédiatement.

## Limites connues

- **Traces sans horodatage** : un KML simple (`LineString` sans `gx:Track`)
  ne contient pas d'heure par point. La géolocalisation par le temps est
  alors impossible ; Synchrophoto le signale et bloque l'étape suivante.
  Préférez un export GPX (ou KML `gx:Track`) issu d'un traceur GPS.
- **Aperçu extrait des fichiers RAW** : en environnement navigateur pur (sans
  décodeur RAW natif), Synchrophoto repère le plus grand JPEG incorporé dans
  le fichier RAW (balayage des marqueurs JPEG standard) plutôt que de décoder
  l'image RAW elle-même. Pour les `.ARW` Sony/Minolta récents, cela donne en
  général un aperçu de bonne définition (souvent proche de la pleine
  résolution). Pour d'autres conteneurs RAW, la qualité de l'aperçu disponible
  dépend du modèle d'appareil. Le fichier RAW d'origine n'est jamais lu que
  pour cette extraction : il reste inchangé sur disque.
- **`.MRW` (Minolta historique)** : la date EXIF est recherchée y compris
  dans un bloc TIFF interne (`TTW`) si le fichier n'est pas un TIFF standard
  dès le premier octet ; cela fonctionne pour beaucoup de fichiers `.MRW`
  mais n'est pas garanti pour tous les modèles d'appareil.
- **Photos sans date EXIF** : si aucune date de prise de vue ne peut être
  lue, la photo correspondante est signalée en erreur à l'étape 4 et n'est
  pas géolocalisée (les autres photos du lot continuent d'être traitées).
- **Performance** : l'écriture EXIF (`piexifjs`) manipule l'image en mémoire
  sous forme de texte encodé en base64 ; sur des JPEG très volumineux
  (dizaines de Mo), le traitement peut prendre quelques secondes par photo.
- **Fond de carte IGN** : le flux `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` de la
  Géoplateforme IGN (`data.geopf.fr`) est public et ne nécessite pas de clé,
  mais reste un service tiers : en cas d'évolution de cette API, l'URL dans
  `js/map-view.js` (fonction `fondIGN`) devra être mise à jour.

## Pourquoi pas de framework ?

Le projet est volontairement écrit en JavaScript « vanille » (sans React ni
bundler) pour rester un simple ensemble de fichiers statiques, facile à
déployer sur GitHub Pages et à inspecter/modifier sans étape de compilation.
