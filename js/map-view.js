/* ==========================================================================
   map-view.js — encapsulation Leaflet : fonds de carte, trace, marqueurs.
   ========================================================================== */
window.SP = window.SP || {};

SP.mapview = (function () {

  function fondOSM() {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© contributeurs OpenStreetMap'
    });
  }

  function fondIGN() {
    return L.tileLayer(
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
      '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png' +
      '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      { maxNativeZoom: 19, maxZoom: 22, attribution: 'Plan IGN V2 — IGN/Géoplateforme' }
    );
  }

  const iconePhoto = L.icon({
    iconUrl: 'lib/leaflet/images/marker-icon.png',
    iconRetinaUrl: 'lib/leaflet/images/marker-icon-2x.png',
    shadowUrl: 'lib/leaflet/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34]
  });

  function creerCarte(elementId) {
    const map = L.map(elementId, { scrollWheelZoom: true });
    map.setView([46.6, 2.4], 6); // vue par défaut : France entière

    const osm = fondOSM(), ign = fondIGN();
    osm.addTo(map);
    let fondActuel = 'osm';

    let traceLayer = null;
    let marqueurs = [];
    let marqueurTemoin = null;

    function setFond(nom) {
      if (nom === fondActuel) return;
      map.removeLayer(fondActuel === 'osm' ? osm : ign);
      (nom === 'osm' ? osm : ign).addTo(map);
      fondActuel = nom;
    }

    function setTrace(points) {
      if (traceLayer) map.removeLayer(traceLayer);
      const latlngs = points.map(p => [p.lat, p.lon]);
      traceLayer = L.polyline(latlngs, { color: '#9C5F26', weight: 3, opacity: .85 });
      traceLayer.addTo(map);
      map.fitBounds(traceLayer.getBounds(), { padding: [24, 24] });
    }

    function clearMarqueurs() {
      marqueurs.forEach(m => map.removeLayer(m));
      marqueurs = [];
    }

    function ajouterMarqueurPhoto(lat, lon, texte) {
      const m = L.marker([lat, lon], { icon: iconePhoto }).addTo(map);
      if (texte) m.bindPopup(texte);
      marqueurs.push(m);
      return m;
    }

    function placerMarqueurTemoin(lat, lon) {
      if (marqueurTemoin) map.removeLayer(marqueurTemoin);
      marqueurTemoin = L.circleMarker([lat, lon], {
        radius: 9, color: '#1F6F8B', weight: 3, fillColor: '#1F6F8B', fillOpacity: .35
      }).addTo(map);
    }

    function onClic(callback) {
      map.on('click', e => callback(e.latlng.lat, e.latlng.lng));
    }

    function invalider() {
      setTimeout(() => map.invalidateSize(), 60);
    }

    return {
      map, setFond, setTrace, ajouterMarqueurPhoto, clearMarqueurs,
      placerMarqueurTemoin, onClic, invalider
    };
  }

  return { creerCarte };
})();
