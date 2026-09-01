/**
 * db.js - Gestionnaire de base de données locale (IndexedDB) pour Suivi eKiKare
 */

const DB_NAME = 'eKiKareDB';
const DB_VERSION = 2; // Version incremented to support deleted_records store
let dbInstance = null;

// CONFIGURATION SYNCHRONISATION
export const SYNCED_STORES = ['clients', 'professionals', 'animals', 'sessions', 'reminders'];
let supabaseClient = null;

/**
 * Lazy initialisation du client Supabase
 */
export function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(
      "https://vctunemarfbmoffvgjha.supabase.co",
      "sb_publishable_qxlXJDcBhAP0j8zYbNAeBQ_cjLDYy3H"
    );
  } else {
    console.error("Supabase CDN non chargé.");
  }
  return supabaseClient;
}

/**
 * Maps local IndexedDB object structure to Supabase SQL structure.
 */
// SYNC CHANGE CALLBACK SYSTEM
let onDatabaseChangeCallback = null;

export function registerDatabaseChangeCallback(callback) {
  onDatabaseChangeCallback = callback;
}

/**
 * Maps local IndexedDB object structure to Supabase SQL structure.
 */
export function mapLocalToSupabase(storeName, item) {
  if (!item) return null;
  const isoTime = new Date().toISOString();
  const mapped = { 
    id: String(item.id),
    last_modified: isoTime,
    updated_at: isoTime
  };

  let specificFields = {};
  switch (storeName) {
    case 'clients':
      specificFields = {
        first_name: item.prenom || item.first_name || '',
        last_name: item.nom || item.last_name || '',
        phone: item.telephone || item.phone || '',
        email: item.email || '',
        address: item.adresse || item.address || '',
        main_stable: item.ecurie || item.main_stable || item.mainStable || '',
        notes: item.notes || '',
        uuid: item.uuid || item.portal_token || null,
        portal_token: item.portal_token || item.uuid || null
      };
      break;
    case 'animals':
      specificFields = {
        client_id: String(item.client_id || item.clientId || ''),
        name: item.name || item.nom || '',
        species: item.species || item.espece || 'Cheval',
        breed: item.breed || item.race || null,
        gender: item.gender || item.sexe || null,
        birth_date: item.birthDate || item.birth_date || item.date_naissance_ou_age || null,
        photo: item.photo || item.photo_data_url || null,
        stable: item.stable || item.stable_name || item.lieu_de_vie || null,
        housing_type: item.housingType || item.housing_type || null,
        social_life: item.socialLife || item.social_life || item.social_type || null,
        work_goals: item.workGoals || item.work_goals || item.work_objective || null,
        diet: item.diet || item.nutrition_details || null,
        medical_history: item.medicalHistory || item.medical_history || item.antecedents || null,
        issues: item.issues || item.main_problems || null,
        notes: item.notes || null,
        custom_details: item.customDetails || item.custom_details || item.lifestyle_details || null,
        distance_km: item.distanceKm !== undefined && item.distanceKm !== null ? Number(item.distanceKm) : (item.distance_km !== undefined && item.distance_km !== null ? Number(item.distance_km) : (item.stable_distance !== undefined && item.stable_distance !== null ? Number(item.stable_distance) : null)),
        tracking_mode: item.trackingMode || item.tracking_mode || null
      };
      break;
    case 'sessions':
      specificFields = {
        client_id: String(item.clientId || item.client_id || ''),
        animal_id: String(item.animalId || item.animal_id || ''),
        session_type: item.sessionType || item.session_type || (item.isExternal ? 'Externe' : 'Générale'),
        practitioner_name: item.practitionerName || item.practitioner_name || null,
        practitioner_profession: item.practitionerProfession || item.practitioner_profession || item.profession || null,
        session_date: item.sessionDate || item.session_date || item.date_seance || new Date().toISOString().split('T')[0],
        reason: item.reason || item.motif || null,
        protocols: item.protocols || item.protocoles_realises || null,
        summary: item.summary || item.cr_personnel || null,
        private_clinical_notes: item.privateClinicalNotes || item.private_clinical_notes || item.notes_observations || null,
        detailed_pro_report: item.detailedProReport || item.detailed_pro_report || item.precisions || null,
        general_notes: item.generalNotes || item.general_notes || item.resume_client_genere || null,
        anatomical_drawing: item.anatomicalDrawing || item.anatomical_drawing || item.canvas_annotation_image_blob || null,
        attachments: item.attachments || item.fileData || null
      };
      break;
    case 'professionals':
      specificFields = {
        first_name: item.prenom || item.first_name || '',
        last_name: item.nom || item.last_name || '',
        phone: item.telephone || item.phone || '',
        specialty: item.specialite || item.specialty || '',
        notes: item.notes || ''
      };
      break;
    case 'reminders':
      specificFields = {
        title: item.title || item.notes || item.type_rappel || '',
        due_date: item.dueDate || item.due_date || item.date_prevue || null,
        completed: item.completed !== undefined ? Boolean(item.completed) : (item.statut === 'fait'),
        related_client_id: String(item.relatedClientId || item.client_id || ''),
        related_animal_id: String(item.relatedAnimalId || item.animal_id || ''),
        client_id: String(item.relatedClientId || item.client_id || ''),
        animal_id: String(item.relatedAnimalId || item.animal_id || '')
      };
      break;
    default:
      return item;
  }

  // Combine and clean undefined properties
  const combined = { ...mapped, ...specificFields };
  const cleaned = {};
  for (const key in combined) {
    if (combined[key] !== undefined) {
      cleaned[key] = combined[key];
    } else {
      cleaned[key] = null; // Map undefined to null for SQL
    }
  }
  return cleaned;
}

