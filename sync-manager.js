/**
 * sync-manager.js - Module de synchronisation autonome et Offline-First pour Suivi eKiKare
 *
 * Centralise toute la logique réseau/synchro :
 * - Gestion du timestamp local lastSyncTimestamp (localStorage)
 * - pullChanges() : delta via .gt('updated_at', lastSyncTimestamp)
 * - pushPending() : envoi des créations et mises à jour en PATCH partiel strict (scalaires uniquement)
 * - Écouteurs d'événements autonomes (visibilitychange, focus, online, interval 60s, database change callback)
 * - Suppression totale du Realtime
 */

import {
  getSupabaseClient,
  SYNCED_STORES,
  getAll,
  getById,
  updateLocal,
  getTrackedDeletions,
  clearTrackedDeletion,
  mapLocalToSupabase,
  mapSupabaseToLocal,
  reconcileClientUUIDsFromSupabase,
  registerDatabaseChangeCallback
} from './db.js?v=1.5.7';

/**
 * Récupère le client Supabase actif (via window.supabaseClient ou getSupabaseClient)
 */
export function getActiveSupabaseClient() {
  if (typeof window !== 'undefined' && window.supabaseClient) {
    return window.supabaseClient;
  }
  const client = getSupabaseClient();
  if (typeof window !== 'undefined' && client) {
    window.supabaseClient = client;
  }
  return client;
}

// Table mapping : IndexedDB store name -> Supabase remote table name
export function getTableName(storeName) {
  if (storeName === 'reminders') return 'tasks';
  return storeName;
}

// Colonnes scalaires autorisées pour les PATCH partiels (jamais de collections ou tableaux imbriqués)
export const SCALAR_COLUMNS = {
  clients: [
    'first_name',
    'last_name',
    'phone',
    'email',
    'address',
    'main_stable',
    'notes',
    'uuid',
    'archived_at',
    'archive_reason',
    'updated_at'
  ],
  animals: [
    'client_id',
    'name',
    'species',
    'breed',
    'gender',
    'birth_date',
    'photo',
    'stable',
    'housing_type',
    'social_life',
    'work_goals',
    'diet',
    'medical_history',
    'issues',
    'notes',
    'distance_km',
    'tracking_mode',
    'archived_at',
    'archive_reason',
    'updated_at'
  ],
  sessions: [
    'client_id',
    'animal_id',
    'session_type',
    'practitioner_name',
    'practitioner_profession',
    'session_date',
    'reason',
    'protocols',
    'summary',
    'private_clinical_notes',
    'detailed_pro_report',
    'general_notes',
    'anatomical_drawing',
    'attachments',
    'updated_at'
  ],
  professionals: [
    'name',
    'profession',
    'phone',
    'email',
    'notes',
    'updated_at'
  ],
  reminders: [
    'title',
    'due_date',
    'completed',
    'client_id',
    'animal_id',
    'related_client_id',
    'related_animal_id',
    'updated_at'
  ]
};

const STORAGE_KEY_LAST_SYNC = 'ekikare_last_sync_timestamp';

let isSyncing = false;
let initDone = false;
let isUnlockedFn = null;
let onSyncStatusCallback = null;
let onDataChangedCallback = null;

/**
 * Construit un payload contenant STRICTEMENT des colonnes scalaires pour un UPDATE/PATCH partiel.
 * Écarte tout tableau, collection imbriquée ou objet complexe.
 */
export function buildScalarPatch(storeName, record) {
  const mapped = mapLocalToSupabase(storeName, record) || {};
  const allowedKeys = SCALAR_COLUMNS[storeName] || Object.keys(mapped);
  const patch = {};

  for (const key of allowedKeys) {
    if (mapped[key] !== undefined) {
      const val = mapped[key];
      // Vérifier que la valeur est strictement scalaire (string, number, boolean, ou null)
      if (val === null || typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        if (!Array.isArray(val)) {
          patch[key] = val;
        }
      }
    }
  }

  // Horodatage ISO systématique de la mise à jour
  patch.updated_at = new Date().toISOString();
  return patch;
}

