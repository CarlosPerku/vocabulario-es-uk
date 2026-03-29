// ==================== CONFIG ====================
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
const GITHUB_REPO = ''; // Ej: 'usuario/repo' para crear Issues
const IMAGE_CACHE_KEY = 'image_cache';

// ==================== PRONUNCIACIÓN ====================
function speakWord(text, rate = 1.0) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'es-ES';
  utter.rate = rate;
  const voices = window.speechSynthesis.getVoices();
  const esVoice = voices.find(v => v.lang.startsWith('es'));
  if (esVoice) utter.voice = esVoice;
  // Android Chrome necesita un pequeño delay tras cancel()
  setTimeout(() => window.speechSynthesis.speak(utter), 50);
}

// Emojis genéricos que NO representan exactamente la palabra
const GENERIC_EMOJIS = new Set(['🍽️', '📖', '📝', '🔤', '❓', '']);

function wordVisual(w, imgStyle = '') {
  const exactEmoji = w.emoji && !GENERIC_EMOJIS.has(w.emoji);
  if (exactEmoji) return w.emoji;
  if (w.imagen) return `<img src="${w.imagen}"${imgStyle ? ' style="' + imgStyle + '"' : ''} onerror="this.outerHTML='${w.emoji || '🍽️'}'">`;
  return w.emoji || '🍽️';
}

function speakBtns(text) {
  return `<div class="speak-btns"><button class="btn-speak" onclick="event.stopPropagation();speakWord('${text.replace(/'/g, "\\'")}',1.0)" title="Pronunciar / Вимова">🔊</button><button class="btn-speak btn-speak-slow" onclick="event.stopPropagation();speakWord('${text.replace(/'/g, "\\'")}',0.25)" title="Lento / Повільно">🐢</button></div>`;
}

// ==================== STATE ====================
let vocabBase = { categorias: [] };
let emojiMapExternal = {};   // cargado de emoji-es.json
let miVocabulario = [];
let quizWords = [];
let quizIndex = 0;
let selectedImageUrl = '';
let activeTagFilter = '';   // etiqueta activa para filtrar
let modalTags = [];         // etiquetas del modal en edición

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadVocabBase(), loadEmojiMapExternal()]);

  // Iniciar Firebase Auth — esperar a saber si hay sesión antes de cargar vocab
  initAuth(async (user) => {
    updateAuthUI(user);
    if (user) {
      // Intentar cargar desde la nube
      const cloudWords = await loadVocabFromCloud();
      if (cloudWords !== null) {
        miVocabulario = cloudWords;
        saveMyVocabLocal(); // guardar copia local también
      } else {
        // Primera vez en la nube: subir lo que hay en local
        loadMyVocabLocal();
        await saveVocabToCloud(miVocabulario);
      }
    } else {
      // Sin sesión: usar localStorage
      loadMyVocabLocal();
    }
    setupFilter();
    renderMyVocab();
    renderCategorias();
    renderTagsBar();
    enrichVocabWithImages();
  });

  setupTabs();
  setupSearch();
  setupModal();
  setupQuiz();
  setupImagePicker();
  setupTagsInput();
  setupCameraInput();
  setupCatModalTranslation();
  setupDetailTagsInput();
  setupDetailCatSelects();
  setupExploreSearch();
  setupCategoriasSearch();
  setupTranslatePair('detail-desc-es', 'detail-desc-uk', 'es', 'uk', detailUserEdited);
  setupTranslatePair('detail-desc-uk', 'detail-desc-es', 'uk', 'es', detailUserEdited);
  setupTranslatePair('detail-uk', 'detail-es', 'uk', 'es', detailUserEdited);
  setupTranslatePair('detail-es', 'detail-uk', 'es', 'uk', detailUserEdited);
  checkIosInstallHint();
});

function updateAuthUI(user) {
  const btnLogin = document.getElementById('btn-login');
  const userInfo = document.getElementById('user-info');
  const avatar = document.getElementById('user-avatar');

  if (user) {
    btnLogin.classList.add('hidden');
    userInfo.classList.remove('hidden');
    avatar.src = user.photoURL || '';
    showToast(`¡Bienvenido! / Вітаємо, ${user.displayName?.split(' ')[0] || ''}! ☁️`);
  } else {
    btnLogin.classList.remove('hidden');
    userInfo.classList.add('hidden');
  }
}

// ==================== DATA LOADING ====================
async function loadVocabBase() {
  try {
    const res = await fetch('vocabulario.json');
    vocabBase = await res.json();
  } catch (e) {
    console.warn('No se pudo cargar vocabulario.json, usando datos vacíos');
    vocabBase = { categorias: [] };
  }
}

async function loadEmojiMapExternal() {
  try {
    const res = await fetch('emoji-es.json');
    emojiMapExternal = await res.json();
  } catch (e) {
    console.warn('No se pudo cargar emoji-es.json');
    emojiMapExternal = {};
  }
}

function loadMyVocabLocal() {
  const saved = localStorage.getItem('mi_vocabulario');
  miVocabulario = saved ? JSON.parse(saved) : [];
}

function saveMyVocabLocal() {
  localStorage.setItem('mi_vocabulario', JSON.stringify(miVocabulario));
}

// Guarda localmente y en la nube si hay sesión
function saveMyVocab() {
  saveMyVocabLocal();
  if (typeof currentUser !== 'undefined' && currentUser) {
    saveVocabToCloud(miVocabulario);
  }
}

function getAllBaseWords() {
  const words = [];
  vocabBase.categorias.forEach(cat => {
    cat.subcategorias.forEach(sub => {
      sub.palabras.forEach(p => {
        words.push({
          ...p,
          categoria: cat.nombre.es,
          categoriaUk: cat.nombre.uk,
          categoriaId: cat.id,
          subcategoria: sub.nombre.es,
          subcategoriaUk: sub.nombre.uk,
          subcategoriaId: sub.id
        });
      });
    });
  });
  return words;
}

// ==================== TABS ====================
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`view-${tab.dataset.view}`).classList.add('active');

      if (tab.dataset.view === 'vocabulario') renderMyVocab();
      if (tab.dataset.view === 'categorias') renderCategorias();
      if (tab.dataset.view === 'etiquetas') renderEtiquetas();
      if (tab.dataset.view === 'explorar') renderExploreDatabase();
    });
  });
}

// ==================== AUTO-TRANSLATE CATEGORY MODAL ====================
function setupCatModalTranslation() {
  setupTranslatePair('cat-modal-es', 'cat-modal-uk', 'es', 'uk', catModalUserEdited);
  setupTranslatePair('cat-modal-uk', 'cat-modal-es', 'uk', 'es', catModalUserEdited);
}