/**
 * Maps Supabase SQL structure back to local IndexedDB object structure.
 */
export function mapSupabaseToLocal(storeName, item) {
  if (!item) return null;
  const timeVal = item.last_modified || item.updated_at;
  const local = { 
    id: Number(item.id),
    last_modified: timeVal ? new Date(timeVal).getTime() : Date.now()
  };

  switch (storeName) {
    case 'clients':
      return {
        ...local,
        prenom: item.first_name || '',
        nom: item.last_name || '',
        telephone: item.phone || '',
        email: item.email || '',
        adresse: item.address || '',
        ecurie: item.main_stable || '',
        notes: item.notes || '',
        uuid: item.uuid || item.portal_token || null,
        portal_token: item.portal_token || item.uuid || null
      };
    case 'animals':
      return {
        ...local,
        client_id: item.client_id ? Number(item.client_id) : null,
        nom: item.name || '',
        espece: item.species || 'Cheval',
        race: item.breed || '',
        robe: item.robe || '',
        sexe: item.gender || '',
        date_naissance_ou_age: item.birth_date || '',
        photo_blob: item.photo || null,
        stable_name: item.stable || '',
        stable_address: item.stable_address || '',
        stable_zip: item.stable_zip || '',
        stable_city: item.stable_city || '',
        stable_distance: item.distance_km !== null ? Number(item.distance_km) : 0,
        stable_at_home: Boolean(item.stable_at_home),
        lieu_de_vie: item.stable || '',
        housing_type: item.housing_type || '',
        housing_type_other: item.housing_type_other || '',
        social_type: item.social_life || '',
        housing_mode: item.housing_type || '',
        lifestyle_details: item.custom_details || '',
        antecedents: item.medical_history || '',
        pros_associes_ids: item.pros_associes_ids || []
      };
    case 'sessions':
      return {
        ...local,
        animal_id: item.animal_id ? Number(item.animal_id) : null,
        client_id: item.client_id ? Number(item.client_id) : null,
        date_seance: item.session_date || '',
        motif: item.reason || '',
        n_seance_annee: item.n_seance_annee !== null ? Number(item.n_seance_annee) : null,
        q_avant_seance: item.q_avant_seance || {},
        q_3_semaines: item.q_3_semaines || {},
        protocoles_realises: item.protocols || {},
        canvas_annotation_image_blob: item.anatomical_drawing || '',
        canvas_drawing_data_url: item.canvas_drawing_data_url || '',
        cr_personnel: item.summary || '',
        notes_observations: item.private_clinical_notes || '',
        precisions: item.detailed_pro_report || '',
        resume_client_genere: item.general_notes || '',
        isExternal: item.session_type === 'Externe',
        practitionerName: item.practitioner_name || '',
        profession: item.practitioner_profession || '',
        summary: item.summary || '',
        fileData: item.attachments || '',
        fileName: item.file_name || '',
        fileType: item.file_type || ''
      };
    case 'professionals':
      return {
        ...local,
        prenom: item.first_name || '',
        nom: item.last_name || '',
        telephone: item.phone || '',
        specialite: item.specialty || '',
        notes: item.notes || ''
      };
    case 'reminders':
      return {
        ...local,
        animal_id: item.animal_id ? Number(item.animal_id) : null,
        client_id: item.client_id ? Number(item.client_id) : null,
        session_id: item.session_id ? Number(item.session_id) : null,
        date_prevue: item.due_date || '',
        semaine_prevue: item.planned_week || '',
        type_rappel: item.reminder_type || '',
        statut: item.completed ? 'fait' : 'en_attente',
        notes: item.notes || '',
        delay: item.delay || ''
      };
    default:
      return item;
  }
}

