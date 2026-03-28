#!/usr/bin/env node
/**
 * apply-suggestions.js
 * ====================
 * Lee de Firestore las sugerencias con status "approved",
 * las aplica en vocabulario.json y las marca como "applied".
 *
 * USO (primera vez):
 *   1. npm install firebase-admin
 *   2. Descarga tu serviceAccountKey.json desde Firebase Console:
 *      → Project Settings → Service accounts → Generate new private key
 *   3. Coloca el archivo como: serviceAccountKey.json (junto a este script)
 *   4. node apply-suggestions.js
 *   5. git add vocabulario.json && git commit -m "Apply vocabulary corrections" && git push
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ── Configuración ────────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const VOCAB_PATH = path.join(__dirname, 'vocabulario.json');
// ─────────────────────────────────────────────────────────────────────────────

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error('❌  No se encontró serviceAccountKey.json');
  console.error('   Descárgalo desde Firebase Console → Project Settings → Service accounts');
  process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  console.log('🔍  Buscando sugerencias aprobadas...');

  const snapshot = await db.collection('suggestions')
    .where('status', '==', 'approved')
    .get();

  if (snapshot.empty) {
    console.log('✅  No hay sugerencias aprobadas pendientes de aplicar.');
    process.exit(0);
  }

  console.log(`📋  ${snapshot.size} sugerencia(s) encontrada(s).`);

  // Cargar vocabulario
  const vocab = JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf8'));

  let applied = 0;
  const batch = db.batch();

  for (const doc of snapshot.docs) {
    const s = doc.data();
    const { wordId, catId, subId, suggested } = s;

    // Localizar la palabra en el JSON
    const cat = vocab.categorias.find(c => c.id === catId);
    if (!cat) {
      console.warn(`  ⚠️  Categoría "${catId}" no encontrada. Saltando ${wordId}.`);
      continue;
    }
    const sub = cat.subcategorias.find(sb => sb.id === subId);
    if (!sub) {
      console.warn(`  ⚠️  Subcategoría "${subId}" no encontrada. Saltando ${wordId}.`);
      continue;
    }
    const wordIdx = sub.palabras.findIndex(p => p.id === wordId);
    if (wordIdx === -1) {
      console.warn(`  ⚠️  Palabra "${wordId}" no encontrada. Saltando.`);
      continue;
    }

    const original = sub.palabras[wordIdx];

    // Aplicar solo los campos que cambiaron y no están vacíos
    if (suggested.es)           original.es           = suggested.es;
    if (suggested.uk)           original.uk           = suggested.uk;
    if (suggested.descripcion_es !== undefined) original.descripcion_es = suggested.descripcion_es;
    if (suggested.descripcion !== undefined)    original.descripcion    = suggested.descripcion;
    if (suggested.imagen)       original.imagen       = suggested.imagen;

    sub.palabras[wordIdx] = original;

    // Marcar como applied en Firestore
    batch.update(doc.ref, {
      status: 'applied',
      appliedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`  ✅  [${catId} › ${subId}] "${wordId}" actualizada.`);
    applied++;
  }

  if (applied === 0) {
    console.log('⚠️  Ninguna sugerencia pudo aplicarse (ver advertencias arriba).');
    process.exit(0);
  }

  // Guardar JSON actualizado
  fs.writeFileSync(VOCAB_PATH, JSON.stringify(vocab, null, 2), 'utf8');
  console.log(`\n💾  vocabulario.json actualizado con ${applied} corrección(es).`);

  // Confirmar en Firestore
  await batch.commit();
  console.log('☁️   Sugerencias marcadas como "applied" en Firestore.\n');

  console.log('👉  Ahora ejecuta:');
  console.log('   git add vocabulario.json');
  console.log('   git commit -m "Apply vocabulary corrections"');
  console.log('   git push');
}

run().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
