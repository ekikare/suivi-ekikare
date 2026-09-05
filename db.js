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
      let cleanNotes = item.notes ? String(item.notes).replace(/\[portal_token:[^\]]+\]/g, '').trim() : '';
      specificFields = {
        first_name: item.prenom || item.first_name || '',
        last_name: item.nom || item.last_name || '',
        phone: item.telephone || item.phone || '',
        email: item.email || '',
        address: item.adresse || item.address || '',
        main_stable: item.ecurie || item.main_stable || item.mainStable || '',
        notes: cleanNotes,
        uuid: item.uuid || null,
        archived_at: item.archived_at || null,
        archive_reason: item.archive_reason || null
      };
      break;
    case 'animals':
      const customPayload = {
        robe: item.robe || '',
        lifestyle_details: item.lifestyle_details || item.custom_details || '',
        stable_name: item.stable_name || item.lieu_de_vie || '',
        stable_address: item.stable_address || '',
        stable_zip: item.stable_zip || '',
        stable_city: item.stable_city || '',
        stable_distance: item.stable_distance !== undefined && item.stable_distance !== null ? Number(item.stable_distance) : (item.distance_km || 0),
        stable_at_home: Boolean(item.stable_at_home),
        housing_type: item.housing_type || item.housing_mode || '',
        housing_type_other: item.housing_type_other || item.housing_mode_other || '',
        social_type: item.social_type || item.social_life || '',
        tracking_mode: item.tracking_mode || 'À la demande',
        tracking_mode_other: item.tracking_mode_other || '',
        nutritionist: Boolean(item.nutritionist),
        nutrition_details: item.nutrition_details || item.diet || '',
        work_objective: item.work_objective || item.work_goals || '',
        main_problems: item.main_problems || item.issues || '',
        medical_events: item.medical_events || [],
        pros_associes_ids: item.pros_associes_ids || [],
        archived_at: item.archived_at || null,
        archive_reason: item.archive_reason || null
      };
      specificFields = {
        client_id: String(item.client_id || item.clientId || ''),
        name: item.name || item.nom || '',
        species: item.species || item.espece || 'Cheval',
        breed: item.breed || item.race || null,
        gender: item.gender || item.sexe || null,
        birth_date: item.birthDate || item.birth_date || item.date_naissance_ou_age || null,
        photo: item.photo || item.photo_data_url || item.photo_blob || null,
        stable: item.stable || item.stable_name || item.lieu_de_vie || null,
        housing_type: item.housingType || item.housing_type || item.housing_mode || null,
        social_life: item.socialLife || item.social_life || item.social_type || null,
        work_goals: item.workGoals || item.work_goals || item.work_objective || null,
        diet: item.diet || item.nutrition_details || null,
        medical_history: item.medicalHistory || item.medical_history || item.antecedents || null,
        issues: item.issues || item.main_problems || null,
        notes: item.notes || null,
        custom_details: JSON.stringify(customPayload),
        distance_km: item.distanceKm !== undefined && item.distanceKm !== null ? Number(item.distanceKm) : (item.distance_km !== undefined && item.distance_km !== null ? Number(item.distance_km) : (item.stable_distance !== undefined && item.stable_distance !== null ? Number(item.stable_distance) : null)),
        tracking_mode: item.trackingMode || item.tracking_mode || null,
        archived_at: item.archived_at || null,
        archive_reason: item.archive_reason || null
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
      let cleanNotesFromDb = item.notes ? String(item.notes).replace(/\[portal_token:[^\]]+\]/g, '').trim() : '';
      const clientUuid = item.uuid || (item.id ? String(item.id) : null);
      return {
        ...local,
        prenom: item.first_name || '',
        nom: item.last_name || '',
        telephone: item.phone || '',
        email: item.email || '',
        adresse: item.address || '',
        ecurie: item.main_stable || '',
        notes: cleanNotesFromDb,
        uuid: clientUuid,
        archived_at: item.archived_at || null,
        archive_reason: item.archive_reason || null
      };
    case 'animals':
      let parsedCustom = {};
      if (item.custom_details) {
        try {
          if (typeof item.custom_details === 'string' && item.custom_details.trim().startsWith('{')) {
            parsedCustom = JSON.parse(item.custom_details);
          } else if (typeof item.custom_details === 'object' && item.custom_details !== null) {
            parsedCustom = item.custom_details;
          }
        } catch (e) {
          parsedCustom = {};
        }
      }
      return {
        ...local,
        client_id: item.client_id ? Number(item.client_id) : null,
        nom: item.name || '',
        espece: item.species || 'Cheval',
        race: item.breed || '',
        robe: item.robe || parsedCustom.robe || '',
        sexe: item.gender || '',
        date_naissance_ou_age: item.birth_date || '',
        photo_blob: item.photo || null,
        photo_data_url: item.photo || null,
        stable_name: item.stable || parsedCustom.stable_name || '',
        stable_address: parsedCustom.stable_address || item.stable_address || '',
        stable_zip: parsedCustom.stable_zip || item.stable_zip || '',
        stable_city: parsedCustom.stable_city || item.stable_city || '',
        stable_distance: item.distance_km !== null && item.distance_km !== undefined ? Number(item.distance_km) : (parsedCustom.stable_distance !== undefined ? Number(parsedCustom.stable_distance) : 0),
        stable_at_home: parsedCustom.stable_at_home !== undefined ? Boolean(parsedCustom.stable_at_home) : Boolean(item.stable_at_home),
        lieu_de_vie: item.stable || parsedCustom.stable_name || '',
        housing_type: item.housing_type || parsedCustom.housing_type || '',
        housing_type_other: parsedCustom.housing_type_other || item.housing_type_other || '',
        social_type: item.social_life || parsedCustom.social_type || '',
        housing_mode: item.housing_type || parsedCustom.housing_type || '',
        lifestyle_details: parsedCustom.lifestyle_details !== undefined ? parsedCustom.lifestyle_details : (item.custom_details || ''),
        medical_events: parsedCustom.medical_events || [],
        antecedents: item.medical_history || '',
        pros_associes_ids: parsedCustom.pros_associes_ids || item.pros_associes_ids || [],
        tracking_mode: item.tracking_mode || parsedCustom.tracking_mode || 'À la demande',
        tracking_mode_other: parsedCustom.tracking_mode_other || '',
        nutritionist: Boolean(parsedCustom.nutritionist),
        nutrition_details: item.diet || parsedCustom.nutrition_details || '',
        work_objective: item.work_goals || parsedCustom.work_objective || '',
        main_problems: item.issues || parsedCustom.main_problems || '',
        notes: item.notes || '',
        archived_at: item.archived_at || parsedCustom.archived_at || null,
        archive_reason: item.archive_reason || parsedCustom.archive_reason || null
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
    if (!item.uuid) {
      item.uuid = generateUUID();
    }
  }
  if (SYNCED_STORES.includes(storeName)) {
    const now = Date.now();
    item.last_modified = now;
    item.updated_at = new Date(now).toISOString();
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
    const now = Date.now();
    item.last_modified = now;
    item.updated_at = new Date(now).toISOString();
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
 * Récupère un client via son UUID sécurisé ou son identifiant numérique de repli.
 */
export async function getClientByUuid(token) {
  if (!token) return null;
  const clients = await getAll('clients');
  const tokenStr = String(token).trim().toLowerCase();
  let found = clients.find(c => c.uuid && String(c.uuid).toLowerCase() === tokenStr);
  if (!found) {
    found = clients.find(c => String(c.id).toLowerCase() === tokenStr);
  }
  return found || null;
}
export const getClientByToken = getClientByUuid;

/**
 * Synchronise et réconcilie de façon descendante les UUIDs des clients depuis Supabase vers IndexedDB.
 */
export async function reconcileClientUUIDsFromSupabase() {
  if (!navigator.onLine) return false;
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  try {
    // 1. Récupérer l'ensemble des clients distants depuis Supabase
    const { data: remoteClients, error } = await supabase
      .from('clients')
      .select('id, uuid, email, phone, first_name, last_name');

    if (error || !remoteClients || remoteClients.length === 0) {
      return false;
    }

    const localClients = await getAll('clients');
    let hasChanges = false;

    for (const remote of remoteClients) {
      if (!remote.uuid) continue;
      
      const remoteIdStr = String(remote.id);
      const remoteEmail = (remote.email || '').trim().toLowerCase();
      const remotePhoneClean = (remote.phone || '').replace(/\D/g, '');
      const remoteFirst = (remote.first_name || '').trim().toLowerCase();
      const remoteLast = (remote.last_name || '').trim().toLowerCase();

      // Correspondance prioritaire : ID distant
      let matchedLocal = localClients.find(c => String(c.id) === remoteIdStr);

      // Correspondance secondaire : email
      if (!matchedLocal && remoteEmail) {
        matchedLocal = localClients.find(c => c.email && c.email.trim().toLowerCase() === remoteEmail);
      }

      // Correspondance secondaire : téléphone
      if (!matchedLocal && remotePhoneClean && remotePhoneClean.length >= 6) {
        matchedLocal = localClients.find(c => c.telephone && c.telephone.replace(/\D/g, '') === remotePhoneClean);
      }

      // Correspondance tertiaire : nom & prénom
      if (!matchedLocal && remoteFirst && remoteLast) {
        matchedLocal = localClients.find(c => 
          c.nom && c.prenom && 
          c.nom.trim().toLowerCase() === remoteLast && 
          c.prenom.trim().toLowerCase() === remoteFirst
        );
      }

      if (matchedLocal) {
        let changed = false;
        
        // 3. Mettre à jour l'enregistrement local si l'UUID est manquant ou différent de celui de Supabase
        if (matchedLocal.uuid !== remote.uuid) {
          matchedLocal.uuid = remote.uuid;
          changed = true;
        }

        // 4. Nettoyer définitivement toute chaîne résiduelle [portal_token:...] qui subsisterait dans le champ notes local
        if (matchedLocal.notes && matchedLocal.notes.includes('[portal_token:')) {
          matchedLocal.notes = matchedLocal.notes.replace(/\[portal_token:[^\]]+\]/g, '').trim();
          changed = true;
        }
        if (matchedLocal.portal_token) {
          delete matchedLocal.portal_token;
          changed = true;
        }

        if (changed) {
          matchedLocal.synced = 1;
          await updateLocal('clients', matchedLocal);
          hasChanges = true;
        }
      }
    }

    return hasChanges;
  } catch (err) {
    console.error("Erreur lors de la réconciliation des UUIDs clients:", err);
    return false;
  }
}