/**
 * Synchronise une création ou modification vers Supabase via upsert (formaté).
 */
export async function syncUpsert(storeName, item) {
  const client = getSupabaseClient();
  const table = storeName === 'reminders' ? 'tasks' : storeName;
  if (client) {
    try {
      const mapped = mapLocalToSupabase(storeName, item);
      const { error } = await client.from(table).upsert(mapped);
      if (!error) {
        item.synced = 1;
        await updateLocal(storeName, item);
      } else {
        console.error("Erreur sync:", table, error.message || error);
      }
    } catch (e) {
      console.error("Erreur sync:", table, e.message || e);
    }
  }
}

/**
 * Synchronise une suppression vers Supabase.
 */
export async function syncDelete(storeName, id) {
  const client = getSupabaseClient();
  const table = storeName === 'reminders' ? 'tasks' : storeName;
  if (client) {
    try {
      const { error } = await client.from(table).delete().eq('id', String(id));
      if (!error) {
        // Supprimer des suppressions en attente si présente
        const deletions = await getTrackedDeletions();
        const found = deletions.find(d => d.storeName === storeName && d.recordId === Number(id));
        if (found) {
          await clearTrackedDeletion(found.id);
        }
      } else {
        console.error("Erreur sync:", table, error.message || error);
      }
    } catch (e) {
      console.error("Erreur sync:", table, e.message || e);
    }
  }
}

/**
 * Initialise et connecte la base de données IndexedDB.
 * @returns {Promise<IDBDatabase>}
 */
