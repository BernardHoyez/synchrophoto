/* ==========================================================================
   gpxkml.js — lecture des traces de randonnée
   Fournit : SP.gpxkml.parseTrackFile(file) -> Promise<{points, hasTime, format}>
   points : tableau trié par temps croissant de { lat, lon, ele, time } où
            time est un objet Date (ou null si la trace n'est pas horodatée).
   ========================================================================== */
window.SP = window.SP || {};

SP.gpxkml = (function () {

  function num(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  // ---------------------------------------------------------------- GPX ---
  function parseGPX(xmlDoc) {
    const trkpts = Array.from(xmlDoc.getElementsByTagName('trkpt'));
    const points = trkpts.map(node => {
      const lat = num(node.getAttribute('lat'), null);
      const lon = num(node.getAttribute('lon'), null);
      const eleNode = node.getElementsByTagName('ele')[0];
      const timeNode = node.getElementsByTagName('time')[0];
      const ele = eleNode ? num(eleNode.textContent, 0) : 0;
      const time = timeNode ? new Date(timeNode.textContent.trim()) : null;
      return { lat, lon, ele, time };
    }).filter(p => p.lat !== null && p.lon !== null);

    const hasTime = points.length > 0 && points.every(p => p.time && !isNaN(p.time.getTime()));
    return { points, hasTime, format: 'gpx' };
  }

  // ---------------------------------------------------------------- KML ---
  // Supporte deux variantes :
  //  - gx:Track (avec <when> + <gx:coord>) -> horodaté, idéal
  //  - LineString simple <coordinates>lon,lat,alt ...</coordinates> -> pas de temps
  function parseKML(xmlDoc) {
    const whens = Array.from(xmlDoc.getElementsByTagNameNS('*', 'when'));
    const coords = Array.from(xmlDoc.getElementsByTagNameNS('*', 'coord'));

    if (whens.length && coords.length && whens.length === coords.length) {
      const points = whens.map((w, i) => {
        const t = new Date(w.textContent.trim());
        const parts = coords[i].textContent.trim().split(/\s+/).map(Number);
        const [lon, lat, alt] = parts;
        return { lat, lon, ele: alt || 0, time: isNaN(t.getTime()) ? null : t };
      }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      const hasTime = points.every(p => p.time);
      return { points, hasTime, format: 'kml-gx' };
    }

    // Repli : LineString sans horodatage par point
    const coordNodes = Array.from(xmlDoc.getElementsByTagNameNS('*', 'coordinates'));
    let points = [];
    coordNodes.forEach(node => {
      const tuples = node.textContent.trim().split(/\s+/);
      tuples.forEach(t => {
        const [lon, lat, alt] = t.split(',').map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          points.push({ lat, lon, ele: alt || 0, time: null });
        }
      });
    });
    return { points, hasTime: false, format: 'kml-linestring' };
  }

  function parseTrackFile(file) {
    return file.text().then(text => {
      const xmlDoc = new DOMParser().parseFromString(text, 'application/xml');
      const erreur = xmlDoc.getElementsByTagName('parsererror')[0];
      if (erreur) throw new Error('Fichier XML illisible (GPX/KML invalide).');

      const name = file.name.toLowerCase();
      let result;
      if (name.endsWith('.kml') || xmlDoc.getElementsByTagName('kml').length) {
        result = parseKML(xmlDoc);
      } else {
        result = parseGPX(xmlDoc);
      }

      if (!result.points.length) {
        throw new Error('Aucun point de trace trouvé dans ce fichier.');
      }

      // tri temporel si horodatage disponible
      if (result.hasTime) {
        result.points.sort((a, b) => a.time - b.time);
      }
      return result;
    });
  }

  return { parseTrackFile };
})();