async function translateText(text, from, to) {
  if (!text.trim()) return '';
  const url = `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData.translatedText) {
      let t = data.responseData.translatedText;
      if (t === t.toUpperCase() && t.length > 3) t = capitalizeFirst(t.toLowerCase());
      return t;
    }
  } catch (e) { /* silencioso */ }
  return '';
}

// ==================== FILTER ====================
function setupFilter() {
  const filterInput = document.getElementById('filter-input');
  const filterCat = document.getElementById('filter-categoria');

  // Populate category filter
  populateCategoryFilter();

  filterInput.addEventListener('input', renderMyVocab);
  filterCat.addEventListener('change', renderMyVocab);
}

function populateCategoryFilter() {
  const select = document.getElementById('filter-categoria');
  const cats = new Set(miVocabulario.map(w => w.categoria).filter(Boolean));
  select.innerHTML = '<option value="">Todas / Усі категорії</option>';
  const sinCat = miVocabulario.filter(w => !w.categoria).length;
  if (sinCat > 0) select.innerHTML += `<option value="__none__">⚠️ Sin categoría (${sinCat})</option>`;
  cats.forEach(cat => {
    const w = miVocabulario.find(w => w.categoria === cat);
    const uk = w ? w.categoriaUk || '' : '';
    select.innerHTML += `<option value="${cat}">${cat}${uk ? ' / ' + uk : ''}</option>`;
  });
}

// ==================== RENDER MY VOCAB ====================
function renderMyVocab() {
  const list = document.getElementById('vocab-list');
  const empty = document.getElementById('vocab-empty');
  const filterText = document.getElementById('filter-input').value.toLowerCase();
  const filterCat = document.getElementById('filter-categoria').value;

  let words = [...miVocabulario];

  if (filterText) {
    words = words.filter(w =>
      w.es.toLowerCase().includes(filterText) ||
      w.uk.toLowerCase().includes(filterText) ||
      (w.descripcion && w.descripcion.toLowerCase().includes(filterText))
    );
  }

  if (filterCat === '__none__') {
    words = words.filter(w => !w.categoria);
  } else if (filterCat) {
    words = words.filter(w => w.categoria === filterCat);
  }

  if (activeTagFilter) {
    words = words.filter(w => w.etiquetas && w.etiquetas.includes(activeTagFilter));
  }

  if (words.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = words.map(w => {
    const isSelected = selectedWords.has(w.id);
    const clickAction = selectMode
      ? `toggleWordSelect('${w.id}', event)`
      : `openWordDetail('${w.id}')`;
    const imgAction = selectMode
      ? `toggleWordSelect('${w.id}', event)`
      : `event.stopPropagation(); openImagePicker('${w.id}')`;
    return `
    <div class="word-card${isSelected ? ' selected' : ''}" data-id="${w.id}" onclick="${clickAction}">
      ${selectMode ? `<div class="word-select-check">${isSelected ? '✓' : ''}</div>` : ''}
      <div class="card-image" onclick="${imgAction}" title="Cambiar imagen / Змінити зображення">
        ${wordVisual(w)}
        ${!selectMode ? '<div class="card-image-hint">🖼️</div>' : ''}
      </div>
      <div class="card-info">
        <div class="card-es-row"><span class="card-es">${w.es}</span>${selectMode ? '' : speakBtns(w.es)}</div>
        <div class="card-uk">${w.uk}</div>
        ${w.descripcion_es ? `<div class="card-desc card-desc-es">${w.descripcion_es}</div>` : ''}
        <span class="card-category">${w.categoria || '<em style="color:#ef4444">Sin categoría</em>'}${w.subcategoria ? ' › ' + w.subcategoria : ''}</span>
      </div>
    </div>`;
  }).join('');
}

function removeWord(id) {
  miVocabulario = miVocabulario.filter(w => w.id !== id);
  saveMyVocab();
  populateCategoryFilter();
  renderMyVocab();
  showToast('Eliminada / Видалено');
}

// ==================== SEARCH ====================
function setupSearch() {
  const input = document.getElementById('search-input');
  const btn = document.getElementById('search-btn');

  btn.addEventListener('click', () => doSearch(input.value.trim()));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch(input.value.trim());
  });

  // Live suggestions while typing
  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    if (val.length < 2) {
      document.getElementById('suggestions').innerHTML = '';
      return;
    }
    showSuggestions(val);
  });
}

function normalizeStr(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isCyrillicText(str) {
  return /[\u0400-\u04FF]/.test(str);
}

function matchesQuery(word, query) {
  if (!query || query.length < 2) return false;
  const q = normalizeStr(query);
  const esNorm = normalizeStr(word.es);
  const esWords = esNorm.split(/\s+/);
  const ukLower = (word.uk || '').toLowerCase();

  // Alguna palabra del término empieza por la búsqueda (ej: "gam" → "gambas")
  if (esWords.some(w => w.startsWith(q))) return true;

  // Para búsquedas largas (4+ caracteres): substring y fuzzy
  if (q.length >= 4) {
    if (esNorm.includes(q)) return true;
    if (levenshtein(esWords[0], q) <= 2) return true;
    if (levenshtein(esNorm, q) <= 2) return true;
  }

  // Coincidencia en ucraniano
  if (ukLower.includes(query.toLowerCase())) return true;

  return false;
}

function showSuggestions(query) {
  const allWords = getAllBaseWords();
  const matches = allWords.filter(w => matchesQuery(w, query)).slice(0, 5);

  const container = document.getElementById('suggestions');
  if (matches.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = matches.map(m =>
    `<span class="suggestion-item" onclick="doSearch('${m.es}')">${m.emoji || ''} ${m.es} — ${m.uk}</span>`
  ).join('');
}

// Almacena datos de palabras del buscador para recuperarlos al añadir
const searchResultData = new Map();

async function doSearch(query) {
  if (!query) return;

  document.getElementById('search-input').value = query;
  document.getElementById('suggestions').innerHTML = '';
  const results = document.getElementById('search-results');
  const empty = document.getElementById('search-empty');

  results.innerHTML = '<div class="loading"><div class="spinner"></div>Buscando / Шукаю...</div>';
  empty.style.display = 'none';
  searchResultData.clear();

  // Detectar si la búsqueda es en ucraniano
  const isUkrainian = isCyrillicText(query);
  let queryEs = query;
  let queryUk = '';

  if (isUkrainian) {
    // Traducir ucraniano → español para buscar y para imágenes
    try { queryEs = await translateText(query, 'uk', 'es') || query; } catch (e) {}
    queryUk = query;
  } else {
    // Traducir español → ucraniano para mostrarlo
    try { queryUk = await translateToUkrainian(query); } catch (e) {}
  }

  // 1. Buscar en vocabulario base y ordenar: exacto primero, luego starts-with, luego el resto
  const allWords = getAllBaseWords();
  const qNorm = normalizeStr(queryEs);

  function matchScore(w) {
    const esNorm = normalizeStr(w.es);
    if (esNorm === qNorm) return 0;                          // coincidencia exacta
    if (esNorm.split(/\s+/)[0] === qNorm) return 1;         // primera palabra exacta
    if (esNorm.startsWith(qNorm)) return 2;                 // empieza por la búsqueda
    if (esNorm.split(/\s+/).some(w => w.startsWith(qNorm))) return 3; // alguna palabra empieza
    return 4;                                                // otros
  }

  const baseMatches = allWords
    .filter(w => matchesQuery(w, queryEs) || (isUkrainian && matchesQuery(w, query)))
    .sort((a, b) => matchScore(a) - matchScore(b));

  // 2. Buscar imágenes usando el término más relevante
  const imageQuery = baseMatches.length > 0 ? baseMatches[0].es : queryEs;
  let images = [];
  try { images = await searchImages(imageQuery); } catch (e) {}

  // Construir resultados
  let html = '';

  baseMatches.forEach(match => {
    const isAdded = miVocabulario.some(w => w.id === match.id);
    html += renderSearchResult(match, images, isAdded, true);
  });

  // Si no hay coincidencia exacta en la base, mostrar como palabra nueva al final
  const hasExact = baseMatches.length > 0 && normalizeStr(baseMatches[0].es) === qNorm;
  if (!hasExact) {
    const newWord = {
      id: slugify(queryEs),
      es: capitalizeFirst(isUkrainian ? queryEs : query),
      uk: isUkrainian ? query : (queryUk || ''),
      descripcion: '',
      emoji: guessEmoji(queryEs),
      imagen: images.length > 0 ? images[0] : ''
    };
    if (!miVocabulario.some(w => w.id === newWord.id) || baseMatches.length === 0) {
      const isAdded = miVocabulario.some(w => w.id === newWord.id);
      html += renderSearchResult(newWord, images, isAdded, false);
    }
  }

  if (html) {
    results.innerHTML = html;
  } else {
    results.innerHTML = '';
    empty.style.display = 'block';
  }
}

function renderSearchResult(word, images, isAdded, isFromBase) {
  // Guardar datos de la palabra para recuperarlos al añadir
  searchResultData.set(word.id, { ...word, _images: images });

  const imgHtml = images.length > 0
    ? `<div class="result-images">${images.map((url, i) =>
        `<img src="${url}" class="result-img${i === 0 ? ' selected' : ''}" onclick="selectResultImage(this, '${word.id}')" alt="${word.es}">`
      ).join('')}</div>`
    : `<div class="result-emoji-fallback">${word.emoji || '🍽️'}</div>`;

  return `
    <div class="search-result-card" data-word-id="${word.id}">
      ${imgHtml}
      <div class="card-img-tools">
        <div class="card-img-search-row">
          <input type="text" class="input-field card-img-search-input" placeholder="Buscar imagen / Шукати фото..." value="${word.es}">
          <button class="btn btn-secondary card-img-search-btn" onclick="searchMoreImagesForCard('${word.id}')">🔍</button>
        </div>
        <button class="btn btn-secondary card-img-camera-btn" onclick="openCameraForSearchCard('${word.id}')">📷</button>
      </div>
      <div class="result-info">
        <div class="result-es-row"><span class="result-es">${word.es}</span>${speakBtns(word.es)}</div>
        <div class="result-uk">${word.uk || '<em>Sin traducción / Без перекладу</em>'}</div>
        ${word.descripcion_es ? `<div class="result-desc result-desc-es">${word.descripcion_es}</div>` : ''}
        ${word.descripcion ? `<div class="result-desc result-desc-uk">${word.descripcion}</div>` : ''}
        <div class="result-actions">
          ${isAdded
            ? '<span class="badge-added">✓ Añadida / Додано</span>'
            : `<button class="btn btn-add" onclick="addFromSearchCard('${word.id}')">+ Añadir / Додати</button>`
          }
        </div>
      </div>
    </div>
  `;
}

function selectResultImage(imgEl, wordId) {
  const card = imgEl.closest('.search-result-card');
  card.querySelectorAll('.result-img').forEach(i => i.classList.remove('selected'));
  imgEl.classList.add('selected');
}

function addFromSearchCard(wordId) {
  const word = searchResultData.get(wordId);
  if (!word) return;
  // Leer la imagen actualmente seleccionada en el card
  const card = document.querySelector(`.search-result-card[data-word-id="${wordId}"]`);
  const selectedImg = card?.querySelector('.result-img.selected');
  const wordWithImage = { ...word, imagen: selectedImg?.src || word.imagen || '' };
  openAddModal(JSON.stringify(wordWithImage));
}

// ==================== AUTO-TRANSLATE HELPERS ====================
// Traduce al salir del campo fuente (blur).
// No sobreescribe el campo destino si el usuario lo editó manualmente.
// Si el campo destino se vacía, vuelve a permitir la auto-traducción.
function setupTranslatePair(srcId, dstId, from, to, userEditedSet) {
  const src = document.getElementById(srcId);
  const dst = document.getElementById(dstId);
  if (!src || !dst) return;

  // Marcar destino como editado manualmente cuando el usuario escribe en él
  dst.addEventListener('input', () => {
    if (dst.value.trim()) {
      userEditedSet.add(dstId);
    } else {
      userEditedSet.delete(dstId); // vacío = permitir auto-translate de nuevo
    }
  });

  // Traducir al salir del campo fuente
  src.addEventListener('blur', async () => {
    const val = src.value.trim();
    if (!val) return;
    if (userEditedSet.has(dstId)) return; // el usuario editó manualmente, no tocar
    const translated = await translateText(val, from, to);
    if (translated && !userEditedSet.has(dstId)) dst.value = translated;
  });
}

// Sets de campos editados manualmente — se resetean al abrir cada modal
const modalUserEdited = new Set();
const catModalUserEdited = new Set();
const detailUserEdited = new Set();

// ==================== ADD MODAL ====================
function setupModal() {
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', saveFromModal);
  document.getElementById('modal-cat').addEventListener('change', () => {
    const isNew = document.getElementById('modal-cat').value === '__new__';
    document.getElementById('new-cat-group').classList.toggle('hidden', !isNew);
    if (isNew) {
      document.getElementById('modal-new-cat').value = '';
      document.getElementById('modal-new-cat').focus();
    }
    updateSubcatOptions();
  });

  document.getElementById('modal-subcat').addEventListener('change', () => {
    const isNew = document.getElementById('modal-subcat').value === '__new__';
    document.getElementById('new-subcat-group').classList.toggle('hidden', !isNew);
    if (isNew) {
      document.getElementById('modal-new-subcat').value = '';
      document.getElementById('modal-new-subcat').focus();
    }
  });

  // Auto-traducción al salir del campo (blur), sin sobreescribir ediciones manuales
  setupTranslatePair('modal-desc-es', 'modal-desc', 'es', 'uk', modalUserEdited);
  setupTranslatePair('modal-desc', 'modal-desc-es', 'uk', 'es', modalUserEdited);
  setupTranslatePair('modal-uk', 'modal-es', 'uk', 'es', modalUserEdited);
}

function openAddModal(wordJsonStr) {
  const word = JSON.parse(wordJsonStr);
  selectedImageUrl = word.imagen || '';

  document.getElementById('modal-es').value = word.es;
  document.getElementById('modal-uk').value = word.uk || '';
  document.getElementById('modal-desc').value = word.descripcion || '';
  document.getElementById('modal-desc-es').value = word.descripcion_es || '';
  document.getElementById('modal-new-cat').value = '';
  document.getElementById('modal-new-subcat').value = '';
  modalTags = word.etiquetas ? [...word.etiquetas] : [];
  renderModalTags();

  // Populate category select — base + usuario + palabras existentes
  const catSelect = document.getElementById('modal-cat');
  catSelect.innerHTML = '<option value="">Seleccionar / Обрати...</option>';
  const allCatsMap = new Map();
  vocabBase.categorias.forEach(c => allCatsMap.set(c.id, { id: c.id, es: c.nombre.es, uk: c.nombre.uk, emoji: c.emoji || '' }));
  getUserCategories().forEach(c => { if (!allCatsMap.has(c.id)) allCatsMap.set(c.id, { id: c.id, es: c.nombre.es, uk: c.nombre.uk || '', emoji: '' }); });
  miVocabulario.forEach(w => { if (w.categoriaId && !allCatsMap.has(w.categoriaId)) allCatsMap.set(w.categoriaId, { id: w.categoriaId, es: w.categoria || w.categoriaId, uk: w.categoriaUk || '', emoji: '' }); });
  allCatsMap.forEach(c => { catSelect.innerHTML += `<option value="${c.id}">${c.emoji ? c.emoji + ' ' : ''}${c.es}${c.uk ? ' / ' + c.uk : ''}</option>`; });
  catSelect.innerHTML += `<option value="__new__">+ Nueva categoría / Нова категорія</option>`;

  // Pre-select category if word has one
  if (word.categoriaId) {
    catSelect.value = word.categoriaId;
  } else if (vocabBase.categorias.length > 0) {
    catSelect.value = vocabBase.categorias[0].id;
  }
  document.getElementById('new-cat-group').classList.add('hidden');
  document.getElementById('new-subcat-group').classList.add('hidden');
  updateSubcatOptions();

  // Images in modal — marcar como seleccionada la que el usuario eligió
  const modalImages = document.getElementById('modal-images');
  if (word._images && word._images.length > 0) {
    modalImages.innerHTML = word._images.map(url => {
      const isSelected = url === word.imagen || (!word.imagen && url === word._images[0]);
      if (isSelected) selectedImageUrl = url;
      return `<img src="${url}" class="${isSelected ? 'selected' : ''}" onclick="selectModalImage(this, '${url}')">`;
    }).join('');
    // Si la imagen seleccionada no está en _images (p.ej. foto de cámara), añadirla
    if (word.imagen && !word._images.includes(word.imagen)) {
      modalImages.innerHTML = `<img src="${word.imagen}" class="selected" onclick="selectModalImage(this, '${word.imagen}')">` + modalImages.innerHTML;
      selectedImageUrl = word.imagen;
    }
  } else if (word.imagen) {
    modalImages.innerHTML = `<img src="${word.imagen}" class="selected" onclick="selectModalImage(this, '${word.imagen}')">`;
  } else {
    modalImages.innerHTML = '';
  }

  modalUserEdited.clear();
  document.getElementById('add-modal').classList.remove('hidden');
  pushModalState();
}

function closeModal() {
  document.getElementById('add-modal').classList.add('hidden');
}

function selectModalImage(imgEl, url) {
  document.querySelectorAll('#modal-images img').forEach(i => i.classList.remove('selected'));
  imgEl.classList.add('selected');
  selectedImageUrl = url;
}

function updateSubcatOptions() {
  const catId = document.getElementById('modal-cat').value;
  const subcatSelect = document.getElementById('modal-subcat');
  subcatSelect.innerHTML = '<option value="">Seleccionar / Обрати...</option>';

  const allSubsMap = new Map();
  const baseCat = vocabBase.categorias.find(c => c.id === catId);
  if (baseCat) {
    baseCat.subcategorias.forEach(s => allSubsMap.set(s.id, { id: s.id, es: s.nombre.es, uk: s.nombre.uk, emoji: s.emoji || '' }));
  }
  getUserSubcategories(catId).forEach(s => { if (!allSubsMap.has(s.id)) allSubsMap.set(s.id, { id: s.id, es: s.nombre.es, uk: s.nombre.uk || '', emoji: '' }); });
  miVocabulario.filter(w => w.categoriaId === catId && w.subcategoriaId).forEach(w => { if (!allSubsMap.has(w.subcategoriaId)) allSubsMap.set(w.subcategoriaId, { id: w.subcategoriaId, es: w.subcategoria || w.subcategoriaId, uk: w.subcategoriaUk || '', emoji: '' }); });
  allSubsMap.forEach(s => { subcatSelect.innerHTML += `<option value="${s.id}">${s.emoji ? s.emoji + ' ' : ''}${s.es}${s.uk ? ' / ' + s.uk : ''}</option>`; });
  subcatSelect.innerHTML += `<option value="__new__">+ Nueva subcategoría / Нова підкатегорія</option>`;
  document.getElementById('new-subcat-group').classList.add('hidden');
}

function saveFromModal() {
  const es = document.getElementById('modal-es').value.trim();
  const uk = document.getElementById('modal-uk').value.trim();
  const desc = document.getElementById('modal-desc').value.trim();
  let catId = document.getElementById('modal-cat').value;
  let subcatId = document.getElementById('modal-subcat').value;
  const newCat = document.getElementById('modal-new-cat').value.trim();
  const newSubcat = document.getElementById('modal-new-subcat').value.trim();

  if (!es) return;

  // Handle new category (from dropdown __new__ or legacy text field)
  const isNewCat = catId === '__new__' || !!newCat;
  const newCatName = newCat || (catId === '__new__' ? document.getElementById('modal-new-cat').value.trim() : '');

  let catName = '', catNameUk = '';
  if (isNewCat && newCatName) {
    catId = slugify(newCatName);
    catName = newCatName;
    catNameUk = newCatName;
  } else {
    const baseCat = vocabBase.categorias.find(c => c.id === catId);
    const userCat = getUserCategories().find(c => c.id === catId);
    const wordWithCat = miVocabulario.find(w => w.categoriaId === catId);
    catName = baseCat?.nombre.es || userCat?.nombre.es || wordWithCat?.categoria || catId;
    catNameUk = baseCat?.nombre.uk || userCat?.nombre.uk || wordWithCat?.categoriaUk || '';
  }

  // Handle new subcategory (from dropdown __new__ or legacy text field)
  const isNewSubcat = subcatId === '__new__' || !!newSubcat;
  const newSubcatName = newSubcat || (subcatId === '__new__' ? document.getElementById('modal-new-subcat').value.trim() : '');

  let subcatName = '', subcatNameUk = '';
  if (isNewSubcat && newSubcatName) {
    subcatId = slugify(newSubcatName);
    subcatName = newSubcatName;
    subcatNameUk = newSubcatName;
  } else {
    const baseCat = vocabBase.categorias.find(c => c.id === catId);
    const baseSub = baseCat?.subcategorias.find(s => s.id === subcatId);
    const userSub = getUserSubcategories(catId).find(s => s.id === subcatId);
    const wordWithSub = miVocabulario.find(w => w.categoriaId === catId && w.subcategoriaId === subcatId);
    subcatName = baseSub?.nombre.es || userSub?.nombre.es || wordWithSub?.subcategoria || subcatId;
    subcatNameUk = baseSub?.nombre.uk || userSub?.nombre.uk || wordWithSub?.subcategoriaUk || '';
  }

  // Añadir etiqueta pendiente si el usuario no pulsó Enter
  const pendingModalTag = document.getElementById('modal-tag-input').value.trim().toLowerCase().replace(/[^a-záéíóúñ0-9_-]/gi, '');
  if (pendingModalTag && !modalTags.includes(pendingModalTag)) modalTags.push(pendingModalTag);
  document.getElementById('modal-tag-input').value = '';

  const desc_es = document.getElementById('modal-desc-es').value.trim();

  const word = {
    id: slugify(es),
    es,
    uk: uk || es,
    descripcion: desc,
    descripcion_es: desc_es,
    emoji: guessEmoji(es),
    imagen: selectedImageUrl,
    categoria: catName,
    categoriaUk: catNameUk,
    categoriaId: catId,
    subcategoria: subcatName,
    subcategoriaUk: subcatNameUk,
    subcategoriaId: subcatId,
    etiquetas: [...modalTags]
  };

  // Check if already exists
  if (miVocabulario.some(w => w.id === word.id)) {
    showToast('Ya existe / Вже існує');
    closeModal();
    return;
  }

  miVocabulario.push(word);
  saveMyVocab();
  saveUserCategory(catId, catName, catNameUk);
  saveUserSubcategory(catId, subcatId, subcatName, subcatNameUk);
  populateCategoryFilter();
  renderTagsBar();
  closeModal();
  showToast('Añadida / Додано ✓');

  // Re-render search to update "added" status
  const searchInput = document.getElementById('search-input');
  if (searchInput.value.trim()) {
    doSearch(searchInput.value.trim());
  }
}

// ==================== CATEGORIES VIEW ====================
function renderCategorias(filterText) {
  const container = document.getElementById('categorias-tree');
  const query = filterText !== undefined ? filterText : (document.getElementById('categorias-search')?.value || '').toLowerCase().trim();

  const catMap = new Map();
  miVocabulario.forEach(w => {
    if (query && !normalizeStr(w.es).includes(normalizeStr(query)) && !(w.uk || '').toLowerCase().includes(query)) return;
    const catKey = w.categoria || 'Sin categoría';
    if (!catMap.has(catKey)) {
      const baseCat = vocabBase.categorias.find(c => c.id === w.categoriaId);
      catMap.set(catKey, { uk: w.categoriaUk || '', emoji: baseCat?.emoji || '', subs: new Map() });
    }
    const subKey = w.subcategoria || 'General';
    if (!catMap.get(catKey).subs.has(subKey)) catMap.get(catKey).subs.set(subKey, { uk: w.subcategoriaUk || '', words: [] });
    catMap.get(catKey).subs.get(subKey).words.push(w);
  });

  if (catMap.size === 0) {
    container.innerHTML = '<div class="empty-state"><span class="empty-emoji">📂</span><p>Sin categorías / Немає категорій</p></div>';
    return;
  }

  let html = '';
  catMap.forEach((catData, catName) => {
    const totalWords = Array.from(catData.subs.values()).reduce((sum, s) => sum + s.words.length, 0);
    const catId = 'mycat-' + slugify(catName);

    let subcatHtml = '';
    catData.subs.forEach((subData, subName) => {
      subcatHtml += `<div class="explorar-subcat">
        <div class="explorar-subcat-title">
          <span style="flex:1" onclick="toggleExploreCat('${catId}-${slugify(subName)}')">${subName}${subData.uk ? ' / ' + subData.uk : ''} <span class="cat-count">${subData.words.length}</span></span>
          <button class="cat-action-btn cat-action-del" onclick="deleteSubcategoria('${catName}','${subName}')" title="Eliminar">✕</button>
        </div>
        <div class="explorar-words-grid" id="${catId}-${slugify(subName)}">
          ${subData.words.map(w => `
            <div class="explorar-word" onclick="openWordDetail('${w.id}')">
              <span class="explorar-word-emoji">${wordVisual(w, 'width:36px;height:36px;border-radius:8px;object-fit:cover')}</span>
              <div class="explorar-word-text">
                <div class="explorar-es-row"><span class="explorar-es">${w.es}</span>${speakBtns(w.es)}</div>
                <div class="explorar-uk">${w.uk}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
    });

    html += `<div class="explorar-cat">
      <div class="explorar-cat-header" onclick="toggleExploreCat('${catId}')">
        <span>${catData.emoji || '📁'} ${catName}${catData.uk ? ' / ' + catData.uk : ''}</span>
        <span class="cat-count">${totalWords}</span>
        <div class="cat-actions" onclick="event.stopPropagation()">
          <button class="cat-action-btn" onclick="openSubcatModal('${catName}')" title="Nueva subcategoría">+</button>
          <button class="cat-action-btn cat-action-del" onclick="deleteCategoria('${catName}')" title="Eliminar">✕</button>
        </div>
        <span class="explorar-toggle">▾</span>
      </div>
      <div class="explorar-cat-body" id="${catId}">${subcatHtml}</div>
    </div>`;
  });

  container.innerHTML = html;
}

function setupCategoriasSearch() {
  const input = document.getElementById('categorias-search');
  if (input) input.addEventListener('input', () => renderCategorias(input.value.toLowerCase().trim()));
}

// ==================== GESTIÓN DE CATEGORÍAS ====================
function openCatModal(mode = 'cat') {
  document.getElementById('cat-modal-title').textContent =
    mode === 'cat' ? 'Nueva categoría / Нова категорія' : 'Nueva subcategoría / Нова підкатегорія';
  document.getElementById('cat-modal-es').value = '';
  document.getElementById('cat-modal-uk').value = '';
  document.getElementById('cat-modal-mode').value = mode;
  document.getElementById('cat-modal-edit-id').value = '';

  const subcatSection = document.getElementById('cat-modal-subcat-section');
  if (mode === 'subcat') {
    subcatSection.classList.remove('hidden');
    const parentSelect = document.getElementById('cat-modal-parent');
    const cats = new Set(miVocabulario.map(w => w.categoria).filter(Boolean));
    parentSelect.innerHTML = [...cats].map(c => `<option value="${c}">${c}</option>`).join('');
  } else {
    subcatSection.classList.add('hidden');
  }

  catModalUserEdited.clear();
  document.getElementById('cat-modal').classList.remove('hidden');
  pushModalState();
}

function openSubcatModal(catName) {
  openCatModal('subcat');
  document.getElementById('cat-modal-title').textContent = `Nueva subcategoría en "${catName}" / Нова підкатегорія`;
  document.getElementById('cat-modal-parent').value = catName;
}

function closeCatModal() {
  document.getElementById('cat-modal').classList.add('hidden');
}

function saveCatModal() {
  const nameEs = document.getElementById('cat-modal-es').value.trim();
  const nameUk = document.getElementById('cat-modal-uk').value.trim();
  const mode = document.getElementById('cat-modal-mode').value;

  if (!nameEs) { showToast('Escribe un nombre / Введи назву'); return; }

  if (mode === 'cat') {
    // Guardar categoría de usuario
    saveUserCategory(slugify(nameEs), nameEs, nameUk);
    showToast('Categoría creada / Категорію створено ✓');
  } else {
    const parent = document.getElementById('cat-modal-parent').value;
    const parentWord = miVocabulario.find(w => w.categoria === parent);
    const catId = parentWord?.categoriaId || slugify(parent);
    saveUserSubcategory(catId, slugify(nameEs), nameEs, nameUk);
    showToast('Subcategoría creada / Підкатегорію створено ✓');
  }

  closeCatModal();
  renderCategorias();
  // También actualizar el modal de añadir palabra
  populateCategoryFilter();
}

function deleteCategoria(catName) {
  const count = miVocabulario.filter(w => w.categoria === catName).length;
  const msg = count > 0
    ? `¿Eliminar "${catName}"? Las ${count} palabras quedarán sin categoría.\n¿Борати "${catName}"? ${count} слів залишаться без категорії.`
    : `¿Eliminar la categoría "${catName}"?\n¿Видалити категорію "${catName}"?`;
  if (!confirm(msg)) return;

  miVocabulario.forEach(w => {
    if (w.categoria === catName) {
      w.categoria = '';
      w.categoriaUk = '';
      w.categoriaId = '';
      w.subcategoria = '';
      w.subcategoriaUk = '';
      w.subcategoriaId = '';
    }
  });
  saveMyVocab();
  renderCategorias();
  populateCategoryFilter();
  showToast('Eliminada / Видалено');
}

function deleteSubcategoria(catName, subName) {
  const count = miVocabulario.filter(w => w.categoria === catName && w.subcategoria === subName).length;
  const msg = count > 0
    ? `¿Eliminar subcategoría "${subName}"? Las ${count} palabras pasarán a "${catName}" sin subcategoría.`
    : `¿Eliminar subcategoría "${subName}"?`;
  if (!confirm(msg)) return;

  miVocabulario.forEach(w => {
    if (w.categoria === catName && w.subcategoria === subName) {
      w.subcategoria = '';
      w.subcategoriaUk = '';
      w.subcategoriaId = '';
    }
  });
  saveMyVocab();
  renderCategorias();
  showToast('Subcategoría eliminada / Підкатегорію видалено');
}

function toggleCat(catId) {
  // Toggle all subcategories within this category
  const group = event.target.closest('.cat-group');
  const subWords = group.querySelectorAll('.subcat-words');
  const allOpen = Array.from(subWords).every(s => s.classList.contains('open'));
  subWords.forEach(s => s.classList.toggle('open', !allOpen));
}

function toggleSubcat(subId) {
  document.getElementById(`subcat-${subId}`).classList.toggle('open');
}

// ==================== QUIZ ====================
function setupQuiz() {
  document.getElementById('quiz-btn').addEventListener('click', startQuiz);
  document.getElementById('quiz-close').addEventListener('click', endQuiz);
  document.getElementById('quiz-reveal').addEventListener('click', revealQuizAnswer);
  document.getElementById('quiz-prev').addEventListener('click', () => navigateQuiz(-1));
  document.getElementById('quiz-next').addEventListener('click', () => navigateQuiz(1));
}

let quizSelectedFilter = 'all';

function startQuiz() {
  const totalAvailable = miVocabulario.length + getAllBaseWords().length;
  if (totalAvailable === 0) {
    showToast('Sin palabras disponibles / Немає доступних слів');
    return;
  }
  quizSelectedFilter = 'all';
  // Mostrar pantalla de filtro
  document.getElementById('quiz-overlay').classList.remove('hidden');
  document.getElementById('quiz-filter-screen').classList.remove('hidden');
  pushModalState();
  document.getElementById('quiz-card-screen').classList.add('hidden');
  renderQuizFilterOptions();
}

function setQuizFilter(filter, el) {
  quizSelectedFilter = filter;
  document.querySelectorAll('.quiz-filter-opt').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
}

function startQuizWithFilter() {
  let words = [];
  if (quizSelectedFilter === 'base') {
    words = getAllBaseWords();
  } else if (quizSelectedFilter === 'all+base') {
    const baseIds = new Set(miVocabulario.map(w => w.id));
    const extra = getAllBaseWords().filter(b => !baseIds.has(b.id));
    words = [...miVocabulario, ...extra];
  } else {
    words = [...miVocabulario];
    if (quizSelectedFilter.startsWith('cat:')) {
      const cat = quizSelectedFilter.slice(4);
      words = words.filter(w => w.categoria === cat);
    } else if (quizSelectedFilter.startsWith('sub:')) {
      const sub = quizSelectedFilter.slice(4);
      words = words.filter(w => w.subcategoria === sub);
    } else if (quizSelectedFilter.startsWith('tag:')) {
      const tag = quizSelectedFilter.slice(4);
      words = words.filter(w => (w.etiquetas || []).includes(tag));
    } else if (quizSelectedFilter.startsWith('basecat:')) {
      const catId = quizSelectedFilter.slice(8);
      const baseIds = new Set(miVocabulario.map(w => w.id));
      const catWords = getAllBaseWords().filter(b => b.categoriaId === catId);
      const extra = catWords.filter(b => !baseIds.has(b.id));
      words = [...words.filter(w => w.categoriaId === catId), ...extra];
    }
  }

  if (words.length === 0) {
    showToast('Sin palabras en este filtro / Немає слів у цьому фільтрі');
    return;
  }

  quizWords = shuffleArray(words);
  quizIndex = 0;
  document.getElementById('quiz-filter-screen').classList.add('hidden');
  document.getElementById('quiz-card-screen').classList.remove('hidden');
  showQuizCard();
}

function endQuiz() {
  document.getElementById('quiz-overlay').classList.add('hidden');
}

function showQuizCard() {
  const word = quizWords[quizIndex];
  const imageDiv = document.getElementById('quiz-image');
  const exactEmoji = word.emoji && !GENERIC_EMOJIS.has(word.emoji);
  if (exactEmoji) {
    imageDiv.innerHTML = `<span style="font-size:80px">${word.emoji}</span>`;
  } else if (word.imagen) {
    imageDiv.innerHTML = `<img src="${word.imagen}" onerror="this.outerHTML='<span style=font-size:80px>${word.emoji || '🍽️'}</span>'">`;
  } else {
    imageDiv.innerHTML = `<span style="font-size:80px">${word.emoji || '🍽️'}</span>`;
  }
  // Mostrar ucraniano, ocultar español
  document.getElementById('quiz-question').textContent = word.uk;
  const answerDiv = document.getElementById('quiz-answer');
  const safeEs = word.es.replace(/'/g, "\\'");
  answerDiv.innerHTML = `<div class="quiz-answer-row"><span>${word.es}</span><div class="speak-btns"><button class="btn-speak" onclick="speakWord('${safeEs}',1.0)" title="Pronunciar">🔊</button><button class="btn-speak btn-speak-slow" onclick="speakWord('${safeEs}',0.25)" title="Lento">🐢</button></div></div>${word.descripcion ? `<div class="quiz-desc">${word.descripcion}</div>` : ''}`;
  answerDiv.classList.add('hidden');
  document.getElementById('quiz-reveal').style.display = 'block';
  document.getElementById('quiz-counter').textContent = `${quizIndex + 1} / ${quizWords.length}`;

  // Ocultar botón añadir hasta que se revele la respuesta
  const addBtn = document.getElementById('quiz-add-word-btn');
  if (addBtn) addBtn.remove();
}

function revealQuizAnswer() {
  document.getElementById('quiz-answer').classList.remove('hidden');
  document.getElementById('quiz-reveal').style.display = 'none';

  // Mostrar botón "+" solo al revelar la respuesta
  const word = quizWords[quizIndex];
  const isInMyVocab = miVocabulario.some(w => w.id === word.id);
  if (!isInMyVocab) {
    let addBtn = document.getElementById('quiz-add-word-btn');
    if (!addBtn) {
      addBtn = document.createElement('button');
      addBtn.id = 'quiz-add-word-btn';
      addBtn.className = 'btn btn-primary btn-block';
      addBtn.style.marginTop = '8px';
      document.getElementById('quiz-nav').before(addBtn);
    }
    addBtn.textContent = `+ Añadir "${word.es}" a mi vocabulario`;
    addBtn.onclick = () => {
      const cat = vocabBase.categorias.find(c => c.id === word.categoriaId);
      const sub = cat?.subcategorias.find(s => s.id === word.subcategoriaId);
      const wordToAdd = {
        ...word,
        categoria: word.categoria || cat?.nombre?.es || '',
        categoriaUk: word.categoriaUk || cat?.nombre?.uk || '',
        categoriaId: word.categoriaId || '',
        subcategoria: word.subcategoria || sub?.nombre?.es || '',
        subcategoriaUk: word.subcategoriaUk || sub?.nombre?.uk || '',
        subcategoriaId: word.subcategoriaId || ''
      };
      if (!miVocabulario.some(w => w.id === wordToAdd.id)) {
        miVocabulario.push(wordToAdd);
        saveMyVocab();
        populateCategoryFilter();
        renderTagsBar();
        showToast(`${word.es} añadida ✓`);
      }
      addBtn.remove();
    };
  }
}

function navigateQuiz(dir) {
  quizIndex = (quizIndex + dir + quizWords.length) % quizWords.length;
  showQuizCard();
}

// ==================== API: TRANSLATION ====================
async function translateToUkrainian(text) {
  const url = `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=es|uk`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.responseStatus === 200 && data.responseData.translatedText) {
    let translated = data.responseData.translatedText;
    // MyMemory sometimes returns uppercase
    if (translated === translated.toUpperCase() && translated.length > 3) {
      translated = capitalizeFirst(translated.toLowerCase());
    }
    return translated;
  }
  return '';
}

// ==================== API: IMAGES (Wikipedia + Wikimedia Commons) ====================
function getImageCache() {
  try {
    return JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || '{}');
  } catch (e) { return {}; }
}

function setImageCache(key, urls) {
  const cache = getImageCache();
  cache[key] = { urls, ts: Date.now() };
  localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(cache));
}

function getCachedImages(key) {
  const cache = getImageCache();
  const entry = cache[key];
  // Cache for 7 days
  if (entry && (Date.now() - entry.ts) < 7 * 24 * 60 * 60 * 1000) {
    return entry.urls;
  }
  return null;
}

async function searchImages(query) {
  const cacheKey = query.toLowerCase().trim();
  const cached = getCachedImages(cacheKey);
  if (cached) return cached;

  let images = [];

  // 1. Try Spanish Wikipedia
  try {
    const wikiImages = await fetchWikipediaImages(query, 'es');
    images.push(...wikiImages);
  } catch (e) {
    console.warn('ES Wikipedia failed:', e);
  }

  // 2. Try English Wikipedia if not enough
  if (images.length < 3) {
    try {
      const enTerm = SEARCH_TRANSLATIONS[query.toLowerCase()] || query;
      const enImages = await fetchWikipediaImages(enTerm, 'en');
      enImages.forEach(url => { if (!images.includes(url)) images.push(url); });
    } catch (e) {
      console.warn('EN Wikipedia failed:', e);
    }
  }

  // 3. Try Wikimedia Commons search
  if (images.length < 3) {
    try {
      const commonsImages = await fetchCommonsImages(query);
      commonsImages.forEach(url => { if (!images.includes(url)) images.push(url); });
    } catch (e) {
      console.warn('Commons failed:', e);
    }
  }

  images = images.slice(0, 6);
  if (images.length > 0) {
    setImageCache(cacheKey, images);
  }
  return images;
}

// Spanish to English search terms for better Wikipedia results
const SEARCH_TRANSLATIONS = {
  langostinos: 'langoustine', langostino: 'langoustine',
  camarones: 'shrimp', camaron: 'shrimp',
  bogavante: 'european lobster',
  pollo: 'chicken meat',
  chipirones: 'baby squid', chipiron: 'baby squid',
  calamares: 'squid food', calamar: 'squid',
  chocos: 'cuttlefish', choco: 'cuttlefish',
  'zamburiñas': 'queen scallop', 'zamburiña': 'queen scallop',
  vieiras: 'scallop', vieira: 'scallop',
  'cola de langostino': 'langoustine tail',
  gambas: 'prawn', gamba: 'prawn',
  berberechos: 'cockle', berberecho: 'cockle',
  navajas: 'razor clam', navaja: 'razor clam',
  almejas: 'clam', almeja: 'clam',
  ternera: 'beef', cerdo: 'pork', cordero: 'lamb',
  salmon: 'salmon', atun: 'tuna', merluza: 'hake',
  pulpo: 'octopus', mejillones: 'mussel'
};

async function fetchWikipediaImages(term, lang) {
  // Use Wikipedia API to search for images
  const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(term)}&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=400&format=json&origin=*`;
  const res = await fetch(searchUrl);
  const data = await res.json();
  const images = [];
  if (data.query && data.query.pages) {
    Object.values(data.query.pages).forEach(page => {
      if (page.thumbnail && page.thumbnail.source) {
        images.push(page.thumbnail.source);
      }
    });
  }
  return images;
}

async function fetchCommonsImages(term) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(term + ' food')}&gsrlimit=4&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  const images = [];
  if (data.query && data.query.pages) {
    Object.values(data.query.pages).forEach(page => {
      if (page.imageinfo && page.imageinfo[0]) {
        const url = page.imageinfo[0].thumburl || page.imageinfo[0].url;
        if (url && !url.endsWith('.svg')) {
          images.push(url);
        }
      }
    });
  }
  return images;
}

