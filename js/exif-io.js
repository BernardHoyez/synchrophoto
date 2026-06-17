/* ==========================================================================
   exif-io.js — lecture des métadonnées d'origine (date de prise de vue),
   extraction d'un JPEG visualisable depuis un fichier RAW non modifié,
   et écriture des tags GPS EXIF dans le JPEG de sortie.
   ========================================================================== */
window.SP = window.SP || {};

SP.exifio = (function () {

  const FENETRE_SCAN_RAW = 16 * 1024 * 1024; // on ne scrute que le début du fichier RAW

  // ---- Repère un en-tête TIFF ("II*\0" / "MM\0*") niché dans le fichier ----
  function trouverEnteteTIFF(buffer) {
    const bytes = new Uint8Array(buffer);
    const limite = Math.min(bytes.length - 4, FENETRE_SCAN_RAW);
    for (let i = 0; i < limite; i++) {
      if (bytes[i] === 0x49 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0x2A && bytes[i + 3] === 0x00) return i;
      if (bytes[i] === 0x4D && bytes[i + 1] === 0x4D && bytes[i + 2] === 0x00 && bytes[i + 3] === 0x2A) return i;
    }
    return null;
  }

  // ---- Date de prise de vue (DateTimeOriginal / CreateDate) ---------------
  async function lireDateOriginale(file, estRaw) {
    try {
      const out = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
      const d = out && (out.DateTimeOriginal || out.CreateDate || out.ModifyDate);
      if (d instanceof Date && !isNaN(d.getTime())) return d;
    } catch (e) { /* on retente plus bas si c'est un RAW */ }

    if (estRaw) {
      try {
        const buffer = await file.arrayBuffer();
        const offset = trouverEnteteTIFF(buffer);
        if (offset != null) {
          const sousBuffer = buffer.slice(offset);
          const out = await exifr.parse(sousBuffer, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
          const d = out && (out.DateTimeOriginal || out.CreateDate || out.ModifyDate);
          if (d instanceof Date && !isNaN(d.getTime())) return d;
        }
      } catch (e) { /* abandon : aucune date trouvée */ }
    }
    return null;
  }

  // ---- Extraction du plus grand JPEG incorporé dans un fichier RAW --------
  // Repère par balayage linéaire des marqueurs SOI (FFD8) / EOI (FFD9).
  // Le fichier RAW lui-même n'est ni lu en entier ni modifié sur disque ;
  // on ne fait que lire ses octets en mémoire pour en tirer un aperçu.
  async function extraireApercuJPEG(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const limite = Math.min(bytes.length - 1, FENETRE_SCAN_RAW);

    const segments = [];
    let enJPEG = false, debut = -1;
    for (let i = 0; i < limite; i++) {
      if (!enJPEG) {
        if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8) { debut = i; enJPEG = true; }
      } else if (bytes[i] === 0xFF && bytes[i + 1] === 0xD9) {
        segments.push({ start: debut, end: i + 2, length: i + 2 - debut });
        enJPEG = false;
      }
    }

    if (!segments.length) {
      // dernier recours : la vignette IFD1 extraite par exifr
      try {
        const thumb = await exifr.thumbnail(file);
        if (thumb) return thumb.buffer ? thumb.buffer : thumb;
      } catch (e) { /* rien à faire */ }
      return null;
    }

    segments.sort((a, b) => b.length - a.length);
    return buffer.slice(segments[0].start, segments[0].end);
  }

  // ---- Conversions Blob <-> DataURL ---------------------------------------
  function versDataURL(source) {
    const blob = source instanceof Blob ? source : new Blob([source], { type: 'image/jpeg' });
    return new Promise((resolve, reject) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resolve(lecteur.result);
      lecteur.onerror = () => reject(lecteur.error);
      lecteur.readAsDataURL(blob);
    });
  }

  function dataURLVersBlob(dataURL) {
    const [meta, base64] = dataURL.split(',');
    const mime = /data:([^;]+);base64/.exec(meta)?.[1] || 'image/jpeg';
    const binaire = atob(base64);
    const octets = new Uint8Array(binaire.length);
    for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
    return new Blob([octets], { type: mime });
  }

  // ---- Reconstruction d'un JPEG standard via <canvas> (filet de sécurité) -
  // Nécessaire si l'aperçu extrait d'un RAW a une structure trop atypique
  // pour que piexifjs y localise un point d'insertion EXIF.
  function renormaliserJPEG(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => reject(new Error('Image dérivée illisible par le navigateur.'));
      img.src = dataURL;
    });
  }

  // ---- Construction du bloc GPS EXIF (tags demandés + accompagnateurs) ---
  function construireBlocGPS(position) {
    const t = position.time; // instant UTC corrigé, issu de la trace
    const dateStr = `${t.getUTCFullYear()}:${String(t.getUTCMonth() + 1).padStart(2, '0')}:${String(t.getUTCDate()).padStart(2, '0')}`;
    const GPS = piexif.GPSIFD;
    const bloc = {};
    bloc[GPS.GPSVersionID] = [2, 3, 0, 0];
    bloc[GPS.GPSLatitudeRef] = position.lat >= 0 ? 'N' : 'S';
    bloc[GPS.GPSLatitude] = SP.geo.degVersDMSRationnel(position.lat);
    bloc[GPS.GPSLongitudeRef] = position.lon >= 0 ? 'E' : 'W';
    bloc[GPS.GPSLongitude] = SP.geo.degVersDMSRationnel(position.lon);
    bloc[GPS.GPSAltitudeRef] = position.ele < 0 ? 1 : 0;
    bloc[GPS.GPSAltitude] = [[Math.round(Math.abs(position.ele) * 100), 100]];
    bloc[GPS.GPSDateStamp] = dateStr;
    bloc[GPS.GPSTimeStamp] = [[t.getUTCHours(), 1], [t.getUTCMinutes(), 1], [t.getUTCSeconds(), 1]];
    bloc[GPS.GPSMapDatum] = 'WGS-84';
    return bloc;
  }

  // ---- Insertion des tags GPS dans une image JPEG -> Blob de sortie -------
  async function inserGPSDansJPEG(imageSource, position) {
    let dataURL = await versDataURL(imageSource);
    const exifStr = piexif.dump({ GPS: construireBlocGPS(position) });
    let resultatURL;
    try {
      resultatURL = piexif.insert(exifStr, dataURL);
    } catch (premiereErreur) {
      // l'image dérivée n'a pas une structure JPEG standard : on la
      // réencode proprement via canvas avant de retenter l'insertion EXIF.
      const renorm = await renormaliserJPEG(dataURL);
      resultatURL = piexif.insert(exifStr, renorm);
    }
    return dataURLVersBlob(resultatURL);
  }

  return { lireDateOriginale, extraireApercuJPEG, inserGPSDansJPEG, versDataURL };
})();
