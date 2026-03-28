// ==================== FIREBASE SYNC ====================
// Usando Firebase compat SDK (sin bundler)

const firebaseConfig = {
  apiKey: "AIzaSyBqhN4859g972tC-i0aH1iXQIc16Eo_XY4",
  authDomain: "vocabulario-es-uk.firebaseapp.com",
  projectId: "vocabulario-es-uk",
  storageBucket: "vocabulario-es-uk.firebasestorage.app",
  messagingSenderId: "501749674564",
  appId: "1:501749674564:web:d79d8f9e1278b04d9dc211"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;

// ---- AUTH ----

function initAuth(onUserChange) {
  // Gestionar el resultado del redirect al volver de Google
  auth.getRedirectResult().catch(e => console.warn('Redirect result error:', e));

  auth.onAuthStateChanged(user => {
    currentUser = user;
    onUserChange(user);
  });
}

function loginWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  return auth.signInWithRedirect(provider);
}

function logout() {
  return auth.signOut();
}

// ---- FIRESTORE: VOCABULARIO ----

async function loadVocabFromCloud() {
  if (!currentUser) return null;
  try {
    const doc = await db
      .collection('users')
      .doc(currentUser.uid)
      .collection('data')
      .doc('vocabulario')
      .get();
    if (doc.exists) {
      return doc.data().words || [];
    }
    return null; // primera vez
  } catch (e) {
    console.warn('Error cargando vocabulario de la nube:', e);
    return null;
  }
}

async function saveVocabToCloud(words) {
  if (!currentUser) return;
  try {
    await db
      .collection('users')
      .doc(currentUser.uid)
      .collection('data')
      .doc('vocabulario')
      .set({ words, updated: firebase.firestore.FieldValue.serverTimestamp() });
  } catch (e) {
    console.warn('Error guardando en la nube:', e);
  }
}

// ---- FIRESTORE: CATEGORÍAS DE USUARIO ----

async function loadUserCatsFromCloud() {
  if (!currentUser) return null;
  try {
    const doc = await db
      .collection('users')
      .doc(currentUser.uid)
      .collection('data')
      .doc('categorias')
      .get();
    return doc.exists ? (doc.data() || {}) : null;
  } catch (e) {
    return null;
  }
}

async function saveUserCatsToCloud(data) {
  if (!currentUser) return;
  try {
    await db
      .collection('users')
      .doc(currentUser.uid)
      .collection('data')
      .doc('categorias')
      .set(data);
  } catch (e) {
    console.warn('Error guardando categorías:', e);
  }
}