// Fetch and assign real images to vocabulary on load
async function enrichVocabWithImages() {
  let changed = false;
  for (const word of miVocabulario) {
    if (!word.imagen) {
      const images = await searchImages(word.es);
      if (images.length > 0) {
        word.imagen = images[0];
        changed = true;
      }
    }
  }
  if (changed) {
    saveMyVocab();
    renderMyVocab();
  }
}

// ==================== USER CATEGORIES (localStorage) ====================
function getUserCategories() {
  const saved = localStorage.getItem('user_categories');
  return saved ? JSON.parse(saved) : [];
}

function saveUserCategory(id, nameEs, nameUk) {
  if (!id) return;
  const cats = getUserCategories();
  if (!cats.find(c => c.id === id)) {
    cats.push({ id, nombre: { es: nameEs, uk: nameUk || nameEs } });
    localStorage.setItem('user_categories', JSON.stringify(cats));
  }
}

function getUserSubcategories(catId) {
  const saved = localStorage.getItem('user_subcategories');
  const all = saved ? JSON.parse(saved) : [];
  return catId ? all.filter(s => s.catId === catId) : all;
}

function saveUserSubcategory(catId, subId, nameEs, nameUk) {
  if (!catId || !subId) return;
  const subs = getUserSubcategories(null);
  if (!subs.find(s => s.id === subId && s.catId === catId)) {
    subs.push({ catId, id: subId, nombre: { es: nameEs, uk: nameUk || nameEs } });
    localStorage.setItem('user_subcategories', JSON.stringify(subs));
  }
}