/**
 * Assure la migration et présence d'un token UUID sécurisé pour tous les clients existants et nettoie les notes.
 */
export async function ensureClientsHaveUUID() {
  // 1. D'abord tenter la réconciliation descendante depuis Supabase
  if (navigator.onLine) {
    try {
      await reconcileClientUUIDsFromSupabase();
    } catch (e) {
      console.warn("Réconciliation Supabase au démarrage non effectuée:", e);
    }
  }

  // 2. Nettoyer et s'assurer que tous les clients locaux restants possèdent un UUID valide
  const clients = await getAll('clients');
  let hasChanges = false;
  for (const client of clients) {
    let changed = false;
    // Nettoyage des résidus [portal_token:...] dans le champ notes
    if (client.notes && client.notes.includes('[portal_token:')) {
      client.notes = client.notes.replace(/\[portal_token:[^\]]+\]/g, '').trim();
      changed = true;
    }
    if (client.portal_token) {
      if (!client.uuid) {
        client.uuid = client.portal_token;
      }
      delete client.portal_token;
      changed = true;
    }
    if (!client.uuid) {
      client.uuid = generateUUID();
      changed = true;
    }
    if (changed || !client.synced) {
      await updateLocal('clients', client);
      if (navigator.onLine) {
        await syncUpsert('clients', client);
      }
      hasChanges = true;
    }
  }
  return hasChanges;
}

