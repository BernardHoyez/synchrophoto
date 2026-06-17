/* ==========================================================================
   app.js — orchestration générale de Synchrophoto
   ========================================================================== */
(function () {
  'use strict';

  const EXT_RAW = new Set(['arw', 'mrw', 'raw', 'cr2', 'nef', 'orf', 'rw2', 'dng', 'sr2']);

  const state = {
    trackPoints: [],
    hasTime: false,
    photos: [],          // voir creerPhoto()
    offsetMs: 0,
    methode: 'direct',
    temoinPhotoId: null,
    temoinPosition: null // { lat, lon, time }
  };
  let compteurId = 0;

  // -------------------------------------------------------------- cartes --
  const carteTrace = SP.mapview.creerCarte('carte');
  const carteTemoin = SP.mapview.creerCarte('carte-temoin');
  const carteVerif = SP.mapview.creerCarte('carte-verif');

  // ---------------------------------------------------------- navigation --
  const etapeBoutons = Array.from(document.querySelectorAll('.etape-bouton'));
  function afficherEtape(n) {
    document.querySelectorAll('.panneau').forEach(p => p.classList.remove('active'));
    document.getElementById('panneau-' + n).classList.add('active');
    etapeBoutons.forEach(b => b.classList.toggle('active', b.dataset.etape === String(n)));
    if (n === 1) carteTrace.invalider();
    if (n === 3) carteTemoin.invalider();
    if (n === 4) carteVerif.invalider();
  }
  etapeBoutons.forEach(b => b.addEventListener('click', () => afficherEtape(b.dataset.etape)));
  document.getElementById('bouton-vers-2').addEventListener('click', () => afficherEtape(2));
  document.getElementById('bouton-vers-1b').addEventListener('click', () => afficherEtape(1));
  document.getElementById('bouton-vers-3').addEventListener('click', () => afficherEtape(3));
  document.getElementById('bouton-vers-2b').addEventListener('click', () => afficherEtape(2));
  document.getElementById('bouton-vers-4').addEventListener('click', () => { preparerEtape4(); afficherEtape(4); });
  document.getElementById('bouton-vers-3b').addEventListener('click', () => afficherEtape(3));
  document.getElementById('bouton-vers-5').addEventListener('click', () => { preparerEtape5(); afficherEtape(5); });
  document.getElementById('bouton-vers-4b').addEventListener('click', () => afficherEtape(4));

  function marquerEtapeFaite(n) {
    const b = etapeBoutons.find(b => b.dataset.etape === String(n));
    if (b) b.classList.add('fait');
  }

  // ------------------------------------------------------- dépôt fichiers --
  function brancherDepot(zone, input, onFiles) {
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('survol'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('survol'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('survol');
      onFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', () => { onFiles(input.files); input.value = ''; });
  }

  // =========================================================================
  // ÉTAPE 1 — TRACE
  // =========================================================================
  brancherDepot(document.getElementById('depot-trace'), document.getElementById('input-trace'), files => {
    if (!files || !files.length) return;
    chargerTrace(files[0]);
  });

  document.getElementById('select-fond').addEventListener('change', e => carteTrace.setFond(e.target.value));

  function chargerTrace(file) {
    const resume = document.getElementById('trace-resume');
    resume.innerHTML = '<p class="description">Lecture de la trace…</p>';
    SP.gpxkml.parseTrackFile(file).then(res => {
      state.trackPoints = res.points;
      state.hasTime = res.hasTime;
      carteTrace.setTrace(res.points);
      carteTemoin.setTrace(res.points);
      carteVerif.setTrace(res.points);

      const s = SP.geo.statsTrace(res.points);
      let html = `<div class="lecture">
        <div><span>Points</span><b>${s.nbPoints}</b></div>
        <div><span>Distance</span><b>${s.distanceKm.toFixed(2)} km</b></div>
        <div><span>Dénivelé +</span><b>${Math.round(s.deniveléPos)} m</b></div>
        <div><span>Dénivelé −</span><b>${Math.round(s.deniveléNeg)} m</b></div>
        <div><span>Durée</span><b>${SP.geo.formatDuree(s.dureeMs)}</b></div>
      </div>`;
      if (!res.hasTime) {
        html += `<p class="avertissement" style="margin-top:.7rem;">Cette trace ne contient pas d'horodatage par point. La géolocalisation par le temps est impossible avec ce fichier : utilisez de préférence un export GPX issu d'un traceur GPS.</p>`;
      }
      resume.innerHTML = html;
      document.getElementById('bouton-vers-2').disabled = !res.hasTime;
      if (res.hasTime) marquerEtapeFaite(1);
    }).catch(err => {
      resume.innerHTML = `<p class="erreur-bloc">${err.message}</p>`;
    });
  }

  // =========================================================================
  // ÉTAPE 2 — PHOTOS
  // =========================================================================
  brancherDepot(document.getElementById('depot-photos'), document.getElementById('input-photos'), files => {
    Array.from(files || []).forEach(ajouterPhoto);
  });

  function extensionDe(nom) { return (nom.split('.').pop() || '').toLowerCase(); }

  function creerLignePhoto(photo) {
    const div = document.createElement('div');
    div.className = 'bloc';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.gap = '.8rem';
    div.id = 'photo-' + photo.id;
    div.innerHTML = `
      <img class="miniature" id="min-${photo.id}" alt="">
      <div style="flex:1; min-width:0;">
        <div style="font-weight:600; overflow-wrap:anywhere;">${photo.name}</div>
        <div class="mono" style="font-size:.78rem; color:var(--encre-douce);" id="info-${photo.id}">
          ${photo.isRaw ? 'RAW' : 'JPEG'} · lecture de la date EXIF…
        </div>
      </div>
      <button class="discrete" data-retirer="${photo.id}">retirer</button>`;
    return div;
  }

  function ajouterPhoto(file) {
    const ext = extensionDe(file.name);
    const isRaw = ext !== 'jpg' && ext !== 'jpeg';
    const photo = {
      id: 'p' + (++compteurId),
      file, name: file.name, ext, isRaw,
      exifDate: null, apercuBlob: null,
      status: 'lecture', lat: null, lon: null, ele: null, time: null,
      resultBlob: null, resultName: null, erreur: null
    };
    state.photos.push(photo);
    document.getElementById('liste-photos').appendChild(creerLignePhoto(photo));

    // miniature : JPEG natif tout de suite, RAW après extraction de l'aperçu
    if (!isRaw) {
      document.getElementById('min-' + photo.id).src = URL.createObjectURL(file);
    } else {
      SP.exifio.extraireApercuJPEG(file).then(buf => {
        if (buf) {
          photo.apercuBlob = new Blob([buf], { type: 'image/jpeg' });
          document.getElementById('min-' + photo.id).src = URL.createObjectURL(photo.apercuBlob);
        }
      }).catch(() => {});
    }

    SP.exifio.lireDateOriginale(file, isRaw).then(date => {
      photo.exifDate = date;
      const info = document.getElementById('info-' + photo.id);
      if (!info) return;
      if (date) {
        info.textContent = `${isRaw ? 'RAW' : 'JPEG'} · prise le ${date.toLocaleString('fr-FR')} (heure appareil)`;
      } else {
        info.textContent = `${isRaw ? 'RAW' : 'JPEG'} · date EXIF introuvable — cette photo ne pourra pas être géolocalisée automatiquement`;
        info.style.color = 'var(--alerte)';
      }
      rafraichirSelectTemoin();
      validerEtape3();
    });

    document.getElementById('bouton-vers-3').disabled = state.photos.length === 0;
  }

  document.getElementById('liste-photos').addEventListener('click', e => {
    const id = e.target.dataset && e.target.dataset.retirer;
    if (!id) return;
    state.photos = state.photos.filter(p => p.id !== id);
    document.getElementById('photo-' + id).remove();
    document.getElementById('bouton-vers-3').disabled = state.photos.length === 0;
    rafraichirSelectTemoin();
  });

  // =========================================================================
  // ÉTAPE 3 — MÉTHODE
  // =========================================================================
  const blocDirect = document.getElementById('bloc-direct');
  const blocTemoin = document.getElementById('bloc-temoin');

  document.querySelectorAll('.carte-methode').forEach(carte => {
    carte.addEventListener('click', () => {
      document.querySelectorAll('.carte-methode').forEach(c => c.classList.remove('selectionne'));
      carte.classList.add('selectionne');
      state.methode = carte.dataset.methode;
      blocDirect.style.display = state.methode === 'direct' ? '' : 'none';
      blocTemoin.style.display = state.methode === 'temoin' ? '' : 'none';
      if (state.methode === 'temoin') carteTemoin.invalider();
      validerEtape3();
    });
  });

  document.getElementById('offset-manuel').addEventListener('input', e => {
    state.offsetMs = (parseFloat(e.target.value) || 0) * 1000;
    validerEtape3();
  });

  function rafraichirSelectTemoin() {
    const select = document.getElementById('select-temoin');
    const valeurActuelle = select.value;
    select.innerHTML = '<option value="">— choisir une photo —</option>' +
      state.photos.filter(p => p.exifDate).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (state.photos.some(p => p.id === valeurActuelle)) select.value = valeurActuelle;
  }

  document.getElementById('select-temoin').addEventListener('change', e => {
    state.temoinPhotoId = e.target.value || null;
    state.temoinPosition = null;
    document.getElementById('temoin-resultat').textContent = '';
    validerEtape3();
  });

  carteTemoin.onClic((lat, lon) => {
    if (!state.temoinPhotoId || !state.trackPoints.length) return;
    const photo = state.photos.find(p => p.id === state.temoinPhotoId);
    if (!photo || !photo.exifDate) return;

    const proche = SP.geo.pointTraceLePlusProche(state.trackPoints, lat, lon);
    if (!proche.time) {
      document.getElementById('temoin-resultat').innerHTML =
        `<span class="erreur-bloc" style="display:inline-block;">Le point cliqué n'a pas pu être daté sur la trace.</span>`;
      return;
    }
    carteTemoin.placerMarqueurTemoin(proche.lat, proche.lon);
    state.offsetMs = proche.time.getTime() - photo.exifDate.getTime();
    state.temoinPosition = proche;

    document.getElementById('temoin-resultat').innerHTML =
      `Position retenue sur la trace : <span class="mono">${proche.lat.toFixed(5)}, ${proche.lon.toFixed(5)}</span><br>
       Décalage appareil ↔ GPS calculé : <b class="mono">${SP.geo.formatOffset(state.offsetMs)}</b>
       <span style="color:var(--encre-douce);">(à ${Math.round(proche.distanceM)} m du point cliqué sur la trace)</span>`;
    validerEtape3();
  });

  function validerEtape3() {
    let ok = false;
    if (state.methode === 'direct') {
      ok = true; // décalage manuel facultatif, 0 par défaut
    } else {
      ok = !!(state.temoinPhotoId && state.temoinPosition);
    }
    document.getElementById('bouton-vers-4').disabled = !ok || state.photos.length === 0;
  }

  // =========================================================================
  // ÉTAPE 4 — GÉOLOCALISATION
  // =========================================================================
  document.getElementById('select-fond-verif').addEventListener('change', e => carteVerif.setFond(e.target.value));

  function preparerEtape4() {
    document.getElementById('lecture-methode').textContent = state.methode === 'direct' ? 'Réglage direct' : 'Photo témoin';
    document.getElementById('lecture-offset').textContent = SP.geo.formatOffset(state.offsetMs);
    document.getElementById('lecture-nb').textContent = state.photos.length;
    document.getElementById('bouton-vers-5').disabled = true;
  }

  function ligneResultat(photo) {
    return `<tr id="res-${photo.id}">
      <td><img class="miniature" src="" alt=""></td>
      <td>${photo.name}</td>
      <td class="coord" data-champ="heure">—</td>
      <td class="coord" data-champ="lat">—</td>
      <td class="coord" data-champ="lon">—</td>
      <td class="coord" data-champ="ele">—</td>
      <td data-champ="statut"><span class="puce attente">en attente</span></td>
    </tr>`;
  }

  async function obtenirImageDeBase(photo) {
    if (!photo.isRaw) return photo.file;
    if (photo.apercuBlob) return photo.apercuBlob;
    const buf = await SP.exifio.extraireApercuJPEG(photo.file);
    if (!buf) throw new Error("Aucun aperçu JPEG n'a pu être extrait de ce fichier RAW.");
    photo.apercuBlob = new Blob([buf], { type: 'image/jpeg' });
    return photo.apercuBlob;
  }

  document.getElementById('bouton-geolocaliser').addEventListener('click', async () => {
    const bouton = document.getElementById('bouton-geolocaliser');
    bouton.disabled = true;
    const tbody = document.querySelector('#table-resultats tbody');
    tbody.innerHTML = state.photos.map(ligneResultat).join('');
    state.photos.forEach(p => {
      const img = document.querySelector(`#res-${p.id} img`);
      if (img && p.apercuBlob) img.src = URL.createObjectURL(p.apercuBlob);
      else if (img && !p.isRaw) img.src = URL.createObjectURL(p.file);
    });

    carteVerif.clearMarqueurs();
    let nbOk = 0;

    for (const photo of state.photos) {
      const cellule = champ => document.querySelector(`#res-${photo.id} [data-champ="${champ}"]`);
      try {
        if (!photo.exifDate) throw new Error('Date EXIF introuvable.');
        const tempsCorrige = new Date(photo.exifDate.getTime() + state.offsetMs);
        const pos = SP.geo.positionAuTemps(state.trackPoints, tempsCorrige);

        const imageBase = await obtenirImageDeBase(photo);
        const blob = await SP.exifio.inserGPSDansJPEG(imageBase, { lat: pos.lat, lon: pos.lon, ele: pos.ele, time: pos.time });

        photo.lat = pos.lat; photo.lon = pos.lon; photo.ele = pos.ele; photo.time = pos.time;
        photo.resultBlob = blob;
        photo.resultName = photo.name.replace(/\.[^.]+$/, '') + '_loc.jpg';
        photo.status = 'ok';

        cellule('heure').textContent = pos.time.toISOString().slice(0, 19).replace('T', ' ');
        cellule('lat').textContent = pos.lat.toFixed(6);
        cellule('lon').textContent = pos.lon.toFixed(6);
        cellule('ele').textContent = Math.round(pos.ele) + ' m';
        cellule('statut').innerHTML = '<span class="puce ok">géolocalisée</span>';

        carteVerif.ajouterMarqueurPhoto(pos.lat, pos.lon,
          `<b>${photo.name}</b><br>${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}<br>${Math.round(pos.ele)} m`);
        nbOk++;
      } catch (err) {
        photo.status = 'erreur'; photo.erreur = err.message;
        cellule('statut').innerHTML = `<span class="puce erreur" title="${err.message}">erreur</span>`;
      }
    }

    bouton.disabled = false;
    document.getElementById('bouton-vers-5').disabled = nbOk === 0;
    if (nbOk > 0) marquerEtapeFaite(4);
  });

  // =========================================================================
  // ÉTAPE 5 — EXPORT
  // =========================================================================
  function preparerEtape5() {
    const ok = state.photos.filter(p => p.status === 'ok');
    const echec = state.photos.filter(p => p.status !== 'ok');
    let html = `<p><b>${ok.length}</b> photo(s) géolocalisée(s) avec succès`;
    html += echec.length ? `, <b>${echec.length}</b> en échec.</p>` : '.</p>';
    if (ok.length) {
      html += '<ul style="padding-left:1.2rem;">' + ok.map(p =>
        `<li>${p.resultName} <button class="discrete" data-telecharger="${p.id}">télécharger</button></li>`
      ).join('') + '</ul>';
    }
    if (echec.length) {
      html += '<p class="avertissement">Non géolocalisées : ' + echec.map(p => `${p.name} (${p.erreur || 'inconnue'})`).join(', ') + '</p>';
    }
    document.getElementById('resume-export').innerHTML = html;
  }

  document.getElementById('resume-export').addEventListener('click', e => {
    const id = e.target.dataset && e.target.dataset.telecharger;
    if (!id) return;
    const photo = state.photos.find(p => p.id === id);
    if (!photo || !photo.resultBlob) return;
    declencherTelechargement(photo.resultBlob, photo.resultName);
  });

  function declencherTelechargement(blob, nom) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  document.getElementById('bouton-zip').addEventListener('click', async () => {
    const ok = state.photos.filter(p => p.status === 'ok' && p.resultBlob);
    if (!ok.length) { alert('Aucune photo géolocalisée à exporter pour le moment.'); return; }
    const bouton = document.getElementById('bouton-zip');
    bouton.disabled = true; bouton.textContent = 'Préparation de l\'archive…';
    try {
      const zip = new JSZip();
      ok.forEach(p => zip.file(p.resultName, p.resultBlob));
      const contenu = await zip.generateAsync({ type: 'blob' });
      declencherTelechargement(contenu, 'synchrophoto_export.zip');
    } finally {
      bouton.disabled = false; bouton.textContent = "Télécharger l'archive .zip";
    }
  });

  // ---------------------------------------------------------- service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const installant = reg.installing;
        installant.addEventListener('statechange', () => {
          if (installant.state === 'installed' && navigator.serviceWorker.controller) {
            const etat = document.getElementById('etat-sw');
            etat.textContent = 'nouvelle version disponible — cliquer pour mettre à jour';
            etat.classList.add('maj');
            etat.onclick = () => { installant.postMessage('SAUTER_ATTENTE'); };
          }
        });
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  }

  afficherEtape(1);
})();
