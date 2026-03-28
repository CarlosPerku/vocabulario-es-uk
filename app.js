// ==================== CONFIG ====================
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
const GITHUB_REPO = ''; // Ej: 'usuario/repo' para crear Issues
const IMAGE_CACHE_KEY = 'image_cache';

// ==================== STATE ====================
let vocabBase = { categorias: [] };
let miVocabulario = [];
let quizWords = [];
let quizIndex = 0;
let selectedImageUrl = '';
let activeTagFilter = '';   // etiqueta activa para filtrar
let modalTags = [];         // etiquetas del modal en edición

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', async () => {
  await loadVocabBase();

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
    });
  });
}

// ==================== AUTO-TRANSLATE CATEGORY MODAL ====================
function setupCatModalTranslation() {
  let esTimer, ukTimer;

  document.getElementById('cat-modal-es').addEventListener('input', () => {
    clearTimeout(esTimer);
    esTimer = setTimeout(async () => {
      const val = document.getElementById('cat-modal-es').value.trim();
      const ukField = document.getElementById('cat-modal-uk');
      if (val && !ukField.value.trim()) {
        const translated = await translateText(val, 'es', 'uk');
        if (translated) ukField.value = translated;
      }
    }, 800);
  });

  document.getElementById('cat-modal-uk').addEventListener('input', () => {
    clearTimeout(ukTimer);
    ukTimer = setTimeout(async () => {
      const val = document.getElementById('cat-modal-uk').value.trim();
      const esField = document.getElementById('cat-modal-es');
      if (val && !esField.value.trim()) {
        const translated = await translateText(val, 'uk', 'es');
        if (translated) esField.value = translated;
      }
    }, 800);
  });
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
  const cats = new Set(miVocabulario.map(w => w.categoria));
  select.innerHTML = '<option value="">Todas / Усі категорії</option>';
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

  if (filterCat) {
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
  list.innerHTML = words.map(w => `
    <div class="word-card" data-id="${w.id}" onclick="openWordDetail('${w.id}')">
      <div class="card-image" onclick="event.stopPropagation(); openImagePicker('${w.id}')" title="Cambiar imagen / Змінити зображення">
        ${w.imagen
          ? `<img src="${w.imagen}" alt="${w.es}" onerror="this.parentElement.innerHTML='${w.emoji || '🍽️'}'">`
          : (w.emoji || '🍽️')}
        <div class="card-image-hint">🖼️</div>
      </div>
      <div class="card-info">
        <div class="card-es">${w.es}</div>
        <div class="card-uk">${w.uk}</div>
        ${w.descripcion_es ? `<div class="card-desc card-desc-es">${w.descripcion_es}</div>` : ''}
        ${w.descripcion ? `<div class="card-desc card-desc-uk">${w.descripcion}</div>` : ''}
        <span class="card-category">${w.categoria || ''}${w.subcategoria ? ' › ' + w.subcategoria : ''}</span>
        ${w.etiquetas && w.etiquetas.length > 0
          ? `<div class="card-tags">${w.etiquetas.map(t => `<span class="tag-badge">#${t}</span>`).join('')}</div>`
          : ''}
      </div>
    </div>
  `).join('');
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
  const q = normalizeStr(query);
  const esNorm = normalizeStr(word.es);
  const ukLower = (word.uk || '').toLowerCase();
  return (
    esNorm.includes(q) ||
    levenshtein(esNorm, q) <= 2 ||
    ukLower.includes(query.toLowerCase())
  );
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

  // 1. Buscar en vocabulario base (por ES normalizado o por UK)
  const allWords = getAllBaseWords();
  const baseMatches = allWords.filter(w => {
    const qNorm = normalizeStr(queryEs);
    const esNorm = normalizeStr(w.es);
    const ukLow = (w.uk || '').toLowerCase();
    return (
      esNorm.includes(qNorm) ||
      levenshtein(esNorm, qNorm) <= 2 ||
      (isUkrainian && ukLow.includes(query.toLowerCase()))
    );
  });

  // 2. Buscar imágenes usando término en español
  let images = [];
  try { images = await searchImages(queryEs); } catch (e) {}

  // Construir resultados
  let html = '';

  baseMatches.forEach(match => {
    const isAdded = miVocabulario.some(w => w.id === match.id);
    html += renderSearchResult(match, images, isAdded, true);
  });

  if (baseMatches.length === 0) {
    const newWord = {
      id: slugify(queryEs),
      es: capitalizeFirst(isUkrainian ? queryEs : query),
      uk: isUkrainian ? query : (queryUk || ''),
      descripcion: '',
      emoji: guessEmoji(queryEs),
      imagen: images.length > 0 ? images[0] : ''
    };
    const isAdded = miVocabulario.some(w => w.id === newWord.id);
    html += renderSearchResult(newWord, images, isAdded, false);
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
      <div class="result-info">
        <div class="result-es">${word.es}</div>
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

// ==================== ADD MODAL ====================
function setupModal() {
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', saveFromModal);
  document.getElementById('modal-cat').addEventListener('change', updateSubcatOptions);

  // Auto-traducción entre campos bilingüe
  let timers = {};
  function autoTranslate(srcId, dstId, from, to) {
    clearTimeout(timers[srcId]);
    timers[srcId] = setTimeout(async () => {
      const val = document.getElementById(srcId).value.trim();
      const dst = document.getElementById(dstId);
      if (val && !dst.value.trim()) {
        const translated = await translateText(val, from, to);
        if (translated) dst.value = translated;
      }
    }, 800);
  }

  document.getElementById('modal-desc-es').addEventListener('input', () => autoTranslate('modal-desc-es', 'modal-desc', 'es', 'uk'));
  document.getElementById('modal-desc').addEventListener('input', () => autoTranslate('modal-desc', 'modal-desc-es', 'uk', 'es'));
  document.getElementById('modal-uk').addEventListener('input', () => autoTranslate('modal-uk', 'modal-es', 'uk', 'es'));
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

  // Pre-select category if word has one
  if (word.categoriaId) {
    catSelect.value = word.categoriaId;
  } else if (vocabBase.categorias.length > 0) {
    catSelect.value = vocabBase.categorias[0].id;
  }
  updateSubcatOptions();

  // Images in modal
  const modalImages = document.getElementById('modal-images');
  if (word._images && word._images.length > 0) {
    modalImages.innerHTML = word._images.map((url, i) =>
      `<img src="${url}" class="${i === 0 ? 'selected' : ''}" onclick="selectModalImage(this, '${url}')">`
    ).join('');
  } else if (word.imagen) {
    modalImages.innerHTML = `<img src="${word.imagen}" class="selected" onclick="selectModalImage(this, '${word.imagen}')">`;
  } else {
    modalImages.innerHTML = '';
  }

  document.getElementById('add-modal').classList.remove('hidden');
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

  // Handle new category
  let catName = '', catNameUk = '';
  if (newCat) {
    catId = slugify(newCat);
    catName = newCat;
    catNameUk = newCat;
  } else {
    const baseCat = vocabBase.categorias.find(c => c.id === catId);
    const userCat = getUserCategories().find(c => c.id === catId);
    const wordWithCat = miVocabulario.find(w => w.categoriaId === catId);
    catName = baseCat?.nombre.es || userCat?.nombre.es || wordWithCat?.categoria || catId;
    catNameUk = baseCat?.nombre.uk || userCat?.nombre.uk || wordWithCat?.categoriaUk || '';
  }

  // Handle new subcategory
  let subcatName = '', subcatNameUk = '';
  if (newSubcat) {
    subcatId = slugify(newSubcat);
    subcatName = newSubcat;
    subcatNameUk = newSubcat;
  } else {
    const baseCat = vocabBase.categorias.find(c => c.id === catId);
    const baseSub = baseCat?.subcategorias.find(s => s.id === subcatId);
    const userSub = getUserSubcategories(catId).find(s => s.id === subcatId);
    const wordWithSub = miVocabulario.find(w => w.categoriaId === catId && w.subcategoriaId === subcatId);
    subcatName = baseSub?.nombre.es || userSub?.nombre.es || wordWithSub?.subcategoria || subcatId;
    subcatNameUk = baseSub?.nombre.uk || userSub?.nombre.uk || wordWithSub?.subcategoriaUk || '';
  }

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
function renderCategorias() {
  const container = document.getElementById('categorias-tree');

  // Group words by category and subcategory
  const catMap = new Map();
  miVocabulario.forEach(w => {
    const catKey = w.categoria || 'Sin categoría';
    if (!catMap.has(catKey)) {
      catMap.set(catKey, { uk: w.categoriaUk || '', subs: new Map() });
    }
    const subKey = w.subcategoria || 'General';
    if (!catMap.get(catKey).subs.has(subKey)) {
      catMap.get(catKey).subs.set(subKey, { uk: w.subcategoriaUk || '', words: [] });
    }
    catMap.get(catKey).subs.get(subKey).words.push(w);
  });

  if (catMap.size === 0) {
    container.innerHTML = '<div class="empty-state"><span class="empty-emoji">📂</span><p>Sin categorías / Немає категорій</p></div>';
    return;
  }

  let html = '';
  catMap.forEach((catData, catName) => {
    const totalWords = Array.from(catData.subs.values()).reduce((sum, s) => sum + s.words.length, 0);
    const catId = slugify(catName);

    html += `<div class="cat-group">
      <div class="cat-header">
        <span onclick="toggleCat('${catId}')" style="flex:1;cursor:pointer">
          ${catName}${catData.uk ? ' / ' + catData.uk : ''}
          <span class="cat-count">${totalWords}</span>
        </span>
        <div class="cat-actions">
          <button class="cat-action-btn" onclick="openSubcatModal('${catName}')" title="Nueva subcategoría / Нова підкатегорія">+</button>
          <button class="cat-action-btn cat-action-del" onclick="deleteCategoria('${catName}')" title="Eliminar categoría / Видалити категорію">✕</button>
        </div>
      </div>`;

    catData.subs.forEach((subData, subName) => {
      const subId = `${catId}-${slugify(subName)}`;
      html += `
        <div class="subcat-header">
          <span onclick="toggleSubcat('${subId}')" style="flex:1;cursor:pointer">
            ${subName}${subData.uk ? ' / ' + subData.uk : ''}
            <span class="cat-count">${subData.words.length}</span>
          </span>
          <button class="cat-action-btn cat-action-del" onclick="deleteSubcategoria('${catName}', '${subName}')" title="Eliminar subcategoría / Видалити підкатегорію">✕</button>
        </div>
        <div class="subcat-words" id="subcat-${subId}">
          ${subData.words.map(w => `
            <div class="subcat-word">
              <span class="subcat-word-emoji">${w.imagen ? `<img src="${w.imagen}" style="width:36px;height:36px;border-radius:8px;object-fit:cover;" onerror="this.outerHTML='${w.emoji || '🍽️'}'">` : (w.emoji || '🍽️')}</span>
              <div class="subcat-word-text">
                <div class="subcat-word-es">${w.es}</div>
                <div class="subcat-word-uk">${w.uk}</div>
              </div>
            </div>
          `).join('')}
        </div>`;
    });

    html += '</div>';
  });

  container.innerHTML = html;
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

  document.getElementById('cat-modal').classList.remove('hidden');
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
  if (miVocabulario.length === 0) {
    showToast('Añade palabras primero / Спочатку додай слова');
    return;
  }
  quizSelectedFilter = 'all';
  // Mostrar pantalla de filtro
  document.getElementById('quiz-overlay').classList.remove('hidden');
  document.getElementById('quiz-filter-screen').classList.remove('hidden');
  document.getElementById('quiz-card-screen').classList.add('hidden');
  renderQuizFilterOptions();
}

function renderQuizFilterOptions() {
  const container = document.getElementById('quiz-filter-options');
  const cats = [...new Set(miVocabulario.map(w => w.categoria).filter(Boolean))];
  const subcats = [...new Set(miVocabulario.map(w => w.subcategoria).filter(Boolean))];
  const tags = getAllTags();

  let html = `
    <div class="quiz-filter-group">
      <label class="quiz-filter-opt ${quizSelectedFilter === 'all' ? 'active' : ''}" onclick="setQuizFilter('all', this)">
        📚 Todas las palabras / Всі слова (${miVocabulario.length})
      </label>
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

  if (tags.length > 0) {
    html += `<div class="quiz-filter-group"><div class="quiz-filter-label">Por etiqueta / За міткою</div>`;
    tags.forEach(tag => {
      const count = miVocabulario.filter(w => (w.etiquetas || []).includes(tag)).length;
      html += `<label class="quiz-filter-opt ${quizSelectedFilter === 'tag:' + tag ? 'active' : ''}" onclick="setQuizFilter('tag:${tag}', this)">
        #${tag} (${count})
      </label>`;
    });
    html += '</div>';
  }

  container.innerHTML = html;
}

function setQuizFilter(filter, el) {
  quizSelectedFilter = filter;
  document.querySelectorAll('.quiz-filter-opt').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
}

function startQuizWithFilter() {
  let words = [...miVocabulario];
  if (quizSelectedFilter.startsWith('cat:')) {
    const cat = quizSelectedFilter.slice(4);
    words = words.filter(w => w.categoria === cat);
  } else if (quizSelectedFilter.startsWith('sub:')) {
    const sub = quizSelectedFilter.slice(4);
    words = words.filter(w => w.subcategoria === sub);
  } else if (quizSelectedFilter.startsWith('tag:')) {
    const tag = quizSelectedFilter.slice(4);
    words = words.filter(w => (w.etiquetas || []).includes(tag));
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
  if (word.imagen) {
    imageDiv.innerHTML = `<img src="${word.imagen}" onerror="this.outerHTML='<span style=font-size:80px>${word.emoji || '🍽️'}</span>'">`;
  } else {
    imageDiv.innerHTML = word.emoji || '🍽️';
  }
  // Mostrar ucraniano, ocultar español
  document.getElementById('quiz-question').textContent = word.uk;
  const answerDiv = document.getElementById('quiz-answer');
  answerDiv.innerHTML = `${word.es}${word.descripcion ? `<div class="quiz-desc">${word.descripcion}</div>` : ''}`;
  answerDiv.classList.add('hidden');
  document.getElementById('quiz-reveal').style.display = 'block';
  document.getElementById('quiz-counter').textContent = `${quizIndex + 1} / ${quizWords.length}`;
}

function revealQuizAnswer() {
  document.getElementById('quiz-answer').classList.remove('hidden');
  document.getElementById('quiz-reveal').style.display = 'none';
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

function guessEmoji(word) {
  const emojiMap = {
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

  const normalized = word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return emojiMap[normalized] || emojiMap[word.toLowerCase()] || '🍽️';
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
    const wordId = document.getElementById('image-picker-wordid').value;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const word = miVocabulario.find(w => w.id === wordId);
      if (word) {
        word.imagen = dataUrl;
        saveMyVocab();
      }
      closeImagePicker();
      showToast('Foto guardada / Фото збережено ✓');
    };
    reader.readAsDataURL(file);
    input.value = '';
  });
}

function openCameraInput() {
  document.getElementById('camera-input').click();
}

// ==================== WORD DETAIL MODAL ====================
let detailTags = [];
let detailWordId = '';

function openWordDetail(wordId) {
  const word = miVocabulario.find(w => w.id === wordId);
  if (!word) return;
  detailWordId = wordId;

  document.getElementById('detail-word-id').value = wordId;
  document.getElementById('detail-es').textContent = word.es;
  document.getElementById('detail-uk').textContent = word.uk;

  const imgDiv = document.getElementById('detail-image');
  imgDiv.innerHTML = word.imagen
    ? `<img src="${word.imagen}" alt="${word.es}" onerror="this.outerHTML='<span style=font-size:56px>${word.emoji || '🍽️'}</span>'">`
    : `<span style="font-size:56px">${word.emoji || '🍽️'}</span>`;

  const descsDiv = document.getElementById('detail-descs');
  descsDiv.innerHTML = '';
  if (word.descripcion_es) descsDiv.innerHTML += `<div class="card-desc card-desc-es">${word.descripcion_es}</div>`;
  if (word.descripcion) descsDiv.innerHTML += `<div class="card-desc card-desc-uk">${word.descripcion}</div>`;

  document.getElementById('detail-cat').textContent = word.categoria
    ? `${word.categoria}${word.subcategoria ? ' › ' + word.subcategoria : ''}`
    : '';

  detailTags = word.etiquetas ? [...word.etiquetas] : [];
  renderDetailTags();

  document.getElementById('word-detail-modal').classList.remove('hidden');
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
    word.etiquetas = [...detailTags];
    saveMyVocab();
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

// Make functions available globally for onclick handlers
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
window.triggerInstall = triggerInstall;
window.addFromSearchCard = addFromSearchCard;
window.openWordDetail = openWordDetail;
window.saveAndCloseDetail = saveAndCloseDetail;
window.deleteWordFromDetail = deleteWordFromDetail;
window.removeDetailTag = removeDetailTag;
window.goToTagFilter = goToTagFilter;
