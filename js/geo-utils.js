/* ==========================================================================
   geo-utils.js — géométrie de la trace, interpolation temporelle,
   conversions pour l'écriture EXIF GPS.
   ========================================================================== */
window.SP = window.SP || {};

SP.geo = (function () {

  const R_TERRE = 6371000; // mètres

  function toRad(d) { return d * Math.PI / 180; }

  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_TERRE * Math.asin(Math.sqrt(a));
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---- Statistiques globales d'une trace ------------------------------
  function statsTrace(points) {
    let distance = 0, deniveléPos = 0, deniveléNeg = 0;
    for (let i = 1; i < points.length; i++) {
      distance += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
      const dEle = points[i].ele - points[i - 1].ele;
      if (dEle > 0) deniveléPos += dEle; else deniveléNeg += -dEle;
    }
    const hasTime = points.length && points[0].time;
    const debut = hasTime ? points[0].time : null;
    const fin = hasTime ? points[points.length - 1].time : null;
    return {
      nbPoints: points.length,
      distanceKm: distance / 1000,
      deniveléPos, deniveléNeg,
      debut, fin,
      dureeMs: (debut && fin) ? (fin - debut) : null
    };
  }

  // ---- Position interpolée sur la trace à un instant donné ------------
  // points doit être trié par time croissant. Renvoie {lat,lon,ele,time}.
  function positionAuTemps(points, target) {
    const t = target.getTime();
    if (t <= points[0].time.getTime()) return { ...points[0] };
    const last = points[points.length - 1];
    if (t >= last.time.getTime()) return { ...last };

    // recherche dichotomique du segment encadrant
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].time.getTime() <= t) lo = mid; else hi = mid;
    }
    const p1 = points[lo], p2 = points[hi];
    const span = p2.time.getTime() - p1.time.getTime();
    const f = span > 0 ? (t - p1.time.getTime()) / span : 0;
    return {
      lat: lerp(p1.lat, p2.lat, f),
      lon: lerp(p1.lon, p2.lon, f),
      ele: lerp(p1.ele, p2.ele, f),
      time: target
    };
  }

  // ---- Point de la trace le plus proche d'un clic sur la carte ---------
  // Projection planaire locale (suffisante à l'échelle d'une randonnée).
  // Renvoie { lat, lon, time, distanceM } du point projeté le plus proche.
  function pointTraceLePlusProche(points, clicLat, clicLon) {
    const latRef = toRad(points[0].lat);
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(latRef);

    function toXY(lat, lon) { return [lon * mPerDegLon, lat * mPerDegLat]; }
    const [cx, cy] = toXY(clicLat, clicLon);

    let meilleur = null;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const [ax, ay] = toXY(a.lat, a.lon);
      const [bx, by] = toXY(b.lat, b.lon);
      const dx = bx - ax, dy = by - ay;
      const segLenSq = dx * dx + dy * dy;
      let tt = segLenSq > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / segLenSq : 0;
      tt = Math.max(0, Math.min(1, tt));
      const px = ax + tt * dx, py = ay + tt * dy;
      const dist = Math.hypot(cx - px, cy - py);
      if (!meilleur || dist < meilleur.distanceM) {
        const hasTime = a.time && b.time;
        const time = hasTime ? new Date(a.time.getTime() + tt * (b.time.getTime() - a.time.getTime())) : null;
        meilleur = {
          lat: lerp(a.lat, b.lat, tt),
          lon: lerp(a.lon, b.lon, tt),
          ele: lerp(a.ele, b.ele, tt),
          time,
          distanceM: dist
        };
      }
    }
    return meilleur;
  }

  // ---- Conversion degrés décimaux -> DMS rationnel (pour piexifjs) -----
  function degVersDMSRationnel(deg) {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const minFloat = (abs - d) * 60;
    const m = Math.floor(minFloat);
    const secFloat = (minFloat - m) * 60;
    const sec = Math.round(secFloat * 1000);
    return [[d, 1], [m, 1], [sec, 1000]];
  }

  function formatDuree(ms) {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
  }

  function formatOffset(ms) {
    const s = Math.round(ms / 1000);
    const sign = s < 0 ? '−' : '+';
    const abs = Math.abs(s);
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const sec = abs % 60;
    let txt = '';
    if (h) txt += `${h} h `;
    if (h || m) txt += `${m} min `;
    txt += `${sec} s`;
    return `${sign} ${txt}`;
  }

  return {
    haversine, statsTrace, positionAuTemps, pointTraceLePlusProche,
    degVersDMSRationnel, formatDuree, formatOffset
  };
})();