/**
 * Récupère le dossier complet d'un client et ses animaux/séances depuis Supabase pour le portail distant.
 */
export async function fetchClientPortalData(portalUuid) {
  if (!portalUuid) return null;
  const tokenStr = String(portalUuid).trim();
  
  // 1. Tenter la récupération distante depuis Supabase si connecté
  if (navigator.onLine) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        // Requête directe standard sur la colonne uuid
        let { data: clientData, error: clientErr } = await supabase
          .from('clients')
          .select('*')
          .eq('uuid', tokenStr)
          .maybeSingle();

        // Repli si tokenStr est un ID numérique
        if (!clientData && !isNaN(Number(tokenStr))) {
          const { data: fallbackData } = await supabase
            .from('clients')
            .select('*')
            .eq('id', tokenStr)
            .maybeSingle();
          clientData = fallbackData;
        }

        if (clientData) {
          const localClient = mapSupabaseToLocal('clients', clientData);
          await updateLocal('clients', localClient);

          // Récupérer les animaux associés
          const { data: animalsData } = await supabase.from('animals')
            .select('*')
            .eq('client_id', String(clientData.id));

          if (animalsData && animalsData.length > 0) {
            for (const an of animalsData) {
              await updateLocal('animals', mapSupabaseToLocal('animals', an));
            }
          }

          // Récupérer les séances associées
          const { data: sessionsData } = await supabase.from('sessions')
            .select('*')
            .eq('client_id', String(clientData.id));

          if (sessionsData && sessionsData.length > 0) {
            for (const s of sessionsData) {
              await updateLocal('sessions', mapSupabaseToLocal('sessions', s));
            }
          }

          // Récupérer les rappels/tâches associés
          const { data: tasksData } = await supabase.from('tasks')
            .select('*')
            .eq('client_id', String(clientData.id));

          if (tasksData && tasksData.length > 0) {
            for (const t of tasksData) {
              await updateLocal('reminders', mapSupabaseToLocal('reminders', t));
            }
          }

          return localClient;
        }
      } catch (err) {
        console.warn("fetchClientPortalData distant a échoué:", err);
      }
    }
  }

  // 2. Repli local IndexedDB (mode hors-ligne ou Supabase inaccessible)
  return await getClientByUuid(tokenStr);
}