export const SyncManager = {
  /**
   * Récupère le timestamp de la dernière synchronisation réussie
   */
  getLastSyncTimestamp() {
    return localStorage.getItem(STORAGE_KEY_LAST_SYNC) || null;
  },

  /**
   * Met à jour le timestamp de la dernière synchronisation
   */
  setLastSyncTimestamp(isoTimestamp) {
    if (isoTimestamp) {
      localStorage.setItem(STORAGE_KEY_LAST_SYNC, isoTimestamp);
    } else {
      localStorage.removeItem(STORAGE_KEY_LAST_SYNC);
    }
  },

  /**
   * Pousse vers Supabase les éléments créés ou modifiés localement en mode hors-ligne.
   * Règle d'or : Les mises à jour distantes se font exclusivement en PATCH partiel scalaire.
   */
  async pushPending() {
    const supabase = getActiveSupabaseClient();
    if (!supabase) return;

    // 1. Pousser les suppressions en attente
    try {
      const deletions = await getTrackedDeletions();
      for (const del of deletions) {
        const table = getTableName(del.storeName);
        try {
          const { error } = await supabase.from(table).delete().eq('id', String(del.recordId));
          if (!error) {
            await clearTrackedDeletion(del.id);
          } else {
            console.warn(`[SyncManager] Erreur suppression distante (${table}):`, error.message || error);
          }
        } catch (delErr) {
          console.warn(`[SyncManager] Exception suppression distante (${table}):`, delErr);
        }
      }
    } catch (err) {
      console.warn('[SyncManager] Erreur lecture suppressions tracées:', err);
    }

    // 2. Pousser les modifications locales non synchronisées (synced === 0)
    for (const storeName of SYNCED_STORES) {
      const table = getTableName(storeName);
      try {
        const localRecords = await getAll(storeName);
        const unsynced = localRecords.filter(r => r.synced === 0);

        for (const record of unsynced) {
          try {
            // Vérifier si l'enregistrement existe déjà côté Supabase
            const { data: remoteExisting } = await supabase
              .from(table)
              .select('id')
              .eq('id', String(record.id))
              .maybeSingle();

            let error = null;

            if (remoteExisting) {
              // ENREGISTREMENT EXISTANT : PATCH partiel strict des colonnes scalaires
              const patchPayload = buildScalarPatch(storeName, record);
              const res = await supabase
                .from(table)
                .update(patchPayload)
                .eq('id', String(record.id));
              error = res.error;
            } else {
              // NOUVEL ENREGISTREMENT CRÉÉ HORS-LIGNE : Insertion / Upsert formaté
              const insertPayload = mapLocalToSupabase(storeName, record);
              // Nettoyer les éventuels tableaux non supportés pour 'animals' ou colonnes directes
              if (storeName === 'animals' && insertPayload && typeof insertPayload.custom_details === 'object') {
                insertPayload.custom_details = JSON.stringify(insertPayload.custom_details);
              }
              const res = await supabase.from(table).upsert(insertPayload);
              error = res.error;
            }

            if (!error) {
              record.synced = 1;
              await updateLocal(storeName, record);
            } else {
              console.warn(`[SyncManager] Erreur push (${table} id=${record.id}):`, error.message || error);
            }
          } catch (recordErr) {
            console.warn(`[SyncManager] Exception push (${table} id=${record.id}):`, recordErr);
          }
        }
      } catch (storeErr) {
        console.warn(`[SyncManager] Erreur store (${storeName}):`, storeErr);
      }
    }
  },

  /**
   * Récupère depuis Supabase les modifications distantes (.gt('updated_at', lastSyncTimestamp))
   * et les fusionne dans IndexedDB.
   * @returns {Promise<boolean>} true si au moins une donnée a changé localement
   */
  async pullChanges() {
    const supabase = getActiveSupabaseClient();
    if (!supabase) return false;

    const lastSync = this.getLastSyncTimestamp();
    let hasChanges = false;

    for (const storeName of SYNCED_STORES) {
      const table = getTableName(storeName);
      try {
        let query = supabase.from(table).select('*');

        // Récupération delta si un timestamp existe déjà
        if (lastSync) {
          query = query.gt('updated_at', lastSync);
        }

        const { data: remoteRecords, error } = await query;
        if (error) {
          console.warn(`[SyncManager] Erreur pull (${table}):`, error.message || error);
          continue;
        }

        if (remoteRecords && remoteRecords.length > 0) {
          for (const remoteRec of remoteRecords) {
            const mapped = mapSupabaseToLocal(storeName, remoteRec);
            if (!mapped || !mapped.id) continue;

            // Conversion de la clé primaire en Number si numérique
            if (remoteRec.id && !isNaN(Number(remoteRec.id))) {
              mapped.id = Number(remoteRec.id);
            }

            // Conversion des clés étrangères associées si présentes
            if (mapped.client_id && !isNaN(Number(mapped.client_id))) {
              mapped.client_id = Number(mapped.client_id);
            }
            if (mapped.patient_id && !isNaN(Number(mapped.patient_id))) {
              mapped.patient_id = Number(mapped.patient_id);
            }
            if (mapped.animal_id && !isNaN(Number(mapped.animal_id))) {
              mapped.animal_id = Number(mapped.animal_id);
            }

            const localRec = await getById(storeName, mapped.id);

            if (!localRec) {
              // Nouvel enregistrement distant
              mapped.synced = 1;
              await updateLocal(storeName, mapped);
              hasChanges = true;
            } else {
              // Enregistrement déjà existant en local : réconciliation
              const localTime = new Date(localRec.updated_at || localRec.last_modified || 0).getTime();
              const remoteTime = new Date(remoteRec.updated_at || remoteRec.last_modified || 0).getTime();

              // Accepter l'égalité seulement si localRec n'a pas de modif en attente (synced === 1)
              if ((localRec.synced === 1 && remoteTime >= localTime) || remoteTime > localTime) {
                mapped.synced = 1;
                if (storeName === 'clients' && !mapped.uuid && localRec.uuid) {
                  mapped.uuid = localRec.uuid;
                }
                await updateLocal(storeName, mapped);
                hasChanges = true;
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[SyncManager] Exception pull (${table}):`, err);
      }
    }

    // Réconciliation des UUIDs clients avec Supabase si nécessaire
    try {
      await reconcileClientUUIDsFromSupabase();
    } catch (e) {
      // Ignorer si échec ponctuel
    }

    return hasChanges;
  },

  /**
   * Déclenche un cycle complet de synchronisation (pushPending puis pullChanges).
   * @param {Object} options { silent: boolean }
   */
  async triggerSync(options = {}) {
    const isSilent = Boolean(options && options.silent);

    if (isSyncing) return;

    if (!navigator.onLine) {
      if (!isSilent && onSyncStatusCallback) onSyncStatusCallback('offline');
      return;
    }

    // Vérification de sécurité : si praticien verrouillé, ne pas synchroniser les données complètes
    if (typeof isUnlockedFn === 'function' && !isUnlockedFn()) {
      return;
    }

    const supabase = getActiveSupabaseClient();
    if (!supabase) {
      if (!isSilent && onSyncStatusCallback) onSyncStatusCallback('offline');
      return;
    }

    isSyncing = true;
    if (!isSilent && onSyncStatusCallback) onSyncStatusCallback('syncing');

    try {
      // 1. Envoyer les modifications locales en attente (évite tout écrasement par le pull)
      await this.pushPending();

      // 2. Récupérer les modifications distantes depuis la dernière synchronisation
      const hasChanges = await this.pullChanges();

      // 3. Mettre à jour le timestamp de dernière synchro réussie
      this.setLastSyncTimestamp(new Date().toISOString());

      // 4. Mettre à jour le statut UI
      if (!isSilent && onSyncStatusCallback) onSyncStatusCallback('online');

      // 5. Rafraîchir l'interface si des données ont changé
      if (hasChanges && typeof onDataChangedCallback === 'function') {
        await onDataChangedCallback();
      }
    } catch (err) {
      console.error('[SyncManager] Erreur cycle de synchro:', err);
      if (!isSilent && onSyncStatusCallback) {
        onSyncStatusCallback(navigator.onLine ? 'online' : 'offline');
      }
    } finally {
      isSyncing = false;
    }
  },

  /**
   * Initialise le gestionnaire de synchronisation et branche les écouteurs d'événements autonomes.
   * @param {Object} options { isUnlocked: Function, onSyncStatus: Function, onDataChanged: Function }
   */
  init(options = {}) {
    if (initDone) return;
    initDone = true;

    if (typeof options.isUnlocked === 'function') {
      isUnlockedFn = options.isUnlocked;
    }
    if (typeof options.onSyncStatus === 'function') {
      onSyncStatusCallback = options.onSyncStatus;
    }
    if (typeof options.onDataChanged === 'function') {
      onDataChangedCallback = options.onDataChanged;
    }

    // 1. Retour de visibilité de l'onglet
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        SyncManager.triggerSync({ silent: true });
      }
    });

    // 2. Reprise de focus sur la fenêtre
    window.addEventListener('focus', () => {
      SyncManager.triggerSync({ silent: true });
    });

    // 3. Reconnexion réseau
    window.addEventListener('online', () => {
      SyncManager.triggerSync({ silent: false });
    });

    // 4. Perte réseau
    window.addEventListener('offline', () => {
      if (onSyncStatusCallback) onSyncStatusCallback('offline');
    });

    // 5. Intervalle régulier de 60 secondes en arrière-plan
    setInterval(() => {
      if (!document.hidden && navigator.onLine) {
        SyncManager.triggerSync({ silent: true });
      }
    }, 60000);

    // 6. Déclenchement automatique lors d'une écriture locale dans IndexedDB
    registerDatabaseChangeCallback(() => {
      if (navigator.onLine) {
        SyncManager.triggerSync({ silent: true });
      }
    });

    // Initialiser l'affichage UI
    if (onSyncStatusCallback) {
      onSyncStatusCallback(navigator.onLine ? 'online' : 'offline');
    }

    // Exposer globalement pour débogage et rétrocompatibilité
    window.SyncManager = SyncManager;
    window.syncData = (opts) => SyncManager.triggerSync(opts);
  }
};

// Exposition globale immédiate du module
if (typeof window !== 'undefined') {
  window.SyncManager = SyncManager;
}