// ==================== UTILITIES ====================
function slugify(text) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// Mapa interno de fallback (palabras específicas de alimentos/mariscos no siempre en emoji-es.json)
const EMOJI_FALLBACK_MAP = {
  langostino: '🦐', langostinos: '🦐', gamba: '🦐', gambas: '🦐',
  camaron: '🦐', camarones: '🦐', 'cola de langostino': '🦐',
  bogavante: '🦞', langosta: '🦞', cangrejo: '🦀',
  pollo: '🍗', pavo: '🦃', cerdo: '🥩', ternera: '🥩', carne: '🥩',
  cordero: '🥩', jamon: '🥓', chorizo: '🌭',
  chipirón: '🦑', chipirones: '🦑', calamar: '🦑', calamares: '🦑',
  choco: '🦑', chocos: '🦑', sepia: '🦑', pulpo: '🐙',
  zamburiña: '🐚', zamburiñas: '🐚', vieira: '🐚', vieiras: '🐚',
  berberecho: '🐚', berberechos: '🐚', almeja: '🐚', almejas: '🐚',
  navaja: '🪦', navajas: '🪦', mejillon: '🐚', mejillones: '🐚',
  pescado: '🐟', salmon: '🐟', atun: '🐟', merluza: '🐟',
  sardina: '🐟', bacalao: '🐟', lubina: '🐟', dorada: '🐟',
  pan: '🍞', arroz: '🍚', pasta: '🍝', patata: '🥔',
  tomate: '🍅', lechuga: '🥬', cebolla: '🧅', ajo: '🧄',
  zanahoria: '🥕', pimiento: '🫑', limon: '🍋', naranja: '🍊',
  manzana: '🍎', platano: '🍌', fresa: '🍓', uva: '🍇',
  queso: '🧀', huevo: '🥚', leche: '🥛', mantequilla: '🧈',
  aceite: '🫒', sal: '🧂', azucar: '🍬', agua: '💧',
  vino: '🍷', cerveza: '🍺', cafe: '☕', te: '🍵',
  sopa: '🍲', ensalada: '🥗', pizza: '🍕', hamburguesa: '🍔',
  helado: '🍦', pastel: '🎂', chocolate: '🍫', galleta: '🍪'
};