export function getDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Table Clients
      if (!db.objectStoreNames.contains('clients')) {
        db.createObjectStore('clients', { keyPath: 'id', autoIncrement: true });
      }

      // Table Professionnels
      if (!db.objectStoreNames.contains('professionals')) {
        db.createObjectStore('professionals', { keyPath: 'id', autoIncrement: true });
      }

      // Table Animaux
      if (!db.objectStoreNames.contains('animals')) {
        const animalStore = db.createObjectStore('animals', { keyPath: 'id', autoIncrement: true });
        animalStore.createIndex('client_id', 'client_id', { unique: false });
      }

      // Table Séances
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionStore = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        sessionStore.createIndex('animal_id', 'animal_id', { unique: false });
        sessionStore.createIndex('client_id', 'client_id', { unique: false });
      }

      // Table Rappels
      if (!db.objectStoreNames.contains('reminders')) {
        const reminderStore = db.createObjectStore('reminders', { keyPath: 'id', autoIncrement: true });
        reminderStore.createIndex('animal_id', 'animal_id', { unique: false });
        reminderStore.createIndex('client_id', 'client_id', { unique: false });
        reminderStore.createIndex('session_id', 'session_id', { unique: false });
        reminderStore.createIndex('statut', 'statut', { unique: false });
        reminderStore.createIndex('date_prevue', 'date_prevue', { unique: false });
      }

      // Table deleted_records pour le suivi hors-ligne
      if (!db.objectStoreNames.contains('deleted_records')) {
        db.createObjectStore('deleted_records', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error("Erreur d'ouverture d'IndexedDB:", event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Récupère tous les éléments d'un magasin d'objets.
 * @param {string} storeName 
 * @returns {Promise<Array>}
 */
export async function getAll(storeName) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Récupère un élément par son identifiant unique (id).
 * @param {string} storeName 
 * @param {number} id 
 * @returns {Promise<any>}
 */
export async function getById(storeName, id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(Number(id));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Récupère tous les éléments correspondant à un index et sa valeur.
 * @param {string} storeName 
 * @param {string} indexName 
 * @param {any} value 
 * @returns {Promise<Array>}
 */
export async function getByIndex(storeName, indexName, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    let index;
    try {
      index = store.index(indexName);
    } catch (e) {
      reject(e);
      return;
    }
    const request = index.getAll(value);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Ajoute un nouvel élément dans la base de données.
 * @param {string} storeName 
 * @param {Object} item 
 * @returns {Promise<number>} L'identifiant généré
 */
/**
 * Ajoute un nouvel élément en local dans IndexedDB.
 */
export async function addLocal(storeName, item) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    
    if (item.id === undefined || item.id === null || item.id === '') {
      delete item.id;
    }
    
    const request = store.add(item);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Ajoute un nouvel élément localement, puis tente de le synchroniser avec Supabase.
 * @param {string} storeName 
 * @param {Object} item 
 * @returns {Promise<number>} L'identifiant généré
 */
export async function add(storeName, item) {
  if (storeName === 'clients') {
    if (!item.portal_token && !item.uuid) {
      const token = generateUUID();
      item.portal_token = token;
      item.uuid = token;
    }
  }
  if (SYNCED_STORES.includes(storeName)) {
    item.last_modified = Date.now();
    item.synced = 0;
  }
  
  const id = await addLocal(storeName, item);
  item.id = id;
  
  if (SYNCED_STORES.includes(storeName) && navigator.onLine) {
    if (onDatabaseChangeCallback) {
      // Déclenchement direct sans bloquer l'UI
      (async () => {
        try {
          await onDatabaseChangeCallback();
        } catch (err) {
          console.error("Erreur callback sync:", err);
        }
      })();
    } else {
      (async () => {
        try {
          await syncUpsert(storeName, item);
        } catch (err) {
          console.error("Erreur Supabase:", err);
        }
      })();
    }
  }
  return id;
}

/**
 * Met à jour un élément en local dans IndexedDB.
 */
export async function updateLocal(storeName, item) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    
    if (item.id) {
      item.id = Number(item.id);
    }
    
    const request = store.put(item);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Met à jour un élément localement, puis tente de le synchroniser avec Supabase.
 * @param {string} storeName 
 * @param {Object} item 
 * @returns {Promise<number>} L'identifiant mis à jour
 */
export async function update(storeName, item) {
  if (SYNCED_STORES.includes(storeName)) {
    item.last_modified = Date.now();
    item.synced = 0;
  }
  
  const id = await updateLocal(storeName, item);
  
  if (SYNCED_STORES.includes(storeName) && navigator.onLine) {
    if (onDatabaseChangeCallback) {
      // Déclenchement direct sans bloquer l'UI
      (async () => {
        try {
          await onDatabaseChangeCallback();
        } catch (err) {
          console.error("Erreur callback sync:", err);
        }
      })();
    } else {
      (async () => {
        try {
          await syncUpsert(storeName, item);
        } catch (err) {
          console.error("Erreur Supabase:", err);
        }
      })();
    }
  }
  return id;
}

/**
 * Supprime un élément localement dans IndexedDB.
 */
export async function removeLocal(storeName, id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(Number(id));

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Supprime un élément localement, et tente de le supprimer sur Supabase (ou l'enregistre en attente de suppression).
 * @param {string} storeName 
 * @param {number} id 
 * @returns {Promise<void>}
 */
export async function remove(storeName, id) {
  await removeLocal(storeName, id);
  
  if (SYNCED_STORES.includes(storeName)) {
    // Toujours tracer la suppression localement pour garantir la synchro
    await trackDeletion(storeName, id);
    
    if (navigator.onLine) {
      if (onDatabaseChangeCallback) {
        // Déclenchement direct sans bloquer l'UI
        (async () => {
          try {
            await onDatabaseChangeCallback();
          } catch (err) {
            console.error("Erreur callback sync:", err);
          }
        })();
      } else {
        (async () => {
          try {
            await syncDelete(storeName, id);
          } catch (err) {
            console.error("Erreur Supabase:", err);
          }
        })();
      }
    }
  }
}

/**
 * Enregistre une suppression en attente pour synchronisation ultérieure.
 */
export async function trackDeletion(storeName, recordId) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('deleted_records', 'readwrite');
    const store = transaction.objectStore('deleted_records');
    const request = store.add({ storeName, recordId: Number(recordId) });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Récupère les suppressions en attente de synchronisation.
 */
export async function getTrackedDeletions() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('deleted_records', 'readonly');
    const store = transaction.objectStore('deleted_records');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Supprime une tâche de suppression en attente une fois exécutée.
 */
export async function clearTrackedDeletion(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('deleted_records', 'readwrite');
    const store = transaction.objectStore('deleted_records');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Exporte toutes les données de la base dans un seul objet JSON.
 * @returns {Promise<Object>}
 */
export async function exportAllData() {
  const stores = ['clients', 'professionals', 'animals', 'sessions', 'reminders'];
  const exportData = {};
  
  for (const storeName of stores) {
    exportData[storeName] = await getAll(storeName);
  }
  
  return exportData;
}

/**
 * Importe un ensemble de données dans IndexedDB (écrase les données existantes).
 * @param {Object} importData 
 * @returns {Promise<void>}
 */
export async function importAllData(importData) {
  const db = await getDB();
  const stores = ['clients', 'professionals', 'animals', 'sessions', 'reminders'];
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, 'readwrite');
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = (event) => reject(event.target.error);
    
    for (const storeName of stores) {
      const store = transaction.objectStore(storeName);
      store.clear(); // Vider le magasin existant
      
      const items = importData[storeName] || [];
      for (const item of items) {
        // Nettoyage et typage de l'ID si nécessaire
        if (item.id) {
          item.id = Number(item.id);
        }
        store.put(item);
      }
    }
  });
}

/**
 * Génère un identifiant universel sécurisé UUID v4.
 */
export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Récupère un client via son token aléatoire UUID ou son identifiant numérique de repli.
 */
export async function getClientByToken(token) {
  if (!token) return null;
  const clients = await getAll('clients');
  const tokenStr = String(token).trim().toLowerCase();
  let found = clients.find(c => (c.portal_token && String(c.portal_token).toLowerCase() === tokenStr) || 
                                (c.uuid && String(c.uuid).toLowerCase() === tokenStr));
  if (!found) {
    found = clients.find(c => String(c.id).toLowerCase() === tokenStr);
  }
  return found || null;
}

/**
 * Assure la migration et présence d'un token UUID sécurisé pour tous les clients existants.
 */
export async function ensureClientsHaveUUID() {
  const clients = await getAll('clients');
  let hasChanges = false;
  for (const client of clients) {
    if (!client.portal_token || !client.uuid) {
      const token = client.portal_token || client.uuid || generateUUID();
      client.portal_token = token;
      client.uuid = token;
      await updateLocal('clients', client);
      hasChanges = true;
    }
  }
  return hasChanges;
}