/**
 * Supprime définitivement un animal et toutes ses données associées (séances, rappels).
 * @param {number} animalId
 */
export async function deleteAnimalCascade(animalId) {
  const anId = Number(animalId);
  if (!anId) return;

  // 1. Supprimer les séances associées
  const allSessions = await getAll('sessions');
  const animalSessions = allSessions.filter(s => Number(s.animal_id) === anId);
  for (const session of animalSessions) {
    await remove('sessions', session.id);
  }

  // 2. Supprimer les rappels associés
  const allReminders = await getAll('reminders');
  const animalReminders = allReminders.filter(r => Number(r.animal_id) === anId || Number(r.relatedAnimalId) === anId);
  for (const reminder of animalReminders) {
    await remove('reminders', reminder.id);
  }

  // 3. Supprimer l'animal
  await remove('animals', anId);
}

/**
 * Supprime définitivement un client et toutes ses données associées en cascade (animaux, séances, rappels).
 * @param {number} clientId
 */
export async function deleteClientCascade(clientId) {
  const cId = Number(clientId);
  if (!cId) return;

  // 1. Récupérer et supprimer tous les animaux associés en cascade
  const allAnimals = await getAll('animals');
  const clientAnimals = allAnimals.filter(a => Number(a.client_id) === cId);
  for (const animal of clientAnimals) {
    await deleteAnimalCascade(animal.id);
  }

  // 2. Supprimer les rappels directement liés au client
  const allReminders = await getAll('reminders');
  const clientReminders = allReminders.filter(r => Number(r.client_id) === cId || Number(r.relatedClientId) === cId);
  for (const reminder of clientReminders) {
    await remove('reminders', reminder.id);
  }

  // 3. Supprimer le client
  await remove('clients', cId);
}