function normalizeEmojiKey(word) {
  return word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function guessEmoji(word) {
  const key = normalizeEmojiKey(word);
  // 1. Buscar en emoji-es.json (externo, ~600 palabras)
  if (emojiMapExternal[key]) return emojiMapExternal[key];
  // 2. Buscar por primera palabra (ej: "pollo asado" → "pollo")
  const firstWord = key.split(/\s+/)[0];
  if (firstWord !== key && emojiMapExternal[firstWord]) return emojiMapExternal[firstWord];
  // 3. Fallback al mapa interno
  return EMOJI_FALLBACK_MAP[key] || EMOJI_FALLBACK_MAP[word.toLowerCase()] || '🍽️';
}

// ==================== ETIQUETAS ====================
function getAllTags() {
  const tags = new Set();
  miVocabulario.forEach(w => (w.etiquetas || []).forEach(t => tags.add(t)));
  return [...tags].sort();
}

function renderTagsBar() {
  const bar = document.getElementById('tags-bar');
  const allTags = getAllTags();
  if (allTags.length === 0) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = `
    <button class="tag-filter all-tag ${!activeTagFilter ? 'active' : ''}" onclick="setTagFilter('')">
      Todas / Усі
    </button>
    ${allTags.map(t => `
      <button class="tag-filter ${activeTagFilter === t ? 'active' : ''}" onclick="setTagFilter('${t}')">
        #${t}
      </button>
    `).join('')}
  `;
}

function setTagFilter(tag) {
  activeTagFilter = tag;
  renderTagsBar();
  renderMyVocab();
}

function setupTagsInput() {
  const input = document.getElementById('modal-tag-input');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().toLowerCase().replace(/[^a-záéíóúñ0-9_-]/gi, '');
      if (val && !modalTags.includes(val)) {
        modalTags.push(val);
        renderModalTags();
      }
      input.value = '';
    }
  });
}

function renderModalTags() {
  const list = document.getElementById('modal-tags-list');
  list.innerHTML = modalTags.map(t => `
    <span class="tag-chip">
      #${t}
      <button class="tag-chip-remove" onclick="removeModalTag('${t}')">×</button>
    </span>
  `).join('');
}

function removeModalTag(tag) {
  modalTags = modalTags.filter(t => t !== tag);
  renderModalTags();
}

// ==================== IMAGE PICKER ====================
async function openImagePicker(wordId) {
  const word = miVocabulario.find(w => w.id === wordId);
  if (!word) return;

  // Mostrar modal de carga
  const modal = document.getElementById('image-picker-modal');
  const grid = document.getElementById('image-picker-grid');
  const title = document.getElementById('image-picker-title');
  title.textContent = word.es;
  grid.innerHTML = '<div class="loading"><div class="spinner"></div>Buscando imágenes...</div>';
  modal.classList.remove('hidden');
  document.getElementById('image-picker-wordid').value = wordId;
  switchPickerTab('img'); // siempre empezar en pestaña imagen

  // Obtener imágenes: primero caché, luego Wikipedia
  let images = getCachedImages(word.es.toLowerCase()) || [];
  if (images.length < 3) {
    try {
      const fresh = await searchImages(word.es);
      images = fresh;
    } catch (e) { /* silencioso */ }
  }

  renderPickerGrid(wordId, images, word.imagen);
}

let pickerImages = []; // imágenes actualmente visibles en el picker

function renderPickerGrid(wordId, images, selectedUrl) {
  pickerImages = [...images];
  const grid = document.getElementById('image-picker-grid');
  if (pickerImages.length === 0) {
    grid.innerHTML = '<p style="text-align:center;color:#64748b;padding:20px">No se encontraron imágenes / Зображень не знайдено</p>';
    return;
  }
  grid.innerHTML = pickerImages.map(url => `
    <div class="picker-img-wrap ${selectedUrl === url ? 'selected' : ''}" data-url="${url}">
      <img src="${url}" alt="" onerror="this.parentElement.style.display='none'" onclick="selectPickerImage('${wordId}', '${url}', this.parentElement)">
      ${selectedUrl === url ? '<div class="picker-check">✓</div>' : ''}
      <button class="picker-discard" onclick="discardPickerImage('${wordId}', '${url}')" title="Descartar / Відхилити">✕</button>
    </div>
  `).join('');
}

function discardPickerImage(wordId, url) {
  pickerImages = pickerImages.filter(u => u !== url);
  const word = miVocabulario.find(w => w.id === wordId);
  // Si la imagen descartada era la seleccionada, limpiarla
  if (word && word.imagen === url) {
    word.imagen = pickerImages[0] || '';
    saveMyVocab();
  }
  renderPickerGrid(wordId, pickerImages, word?.imagen || '');
}

function selectPickerImage(wordId, url, el) {
  document.querySelectorAll('.picker-img-wrap').forEach(w => {
    w.classList.remove('selected');
    w.querySelector('.picker-check')?.remove();
  });
  el.classList.add('selected');
  el.insertAdjacentHTML('beforeend', '<div class="picker-check">✓</div>');

  const word = miVocabulario.find(w => w.id === wordId);
  if (word) {
    word.imagen = url;
    saveMyVocab();
  }
}

function closeImagePicker() {
  document.getElementById('image-picker-modal').classList.add('hidden');
  renderMyVocab();
  renderCategorias();
  // Actualizar miniatura en el modal de detalle si está abierto
  const wordId = document.getElementById('image-picker-wordid').value;
  if (wordId && !document.getElementById('word-detail-modal').classList.contains('hidden')) {
    const word = miVocabulario.find(w => w.id === wordId);
    if (word) {
      const imgDiv = document.getElementById('detail-image');
      imgDiv.innerHTML = word.imagen
        ? `<img src="${word.imagen}" alt="${word.es}" style="width:100%;height:100%;object-fit:cover;border-radius:12px" onerror="this.parentElement.innerHTML='<span class=detail-no-img>📷</span>'">`
        : `<span class="detail-no-img">📷</span>`;
    }
  }
}

function switchPickerTab(tab) {
  const isImg = tab === 'img';
  document.getElementById('picker-tab-img').classList.toggle('active', isImg);
  document.getElementById('picker-tab-emoji').classList.toggle('active', !isImg);
  document.getElementById('picker-panel-img').classList.toggle('hidden', !isImg);
  document.getElementById('picker-panel-emoji').classList.toggle('hidden', isImg);
  if (!isImg) renderEmojiSuggestions();
}

function renderEmojiSuggestions() {
  const wordId = document.getElementById('image-picker-wordid').value;
  const word = miVocabulario.find(w => w.id === wordId);
  if (!word) return;

  const grid = document.getElementById('emoji-picker-suggestions');
  const key = normalizeEmojiKey(word.es);
  const firstWord = key.split(/\s+/)[0];

  // Recoger candidatos: exacto + similares del mapa externo
  const candidates = new Set();
  if (word.emoji && !GENERIC_EMOJIS.has(word.emoji)) candidates.add(word.emoji);
  if (emojiMapExternal[key]) candidates.add(emojiMapExternal[key]);
  if (emojiMapExternal[firstWord]) candidates.add(emojiMapExternal[firstWord]);

  // Añadir emojis de palabras similares (misma primera letra)
  Object.entries(emojiMapExternal).forEach(([k, v]) => {
    if (candidates.size >= 25) return;
    if (k.startsWith(firstWord[0])) candidates.add(v);
  });

  // Emojis comunes de fallback si hay pocos
  const extras = ['😊','🏠','🚗','🍎','👕','💡','⭐','🎯','🌟','🔑','📱','🎵','🏋️','🌸','🦋'];
  extras.forEach(e => { if (candidates.size < 20) candidates.add(e); });

  const currentEmoji = word.emoji;
  grid.innerHTML = [...candidates].map(e => `
    <button class="emoji-picker-btn ${e === currentEmoji ? 'selected' : ''}"
      onclick="selectPickerEmoji('${wordId}', '${e}', this)"
      title="${e}">${e}</button>
  `).join('');
}

function selectPickerEmoji(wordId, emoji, btn) {
  document.querySelectorAll('.emoji-picker-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('emoji-picker-input').value = emoji;

  const word = miVocabulario.find(w => w.id === wordId);
  if (word) {
    word.emoji = emoji;
    saveMyVocab();
  }
}

function applyEmojiFromInput() {
  const wordId = document.getElementById('image-picker-wordid').value;
  const emoji = document.getElementById('emoji-picker-input').value.trim();
  if (!emoji) return;
  const word = miVocabulario.find(w => w.id === wordId);
  if (word) {
    word.emoji = emoji;
    saveMyVocab();
    showToast('Emoji guardado ✓');
    renderEmojiSuggestions();
  }
}

function setupImagePicker() {
  document.getElementById('image-picker-close').addEventListener('click', closeImagePicker);
  document.getElementById('image-picker-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('image-picker-modal')) closeImagePicker();
  });

  const searchBtn = document.getElementById('image-picker-search-btn');
  const searchInput = document.getElementById('image-picker-query');

  const doPickerSearch = async () => {
    const query = searchInput.value.trim();
    if (!query) return;
    const wordId = document.getElementById('image-picker-wordid').value;
    const word = miVocabulario.find(w => w.id === wordId);
    const grid = document.getElementById('image-picker-grid');
    grid.innerHTML = '<div class="loading"><div class="spinner"></div>Buscando / Шукаю...</div>';
    // Buscar sin usar la caché, para obtener resultados frescos
    let images = [];
    try {
      const [esImgs, enImgs, commonsImgs] = await Promise.all([
        fetchWikipediaImages(query, 'es'),
        fetchWikipediaImages(query, 'en'),
        fetchCommonsImages(query)
      ]);
      const seen = new Set();
      [...esImgs, ...enImgs, ...commonsImgs].forEach(url => {
        if (!seen.has(url)) { seen.add(url); images.push(url); }
      });
      images = images.slice(0, 12);
    } catch (e) { /* silencioso */ }
    renderPickerGrid(wordId, images, word?.imagen || '');
  };

  searchBtn.addEventListener('click', doPickerSearch);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doPickerSearch();
  });
}

// ==================== PWA INSTALL (Chrome nativo) ====================
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Mostrar botón de instalar en el header
  const btn = document.getElementById('btn-install');
  if (btn) btn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('btn-install');
  if (btn) btn.classList.add('hidden');
  deferredInstallPrompt = null;
});

async function triggerInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    document.getElementById('btn-install')?.classList.add('hidden');
    deferredInstallPrompt = null;
  }
}

function checkIosInstallHint() {
  // En iOS no existe beforeinstallprompt, no hacemos nada
  // El usuario puede instalar manualmente con Compartir → Añadir a inicio
}

// ==================== PHOTO FROM CAMERA/GALLERY ====================
let cameraContext = null; // { type: 'picker' } | { type: 'search-card', wordId }

function setupCameraInput() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.id = 'camera-input';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      if (cameraContext?.type === 'search-card') {
        setCardCustomImage(cameraContext.wordId, dataUrl);
        showToast('Foto seleccionada / Фото обрано ✓');
      } else {
        const wordId = document.getElementById('image-picker-wordid').value;
        const word = miVocabulario.find(w => w.id === wordId);
        if (word) {
          word.imagen = dataUrl;
          saveMyVocab();
        }
        closeImagePicker();
        showToast('Foto guardada / Фото збережено ✓');
      }
      cameraContext = null;
    };
    reader.readAsDataURL(file);
    input.value = '';
  });
}

function openCameraInput() {
  cameraContext = null;
  document.getElementById('camera-input').click();
}

function openCameraForSearchCard(wordId) {
  cameraContext = { type: 'search-card', wordId };
  document.getElementById('camera-input').click();
}

function setCardCustomImage(wordId, imageUrl) {
  const word = searchResultData.get(wordId);
  if (word) searchResultData.set(wordId, { ...word });

  const card = document.querySelector(`.search-result-card[data-word-id="${wordId}"]`);
  if (!card) return;
  let imgRow = card.querySelector('.result-images');
  if (!imgRow) {
    imgRow = document.createElement('div');
    imgRow.className = 'result-images';
    card.insertBefore(imgRow, card.firstChild);
  }
  imgRow.querySelectorAll('.result-img').forEach(i => i.classList.remove('selected'));
  const existing = imgRow.querySelector('.result-img-custom');
  if (existing) {
    existing.src = imageUrl;
    existing.classList.add('selected');
  } else {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'result-img result-img-custom selected';
    img.alt = '';
    img.onclick = () => selectResultImage(img, wordId);
    imgRow.prepend(img);
  }
}

async function searchMoreImagesForCard(wordId) {
  const card = document.querySelector(`.search-result-card[data-word-id="${wordId}"]`);
  if (!card) return;
  const input = card.querySelector('.card-img-search-input');
  const query = input?.value?.trim() || '';
  if (!query) return;

  const btn = card.querySelector('.card-img-search-btn');
  if (btn) btn.textContent = '⏳';

  const newImages = await searchImages(query);

  const word = searchResultData.get(wordId);
  if (word) searchResultData.set(wordId, { ...word, _images: newImages });

  let imgRow = card.querySelector('.result-images');
  if (!imgRow) {
    imgRow = document.createElement('div');
    imgRow.className = 'result-images';
    card.insertBefore(imgRow, card.firstChild);
  }
  if (newImages.length > 0) {
    imgRow.innerHTML = newImages.map((url, i) =>
      `<img src="${url}" class="result-img${i === 0 ? ' selected' : ''}" onclick="selectResultImage(this, '${wordId}')" alt="">`
    ).join('');
  } else {
    imgRow.innerHTML = '<span style="color:#94a3b8;font-size:13px;padding:8px">Sin resultados / Немає результатів</span>';
  }

  if (btn) btn.textContent = '🔍';
}

// ==================== WORD DETAIL MODAL ====================
let detailTags = [];
let detailWordId = '';

function openWordDetail(wordId) {
  const word = miVocabulario.find(w => w.id === wordId);
  if (!word) return;
  detailWordId = wordId;

  document.getElementById('detail-word-id').value = wordId;
  document.getElementById('detail-es').value = word.es;
  document.getElementById('detail-uk').value = word.uk || '';
  document.getElementById('detail-desc-es').value = word.descripcion_es || '';
  document.getElementById('detail-desc-uk').value = word.descripcion || '';

  const imgDiv = document.getElementById('detail-image');
  imgDiv.innerHTML = word.imagen
    ? `<img src="${word.imagen}" alt="${word.es}" style="width:100%;height:100%;object-fit:cover;border-radius:12px" onerror="this.parentElement.innerHTML='<span class=detail-no-img>📷</span>'">`
    : `<span class="detail-no-img">📷</span>`;

  // Poblar select de categoría
  const detailCatSelect = document.getElementById('detail-cat');
  detailCatSelect.innerHTML = '<option value="">Seleccionar / Обрати...</option>';
  const allCatsMap = new Map();
  vocabBase.categorias.forEach(c => allCatsMap.set(c.id, { id: c.id, es: c.nombre.es, uk: c.nombre.uk, emoji: c.emoji || '' }));
  getUserCategories().forEach(c => { if (!allCatsMap.has(c.id)) allCatsMap.set(c.id, { id: c.id, es: c.nombre.es, uk: c.nombre.uk || '', emoji: '' }); });
  miVocabulario.forEach(w => { if (w.categoriaId && !allCatsMap.has(w.categoriaId)) allCatsMap.set(w.categoriaId, { id: w.categoriaId, es: w.categoria || w.categoriaId, uk: w.categoriaUk || '', emoji: '' }); });
  allCatsMap.forEach(c => { detailCatSelect.innerHTML += `<option value="${c.id}">${c.emoji ? c.emoji + ' ' : ''}${c.es}${c.uk ? ' / ' + c.uk : ''}</option>`; });
  detailCatSelect.innerHTML += `<option value="__new__">+ Nueva categoría / Нова категорія</option>`;
  if (word.categoriaId) detailCatSelect.value = word.categoriaId;
  document.getElementById('detail-new-cat-group').classList.add('hidden');
  document.getElementById('detail-new-subcat-group').classList.add('hidden');
  updateDetailSubcatOptions(word.subcategoriaId);

  detailTags = word.etiquetas ? [...word.etiquetas] : [];
  renderDetailTags();

  detailUserEdited.clear();
  document.getElementById('word-detail-modal').classList.remove('hidden');
  pushModalState();
}

function renderDetailTags() {
  const list = document.getElementById('detail-tags-list');
  list.innerHTML = detailTags.map(t => `
    <span class="tag-chip">
      #${t}
      <button class="tag-chip-remove" onclick="removeDetailTag('${t}')">×</button>
    </span>
  `).join('');
}

function removeDetailTag(tag) {
  detailTags = detailTags.filter(t => t !== tag);
  renderDetailTags();
}

function updateDetailSubcatOptions(preselectedId) {
  const catId = document.getElementById('detail-cat').value;
  const subcatSelect = document.getElementById('detail-subcat');
  subcatSelect.innerHTML = '<option value="">Seleccionar / Обрати...</option>';
  const allSubsMap = new Map();
  const baseCat = vocabBase.categorias.find(c => c.id === catId);
  if (baseCat) baseCat.subcategorias.forEach(s => allSubsMap.set(s.id, { id: s.id, es: s.nombre.es, uk: s.nombre.uk, emoji: s.emoji || '' }));
  getUserSubcategories(catId).forEach(s => { if (!allSubsMap.has(s.id)) allSubsMap.set(s.id, { id: s.id, es: s.nombre.es, uk: s.nombre.uk || '', emoji: '' }); });
  miVocabulario.filter(w => w.categoriaId === catId && w.subcategoriaId).forEach(w => { if (!allSubsMap.has(w.subcategoriaId)) allSubsMap.set(w.subcategoriaId, { id: w.subcategoriaId, es: w.subcategoria || w.subcategoriaId, uk: w.subcategoriaUk || '', emoji: '' }); });
  allSubsMap.forEach(s => { subcatSelect.innerHTML += `<option value="${s.id}">${s.emoji ? s.emoji + ' ' : ''}${s.es}${s.uk ? ' / ' + s.uk : ''}</option>`; });
  subcatSelect.innerHTML += `<option value="__new__">+ Nueva subcategoría / Нова підкатегорія</option>`;
  if (preselectedId) subcatSelect.value = preselectedId;
  document.getElementById('detail-new-subcat-group').classList.add('hidden');
}

function setupDetailCatSelects() {
  document.getElementById('detail-cat').addEventListener('change', () => {
    const isNew = document.getElementById('detail-cat').value === '__new__';
    document.getElementById('detail-new-cat-group').classList.toggle('hidden', !isNew);
    if (isNew) { document.getElementById('detail-new-cat').value = ''; document.getElementById('detail-new-cat').focus(); }
    updateDetailSubcatOptions(null);
  });
  document.getElementById('detail-subcat').addEventListener('change', () => {
    const isNew = document.getElementById('detail-subcat').value === '__new__';
    document.getElementById('detail-new-subcat-group').classList.toggle('hidden', !isNew);
    if (isNew) { document.getElementById('detail-new-subcat').value = ''; document.getElementById('detail-new-subcat').focus(); }
  });
}

function setupDetailTagsInput() {
  const input = document.getElementById('detail-tag-input');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().toLowerCase().replace(/[^a-záéíóúñ0-9_-]/gi, '');
      if (val && !detailTags.includes(val)) {
        detailTags.push(val);
        renderDetailTags();
      }
      input.value = '';
    }
  });
}

function saveAndCloseDetail() {
  const word = miVocabulario.find(w => w.id === detailWordId);
  if (word) {
    // Campos editables
    word.es = document.getElementById('detail-es').value.trim() || word.es;
    word.uk = document.getElementById('detail-uk').value.trim();
    word.descripcion_es = document.getElementById('detail-desc-es').value.trim();
    word.descripcion = document.getElementById('detail-desc-uk').value.trim();

    // Añadir etiqueta pendiente en el input (si el usuario no pulsó Enter)
    const pendingTag = document.getElementById('detail-tag-input').value.trim().toLowerCase().replace(/[^a-záéíóúñ0-9_-]/gi, '');
    if (pendingTag && !detailTags.includes(pendingTag)) detailTags.push(pendingTag);
    document.getElementById('detail-tag-input').value = '';

    word.etiquetas = [...detailTags];

    // Guardar categoría
    let catId = document.getElementById('detail-cat').value;
    const newCatName = catId === '__new__' ? document.getElementById('detail-new-cat').value.trim() : '';
    if (newCatName) catId = slugify(newCatName);

    let subcatId = document.getElementById('detail-subcat').value;
    const newSubcatName = subcatId === '__new__' ? document.getElementById('detail-new-subcat').value.trim() : '';
    if (newSubcatName) subcatId = slugify(newSubcatName);

    if (catId && catId !== '__new__') {
      const allCatsMap = new Map();
      vocabBase.categorias.forEach(c => allCatsMap.set(c.id, c));
      getUserCategories().forEach(c => { if (!allCatsMap.has(c.id)) allCatsMap.set(c.id, { id: c.id, nombre: { es: c.nombre.es, uk: c.nombre.uk || '' } }); });
      miVocabulario.forEach(w => { if (w.categoriaId && !allCatsMap.has(w.categoriaId)) allCatsMap.set(w.categoriaId, { id: w.categoriaId, nombre: { es: w.categoria || w.categoriaId, uk: w.categoriaUk || '' } }); });
      const cat = allCatsMap.get(catId);
      word.categoriaId = catId;
      word.categoria = newCatName || cat?.nombre?.es || catId;
      word.categoriaUk = cat?.nombre?.uk || '';
      if (newCatName) saveUserCategory(catId, newCatName, newCatName);
    }

    if (subcatId && subcatId !== '__new__') {
      const allSubsMap = new Map();
      const baseCat = vocabBase.categorias.find(c => c.id === catId);
      if (baseCat) baseCat.subcategorias.forEach(s => allSubsMap.set(s.id, s));
      getUserSubcategories(catId).forEach(s => { if (!allSubsMap.has(s.id)) allSubsMap.set(s.id, s); });
      miVocabulario.filter(w => w.categoriaId === catId && w.subcategoriaId).forEach(w => { if (!allSubsMap.has(w.subcategoriaId)) allSubsMap.set(w.subcategoriaId, { id: w.subcategoriaId, nombre: { es: w.subcategoria || w.subcategoriaId, uk: w.subcategoriaUk || '' } }); });
      const sub = allSubsMap.get(subcatId);
      word.subcategoriaId = subcatId;
      word.subcategoria = newSubcatName || sub?.nombre?.es || subcatId;
      word.subcategoriaUk = sub?.nombre?.uk || '';
      if (newSubcatName) saveUserSubcategory(catId, subcatId, newSubcatName, newSubcatName);
    } else if (!subcatId || subcatId === '__new__') {
      word.subcategoriaId = '';
      word.subcategoria = '';
      word.subcategoriaUk = '';
    }

    saveMyVocab();
    populateCategoryFilter();
    renderTagsBar();
    renderMyVocab();
    renderEtiquetas();
  }
  document.getElementById('word-detail-modal').classList.add('hidden');
}

function deleteWordFromDetail() {
  const word = miVocabulario.find(w => w.id === detailWordId);
  if (!word) return;
  if (!confirm(`¿Eliminar "${word.es}"?\nВидалити "${word.uk}"?`)) return;
  miVocabulario = miVocabulario.filter(w => w.id !== detailWordId);
  saveMyVocab();
  populateCategoryFilter();
  renderTagsBar();
  renderMyVocab();
  renderEtiquetas();
  document.getElementById('word-detail-modal').classList.add('hidden');
  showToast('Eliminada / Видалено');
}

// ==================== ETIQUETAS VIEW ====================
function renderEtiquetas() {
  const grid = document.getElementById('etiquetas-grid');
  const empty = document.getElementById('etiquetas-empty');
  if (!grid) return;
  const tags = getAllTags();

  if (tags.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.innerHTML = tags.map(tag => {
    const count = miVocabulario.filter(w => (w.etiquetas || []).includes(tag)).length;
    return `
      <div class="etiqueta-card" onclick="goToTagFilter('${tag}')">
        <span class="etiqueta-name">#${tag}</span>
        <span class="etiqueta-count">${count} ${count === 1 ? 'palabra / слово' : 'palabras / слів'}</span>
      </div>
    `;
  }).join('');
}

function goToTagFilter(tag) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector('[data-view="vocabulario"]').classList.add('active');
  document.getElementById('view-vocabulario').classList.add('active');
  setTagFilter(tag);
}

// ==================== EXPLORAR BASE DE DATOS ====================
function renderExploreDatabase(filterText) {
  const container = document.getElementById('explorar-tree');
  if (!container) return;
  const query = filterText !== undefined ? filterText : (document.getElementById('explorar-search')?.value || '').toLowerCase().trim();

  let html = '';
  let visibleCount = 0;

  vocabBase.categorias.forEach(cat => {
    let catHtml = '';
    let catCount = 0;

    cat.subcategorias.forEach(sub => {
      const filtered = sub.palabras.filter(p =>
        !query ||
        normalizeStr(p.es).includes(normalizeStr(query)) ||
        (p.uk || '').toLowerCase().includes(query)
      );
      if (filtered.length === 0) return;
      catCount += filtered.length;
      visibleCount += filtered.length;

      catHtml += `<div class="explorar-subcat">
        <div class="explorar-subcat-title">${sub.emoji || ''} ${sub.nombre.es} / ${sub.nombre.uk}
          <span class="cat-count">${filtered.length}</span>
        </div>
        <div class="explorar-words-grid">
          ${filtered.map(p => {
            const added = miVocabulario.some(w => w.id === p.id);
            return `<div class="explorar-word ${added ? 'explorar-word-added' : ''}">
              <span class="explorar-word-emoji">${p.emoji || '📖'}</span>
              <div class="explorar-word-text">
                <div class="explorar-es-row"><span class="explorar-es">${p.es}</span>${speakBtns(p.es)}</div>
                <div class="explorar-uk">${p.uk}</div>
              </div>
              <div class="explorar-word-actions">
                <button class="btn-edit-suggestion" onclick="openCorrectionModal('${p.id}','${cat.id}','${sub.id}')" title="Sugerir corrección / Запропонувати виправлення">✏️</button>
                ${added
                  ? '<span class="explorar-badge">✓</span>'
                  : `<button class="btn explorar-add-btn" onclick="importBaseWord('${cat.id}','${sub.id}','${p.id}',this)">+</button>`
                }
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    });

    if (catHtml) {
      const catId = `explorar-cat-${cat.id}`;
      html += `<div class="explorar-cat">
        <div class="explorar-cat-header" onclick="toggleExploreCat('${catId}')">
          <span>${cat.emoji || ''} ${cat.nombre.es} / ${cat.nombre.uk}</span>
          <span class="cat-count">${catCount}</span>
          <span class="explorar-toggle">▾</span>
        </div>
        <div class="explorar-cat-body" id="${catId}">${catHtml}</div>
      </div>`;
    }
  });

  container.innerHTML = html || '<div class="empty-state"><span class="empty-emoji">🔍</span><p>Sin resultados / Немає результатів</p></div>';

  // Update import all button
  const btn = document.getElementById('explorar-import-all-btn');
  if (btn) btn.textContent = `+ Importar visibles (${visibleCount})`;
}

function toggleExploreCat(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('open');
  const header = el.previousElementSibling;
  const toggle = header?.querySelector('.explorar-toggle');
  if (toggle) toggle.textContent = el.classList.contains('open') ? '▴' : '▾';
}

function importBaseWord(catId, subId, wordId, btnEl) {
  if (miVocabulario.some(w => w.id === wordId)) return;
  const cat = vocabBase.categorias.find(c => c.id === catId);
  const sub = cat?.subcategorias.find(s => s.id === subId);
  const p = sub?.palabras.find(w => w.id === wordId);
  if (!p) return;

  const word = {
    ...p,
    categoria: cat.nombre.es,
    categoriaUk: cat.nombre.uk,
    categoriaId: cat.id,
    subcategoria: sub.nombre.es,
    subcategoriaUk: sub.nombre.uk,
    subcategoriaId: sub.id
  };

  miVocabulario.push(word);
  saveMyVocab();
  populateCategoryFilter();
  renderTagsBar();

  // Update button in place
  const cell = btnEl.closest('.explorar-word');
  if (cell) {
    cell.classList.add('explorar-word-added');
    btnEl.outerHTML = '<span class="explorar-badge">✓</span>';
  }
  showToast(`${p.es} añadida ✓`);
}

function importAllVisible() {
  const query = (document.getElementById('explorar-search')?.value || '').toLowerCase().trim();
  let count = 0;
  vocabBase.categorias.forEach(cat => {
    cat.subcategorias.forEach(sub => {
      sub.palabras.forEach(p => {
        if (miVocabulario.some(w => w.id === p.id)) return;
        if (query && !normalizeStr(p.es).includes(normalizeStr(query)) && !(p.uk || '').toLowerCase().includes(query)) return;
        miVocabulario.push({
          ...p,
          categoria: cat.nombre.es,
          categoriaUk: cat.nombre.uk,
          categoriaId: cat.id,
          subcategoria: sub.nombre.es,
          subcategoriaUk: sub.nombre.uk,
          subcategoriaId: sub.id
        });
        count++;
      });
    });
  });
  if (count > 0) {
    saveMyVocab();
    populateCategoryFilter();
    renderTagsBar();
    renderExploreDatabase();
    showToast(`${count} palabras importadas ✓`);
  } else {
    showToast('Ya estaban todas añadidas / Всі вже додані');
  }
}

function setupExploreSearch() {
  const input = document.getElementById('explorar-search');
  if (input) {
    input.addEventListener('input', () => renderExploreDatabase(input.value.toLowerCase().trim()));
  }
}

// ==================== SUGERENCIAS DE CORRECCIÓN ====================

function openCorrectionModal(wordId, catId, subId) {
  const cat = vocabBase.categorias.find(c => c.id === catId);
  const sub = cat?.subcategorias.find(s => s.id === subId);
  const p = sub?.palabras.find(w => w.id === wordId);
  if (!p) return;

  document.getElementById('corr-word-id').value = wordId;
  document.getElementById('corr-cat-id').value = catId;
  document.getElementById('corr-sub-id').value = subId;
  document.getElementById('corr-es').value = p.es;
  document.getElementById('corr-uk').value = p.uk;
  document.getElementById('corr-desc-es').value = p.descripcion_es || '';
  document.getElementById('corr-desc-uk').value = p.descripcion || '';
  document.getElementById('corr-imagen').value = p.imagen || '';
  document.getElementById('corr-comment').value = '';

  document.getElementById('correction-modal').classList.remove('hidden');
  pushModalState();
}

function closeCorrectionModal() {
  document.getElementById('correction-modal').classList.add('hidden');
}

async function submitCorrectionModal() {
  const wordId = document.getElementById('corr-word-id').value;
  const catId = document.getElementById('corr-cat-id').value;
  const subId = document.getElementById('corr-sub-id').value;

  const cat = vocabBase.categorias.find(c => c.id === catId);
  const sub = cat?.subcategorias.find(s => s.id === subId);
  const original = sub?.palabras.find(w => w.id === wordId);

  const suggestion = {
    wordId,
    catId,
    subId,
    original: {
      es: original?.es || '',
      uk: original?.uk || '',
      descripcion_es: original?.descripcion_es || '',
      descripcion: original?.descripcion || '',
      imagen: original?.imagen || ''
    },
    suggested: {
      es: document.getElementById('corr-es').value.trim(),
      uk: document.getElementById('corr-uk').value.trim(),
      descripcion_es: document.getElementById('corr-desc-es').value.trim(),
      descripcion: document.getElementById('corr-desc-uk').value.trim(),
      imagen: document.getElementById('corr-imagen').value.trim()
    },
    comment: document.getElementById('corr-comment').value.trim()
  };

  const btn = document.querySelector('#correction-modal .btn-primary');
  btn.disabled = true;
  btn.textContent = 'Enviando... / Надсилається...';

  const ok = await submitSuggestion(suggestion);

  btn.disabled = false;
  btn.textContent = 'Enviar / Надіслати';
  closeCorrectionModal();

  if (ok) {
    showToast('¡Gracias por tu sugerencia! 🙏 / Дякуємо за пропозицію!');
  } else {
    showToast('Error al enviar. Inténtalo de nuevo.');
  }
}

// ==================== QUIZ CON BASE DE DATOS ====================
// Extiende el quiz para incluir palabras de la base que el usuario NO tiene
function renderQuizFilterOptions() {
  const container = document.getElementById('quiz-filter-options');
  const cats = [...new Set(miVocabulario.map(w => w.categoria).filter(Boolean))];
  const subcats = [...new Set(miVocabulario.map(w => w.subcategoria).filter(Boolean))];
  const tags = getAllTags();
  const baseWords = getAllBaseWords();
  const baseNotAdded = baseWords.filter(b => !miVocabulario.some(w => w.id === b.id));

  let html = `
    <div class="quiz-filter-group">
      <label class="quiz-filter-opt ${quizSelectedFilter === 'all' ? 'active' : ''}" onclick="setQuizFilter('all', this)">
        📚 Mis palabras / Мої слова (${miVocabulario.length})
      </label>
      ${baseNotAdded.length > 0 ? `
      <label class="quiz-filter-opt ${quizSelectedFilter === 'base' ? 'active' : ''}" onclick="setQuizFilter('base', this)">
        📖 Base de datos / База (${baseWords.length})
      </label>
      <label class="quiz-filter-opt ${quizSelectedFilter === 'all+base' ? 'active' : ''}" onclick="setQuizFilter('all+base', this)">
        🌍 Todo junto / Усе разом (${miVocabulario.length + baseNotAdded.length})
      </label>` : ''}
    </div>`;

  if (cats.length > 0) {
    html += `<div class="quiz-filter-group"><div class="quiz-filter-label">Por categoría / За категорією</div>`;
    cats.forEach(cat => {
      const count = miVocabulario.filter(w => w.categoria === cat).length;
      html += `<label class="quiz-filter-opt ${quizSelectedFilter === 'cat:' + cat ? 'active' : ''}" onclick="setQuizFilter('cat:${cat}', this)">
        📂 ${cat} (${count})
      </label>`;
    });
    html += '</div>';
  }

  if (subcats.length > 0) {
    html += `<div class="quiz-filter-group"><div class="quiz-filter-label">Por subcategoría / За підкатегорією</div>`;
    subcats.forEach(sub => {
      const count = miVocabulario.filter(w => w.subcategoria === sub).length;
      html += `<label class="quiz-filter-opt ${quizSelectedFilter === 'sub:' + sub ? 'active' : ''}" onclick="setQuizFilter('sub:${sub}', this)">
        › ${sub} (${count})
      </label>`;
    });
    html += '</div>';
  }

  const personalTags = tags.filter(t => t !== 'database');
  if (personalTags.length > 0) {
    html += `<div class="quiz-filter-group"><div class="quiz-filter-label">Por etiqueta / За міткою</div>`;
    personalTags.forEach(tag => {
      const count = miVocabulario.filter(w => (w.etiquetas || []).includes(tag)).length;
      html += `<label class="quiz-filter-opt ${quizSelectedFilter === 'tag:' + tag ? 'active' : ''}" onclick="setQuizFilter('tag:${tag}', this)">
        #${tag} (${count})
      </label>`;
    });
    html += '</div>';
  }

  if (vocabBase.categorias.length > 0) {
    html += `<div class="quiz-filter-group"><div class="quiz-filter-label">📖 Por categoría de la base / Категорія бази</div>`;
    vocabBase.categorias.forEach(cat => {
      const count = cat.subcategorias.reduce((acc, s) => acc + s.palabras.length, 0);
      html += `<label class="quiz-filter-opt ${quizSelectedFilter === 'basecat:' + cat.id ? 'active' : ''}" onclick="setQuizFilter('basecat:${cat.id}', this)">
        ${cat.emoji || ''} ${cat.nombre.es} (${count})
      </label>`;
    });
    html += '</div>';
  }

  container.innerHTML = html;
}

// Make functions available globally for onclick handlers
// ==================== SELECCIÓN MÚLTIPLE ====================
let selectMode = false;
let selectedWords = new Set();

function toggleSelectMode() {
  selectMode = !selectMode;
  selectedWords.clear();
  const bar = document.getElementById('bulk-action-bar');
  const btn = document.getElementById('btn-select-mode');
  if (selectMode) {
    bar.classList.remove('hidden');
    btn.classList.add('active');
    btn.textContent = '✕';
    pushModalState();
  } else {
    bar.classList.add('hidden');
    btn.classList.remove('active');
    btn.textContent = '☑️';
  }
  updateBulkCount();
  renderMyVocab();
}

function toggleWordSelect(id, e) {
  e.stopPropagation();
  if (selectedWords.has(id)) selectedWords.delete(id);
  else selectedWords.add(id);
  // Actualizar clase sin re-render completo
  const card = document.querySelector(`.word-card[data-id="${id}"]`);
  if (card) card.classList.toggle('selected', selectedWords.has(id));
  updateBulkCount();
}

function selectAllVisible() {
  const cards = document.querySelectorAll('.word-card[data-id]');
  const allSelected = cards.length > 0 && [...cards].every(c => selectedWords.has(c.dataset.id));
  cards.forEach(c => {
    if (allSelected) selectedWords.delete(c.dataset.id);
    else selectedWords.add(c.dataset.id);
    c.classList.toggle('selected', selectedWords.has(c.dataset.id));
  });
  updateBulkCount();
}

function updateBulkCount() {
  const n = selectedWords.size;
  document.getElementById('bulk-count').textContent =
    n === 0 ? 'Selecciona palabras' : `${n} seleccionada${n !== 1 ? 's' : ''}`;
}

function deleteSelectedWords() {
  if (selectedWords.size === 0) return;
  if (!confirm(`¿Eliminar ${selectedWords.size} palabras?\nВидалити ${selectedWords.size} слів?`)) return;
  miVocabulario = miVocabulario.filter(w => !selectedWords.has(w.id));
  saveMyVocab();
  toggleSelectMode();
  populateCategoryFilter();
  renderMyVocab();
  renderCategorias();
  showToast(`${selectedWords.size} palabras eliminadas`);
}

function openBulkCatModal() {
  if (selectedWords.size === 0) { showToast('Selecciona al menos una palabra'); return; }
  const catSel = document.getElementById('bulk-cat-select');
  catSel.innerHTML = '';
  const allCatsMap = new Map();
  vocabBase.categorias.forEach(c => allCatsMap.set(c.id, { id: c.id, es: c.nombre.es, uk: c.nombre.uk, emoji: c.emoji || '' }));
  getUserCategories().forEach(c => { if (!allCatsMap.has(c.id)) allCatsMap.set(c.id, { id: c.id, es: c.nombre?.es || c.id, uk: c.nombre?.uk || '', emoji: '' }); });
  miVocabulario.forEach(w => { if (w.categoriaId && !allCatsMap.has(w.categoriaId)) allCatsMap.set(w.categoriaId, { id: w.categoriaId, es: w.categoria || w.categoriaId, uk: w.categoriaUk || '', emoji: '' }); });
  allCatsMap.forEach(c => { catSel.innerHTML += `<option value="${c.id}">${c.emoji ? c.emoji + ' ' : ''}${c.es}</option>`; });
  updateBulkSubcatOptions();
  document.getElementById('bulk-cat-modal').classList.remove('hidden');
  pushModalState();
}

function closeBulkCatModal() {
  document.getElementById('bulk-cat-modal').classList.add('hidden');
}

function updateBulkSubcatOptions() {
  const catId = document.getElementById('bulk-cat-select').value;
  const subSel = document.getElementById('bulk-subcat-select');
  subSel.innerHTML = '';
  const baseCat = vocabBase.categorias.find(c => c.id === catId);
  if (baseCat) {
    baseCat.subcategorias.forEach(s => {
      subSel.innerHTML += `<option value="${s.id}">${s.emoji ? s.emoji + ' ' : ''}${s.nombre.es}</option>`;
    });
  }
  getUserSubcategories(catId).forEach(s => {
    subSel.innerHTML += `<option value="${s.id}">${s.nombre?.es || s.id}</option>`;
  });
  miVocabulario.filter(w => w.categoriaId === catId && w.subcategoriaId).forEach(w => {
    if (!subSel.querySelector(`option[value="${w.subcategoriaId}"]`))
      subSel.innerHTML += `<option value="${w.subcategoriaId}">${w.subcategoria || w.subcategoriaId}</option>`;
  });
}

function applyBulkCategory() {
  const catId = document.getElementById('bulk-cat-select').value;
  const subcatId = document.getElementById('bulk-subcat-select').value;
  if (!catId) { showToast('Selecciona una categoría'); return; }

  const allCatsMap = new Map();
  vocabBase.categorias.forEach(c => allCatsMap.set(c.id, c));
  const baseCat = allCatsMap.get(catId);
  const catEs   = baseCat ? baseCat.nombre.es : (miVocabulario.find(w => w.categoriaId === catId)?.categoria || catId);
  const catUk   = baseCat ? baseCat.nombre.uk : '';

  let subcatEs = '', subcatUk = '';
  if (subcatId && baseCat) {
    const sub = baseCat.subcategorias.find(s => s.id === subcatId);
    subcatEs = sub ? sub.nombre.es : subcatId;
    subcatUk = sub ? sub.nombre.uk : '';
  }

  let count = 0;
  miVocabulario.forEach(w => {
    if (!selectedWords.has(w.id)) return;
    w.categoriaId   = catId;
    w.categoria     = catEs;
    w.categoriaUk   = catUk;
    w.subcategoriaId = subcatId || '';
    w.subcategoria   = subcatEs;
    w.subcategoriaUk = subcatUk;
    count++;
  });

  saveMyVocab();
  closeBulkCatModal();
  toggleSelectMode();          // limpia selección y cierra barra
  populateCategoryFilter();
  renderMyVocab();
  renderCategorias();
  showToast(`✅ ${count} palabras movidas a "${catEs}"`);
}

// ==================== BOTÓN ATRÁS ANDROID ====================
function pushModalState() {
  history.pushState({ modal: true }, '');
}

function closeTopModal() {
  const modals = [
    { id: 'image-picker-modal', close: () => closeImagePicker() },
    { id: 'correction-modal',   close: () => closeCorrectionModal() },
    { id: 'word-detail-modal',  close: () => { document.getElementById('word-detail-modal').classList.add('hidden'); } },
    { id: 'cat-modal',          close: () => closeCatModal() },
    { id: 'bulk-cat-modal',     close: () => closeBulkCatModal() },
    { id: 'add-modal',          close: () => closeModal() },
    { id: 'quiz-overlay',       close: () => endQuiz() },
  ];
  for (const m of modals) {
    const el = document.getElementById(m.id);
    if (el && !el.classList.contains('hidden')) {
      m.close();
      return true;
    }
  }
  return false;
}

window.addEventListener('popstate', () => {
  closeTopModal();
});

window.doSearch = doSearch;
window.openAddModal = openAddModal;
window.selectResultImage = selectResultImage;
window.selectModalImage = selectModalImage;
window.toggleCat = toggleCat;
window.toggleSubcat = toggleSubcat;
window.openImagePicker = openImagePicker;
window.selectPickerImage = selectPickerImage;
window.closeImagePicker = closeImagePicker;
window.discardPickerImage = discardPickerImage;
window.toggleSelectMode = toggleSelectMode;
window.toggleWordSelect = toggleWordSelect;
window.selectAllVisible = selectAllVisible;
window.deleteSelectedWords = deleteSelectedWords;
window.openBulkCatModal = openBulkCatModal;
window.closeBulkCatModal = closeBulkCatModal;
window.updateBulkSubcatOptions = updateBulkSubcatOptions;
window.applyBulkCategory = applyBulkCategory;
window.switchPickerTab = switchPickerTab;
window.selectPickerEmoji = selectPickerEmoji;
window.applyEmojiFromInput = applyEmojiFromInput;
window.setTagFilter = setTagFilter;
window.removeModalTag = removeModalTag;
window.openCatModal = openCatModal;
window.openSubcatModal = openSubcatModal;
window.closeCatModal = closeCatModal;
window.saveCatModal = saveCatModal;
window.deleteCategoria = deleteCategoria;
window.deleteSubcategoria = deleteSubcategoria;
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;
window.setQuizFilter = setQuizFilter;
window.startQuizWithFilter = startQuizWithFilter;
window.openCameraInput = openCameraInput;
window.openCameraForSearchCard = openCameraForSearchCard;
window.searchMoreImagesForCard = searchMoreImagesForCard;
window.triggerInstall = triggerInstall;
window.addFromSearchCard = addFromSearchCard;
window.openWordDetail = openWordDetail;
window.saveAndCloseDetail = saveAndCloseDetail;
window.deleteWordFromDetail = deleteWordFromDetail;
window.removeDetailTag = removeDetailTag;
window.goToTagFilter = goToTagFilter;
window.renderExploreDatabase = renderExploreDatabase;
window.importBaseWord = importBaseWord;
window.importAllVisible = importAllVisible;
window.toggleExploreCat = toggleExploreCat;
window.speakWord = speakWord;
window.openCorrectionModal = openCorrectionModal;
window.closeCorrectionModal = closeCorrectionModal;
window.submitCorrectionModal = submitCorrectionModal;
