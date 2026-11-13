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
  removeLocal,
  getTrackedDeletions,
  clearTrackedDeletion,
  mapLocalToSupabase,
  mapSupabaseToLocal,
  reconcileClientUUIDsFromSupabase,
  registerDatabaseChangeCallback
} from './db.js?v=1.8.3';

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
    'cgv_rgpd_accepted',
    'cgv_rgpd_accepted_at',
    'cgv_rgpd_version',
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
    'custom_details',
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
    'description',
    'due_date',
    'completed',
    'client_id',
    'animal_id',
    'related_client_id',
    'related_animal_id',
    'updated_at'
  ],
  settings: [
    'key',
    'value',
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
      } else if (key === 'custom_details' && typeof val === 'object' && !Array.isArray(val)) {
        patch[key] = JSON.stringify(val);
      }
    }
  }

  // Pour la table animals, s'assurer que custom_details utilise directement la sérialisation issue de mapLocalToSupabase
  if (storeName === 'animals') {
    if (mapped.custom_details !== undefined && mapped.custom_details !== null) {
      patch.custom_details = typeof mapped.custom_details === 'string'
        ? mapped.custom_details
        : JSON.stringify(mapped.custom_details);
    }
  }

  // Horodatage ISO systématique de la mise à jour
  patch.updated_at = new Date().toISOString();
  return patch;
}

/**
 * Cascade la mise à jour d'un client_id suite à confirmation ou réattribution d'ID par Supabase.
 */
async function cascadeClientIdUpdate(oldClientId, newClientId) {
  if (oldClientId === newClientId || !oldClientId || !newClientId) return;
  const oldIdStr = String(oldClientId);
  const newIdNum = Number(newClientId);

  // 1. Mettre à jour les animaux correspondants dans IndexedDB
  try {
    const localAnimals = await getAll('animals');
    for (const animal of localAnimals) {
      if (String(animal.client_id) === oldIdStr) {
        animal.client_id = newIdNum;
        animal.synced = 0; // Laisser synced: 0 pour qu'il soit poussé avec la bonne clé
        await updateLocal('animals', animal);
      }
    }
  } catch (err) {
    console.warn(`[SyncManager] Erreur cascade animals pour client ${oldClientId}->${newClientId}:`, err);
  }

  // 2. Mettre à jour les séances correspondantes dans IndexedDB
  try {
    const localSessions = await getAll('sessions');
    for (const session of localSessions) {
      if (String(session.client_id) === oldIdStr) {
        session.client_id = newIdNum;
        session.synced = 0;
        await updateLocal('sessions', session);
      }
    }
  } catch (err) {
    console.warn(`[SyncManager] Erreur cascade sessions pour client ${oldClientId}->${newClientId}:`, err);
  }

  // 3. Mettre à jour les rappels correspondants dans IndexedDB
  try {
    const localReminders = await getAll('reminders');
    for (const rem of localReminders) {
      let changed = false;
      if (String(rem.client_id) === oldIdStr) {
        rem.client_id = newIdNum;
        rem.synced = 0;
        changed = true;
      }
      if (String(rem.related_client_id) === oldIdStr) {
        rem.related_client_id = newIdNum;
        rem.synced = 0;
        changed = true;
      }
      if (changed) {
        await updateLocal('reminders', rem);
      }
    }
  } catch (err) {
    console.warn(`[SyncManager] Erreur cascade reminders pour client ${oldClientId}->${newClientId}:`, err);
  }
}

/**
 * Cascade la mise à jour d'un animal_id suite à confirmation ou réattribution d'ID par Supabase.
 */
async function cascadeAnimalIdUpdate(oldAnimalId, newAnimalId) {
  if (oldAnimalId === newAnimalId || !oldAnimalId || !newAnimalId) return;
  const oldIdStr = String(oldAnimalId);
  const newIdNum = Number(newAnimalId);

  // 1. Mettre à jour les séances correspondantes dans IndexedDB
  try {
    const localSessions = await getAll('sessions');
    for (const session of localSessions) {
      if (String(session.animal_id) === oldIdStr) {
        session.animal_id = newIdNum;
        session.synced = 0; // Laisser synced: 0 pour qu'elle soit poussée avec le bon animal_id
        await updateLocal('sessions', session);
      }
    }
  } catch (err) {
    console.warn(`[SyncManager] Erreur cascade sessions pour animal ${oldAnimalId}->${newAnimalId}:`, err);
  }

  // 2. Mettre à jour les rappels correspondants dans IndexedDB
  try {
    const localReminders = await getAll('reminders');
    for (const rem of localReminders) {
      let changed = false;
      if (String(rem.animal_id) === oldIdStr) {
        rem.animal_id = newIdNum;
        rem.synced = 0;
        changed = true;
      }
      if (String(rem.related_animal_id) === oldIdStr) {
        rem.related_animal_id = newIdNum;
        rem.synced = 0;
        changed = true;
      }
      if (changed) {
        await updateLocal('reminders', rem);
      }
    }
  } catch (err) {
    console.warn(`[SyncManager] Erreur cascade reminders pour animal ${oldAnimalId}->${newAnimalId}:`, err);
  }
}

/**
 * Cascade la mise à jour d'un session_id suite à confirmation ou réattribution d'ID par Supabase.
 */
async function cascadeSessionIdUpdate(oldSessionId, newSessionId) {
  if (oldSessionId === newSessionId || !oldSessionId || !newSessionId) return;
  const oldIdStr = String(oldSessionId);
  const newIdNum = Number(newSessionId);

  try {
    const localReminders = await getAll('reminders');
    for (const rem of localReminders) {
      if (String(rem.session_id) === oldIdStr) {
        rem.session_id = newIdNum;
        await updateLocal('reminders', rem);
      }
    }
  } catch (err) {
    console.warn(`[SyncManager] Erreur cascade reminders pour session ${oldSessionId}->${newSessionId}:`, err);
  }
}

/**
 * Cascade la mise à jour d'un professional_id suite à confirmation ou réattribution d'ID par Supabase.
 */
async function cascadeProfessionalIdUpdate(oldProfId, newProfId) {
  if (oldProfId === newProfId || !oldProfId || !newProfId) return;
  const oldIdStr = String(oldProfId);
  const newIdNum = Number(newProfId);

  try {
    const localAnimals = await getAll('animals');
    for (const animal of localAnimals) {
      if (Array.isArray(animal.pros_associes_ids) && animal.pros_associes_ids.some(id => String(id) === oldIdStr)) {
        animal.pros_associes_ids = animal.pros_associes_ids.map(id => String(id) === oldIdStr ? newIdNum : id);
        await updateLocal('animals', animal);
      }
    }
  } catch (err) {
    console.warn(`[SyncManager] Erreur cascade animals pour pro ${oldProfId}->${newProfId}:`, err);
  }
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
   * Règle d'or :
   * - Mises à jour en PATCH partiel scalaire.
   * - Insertions explicites sécurisées pour les nouveaux éléments créés hors-ligne.
   * - Cascade immédiate des IDs confirmés par Supabase vers les tables enfants pour éviter l'erreur FK 23503.
   * @returns {Promise<boolean>} true si au moins une modification locale a été opérée (cascade/réconciliation)
   */
  async pushPending() {
    const supabase = getActiveSupabaseClient();
    if (!supabase) return false;
    let anyChanges = false;

    // 1. Pousser les suppressions en attente
    try {
      const deletions = await getTrackedDeletions();
      for (const del of deletions) {
        const table = getTableName(del.storeName);
        try {
          const { error } = await supabase.from(table).delete().eq('id', String(del.recordId));
          if (!error) {
            await clearTrackedDeletion(del.id);
            anyChanges = true;
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

    // 2. Pousser les clients en attente de synchronisation
    try {
      const localClients = await getAll('clients');
      const unsyncedClients = localClients.filter(c => c.synced === 0);

      for (const client of unsyncedClients) {
        try {
          const oldLocalId = Number(client.id);

          // A. Vérifier l'existence distante par son ID (ou UUID s'il existe)
          let remoteExisting = null;
          if (client.id && !isNaN(Number(client.id))) {
            const { data: existing } = await supabase
              .from('clients')
              .select('id')
              .eq('id', String(client.id))
              .maybeSingle();
            if (existing) remoteExisting = existing;
          }

          if (!remoteExisting && client.uuid) {
            const { data: byUuid } = await supabase
              .from('clients')
              .select('id')
              .eq('uuid', client.uuid)
              .maybeSingle();
            if (byUuid) remoteExisting = byUuid;
          }

          if (remoteExisting) {
            // ENREGISTREMENT EXISTANT : PATCH partiel strict
            const remoteId = Number(remoteExisting.id);
            const patchPayload = buildScalarPatch('clients', client);
            const { error: updateErr } = await supabase
              .from('clients')
              .update(patchPayload)
              .eq('id', String(remoteId));

            if (!updateErr) {
              client.synced = 1;
              if (remoteId !== oldLocalId) {
                console.log(`[SyncManager] Réconciliation client : ID local ${oldLocalId} -> ID distant ${remoteId}`);
                await removeLocal('clients', oldLocalId);
                client.id = remoteId;
                await updateLocal('clients', client);
                await cascadeClientIdUpdate(oldLocalId, remoteId);
                anyChanges = true;
              } else {
                await updateLocal('clients', client);
              }
            } else {
              console.warn(`[SyncManager] Erreur update client #${client.id}:`, updateErr.message || updateErr);
            }
          } else {
            // NOUVEAU CLIENT CRÉÉ HORS-LIGNE : Insertion explicite (FORCER INSERT)
            const insertPayload = mapLocalToSupabase('clients', client);
            let insertRes = await supabase
              .from('clients')
              .insert(insertPayload)
              .select()
              .single();

            // Si échec avec l'ID local (conflit de clé primaire ou auto-increment identity), retenter sans le champ 'id'
            if (insertRes.error) {
              console.warn(`[SyncManager] Tentative insertion client id=${client.id} rejetée (${insertRes.error.message}), insertion avec ID auto-généré...`);
              const payloadNoId = { ...insertPayload };
              delete payloadNoId.id;
              insertRes = await supabase
                .from('clients')
                .insert(payloadNoId)
                .select()
                .single();
            }

            if (!insertRes.error && insertRes.data) {
              const remoteId = Number(insertRes.data.id);
              client.synced = 1;
              if (insertRes.data.uuid && !client.uuid) {
                client.uuid = insertRes.data.uuid;
              }
              if (remoteId !== oldLocalId) {
                console.log(`[SyncManager] Nouveau client confirmé sur Supabase : ID local ${oldLocalId} -> ID Supabase ${remoteId}`);
                await removeLocal('clients', oldLocalId);
                client.id = remoteId;
                await updateLocal('clients', client);
                await cascadeClientIdUpdate(oldLocalId, remoteId);
                anyChanges = true;
              } else {
                await updateLocal('clients', client);
              }
            } else if (insertRes.error) {
              console.warn(`[SyncManager] Erreur insertion nouveau client (${client.id}):`, insertRes.error.message || insertRes.error);
            }
          }
        } catch (clientErr) {
          console.warn(`[SyncManager] Exception push client (${client.id}):`, clientErr);
        }
      }
    } catch (errClients) {
      console.warn('[SyncManager] Erreur store clients:', errClients);
    }

    // 3. Pousser les professionnels en attente
    try {
      const localProfs = await getAll('professionals');
      const unsyncedProfs = localProfs.filter(p => p.synced === 0);

      for (const prof of unsyncedProfs) {
        try {
          const oldLocalId = Number(prof.id);
          let remoteExisting = null;
          if (prof.id && !isNaN(Number(prof.id))) {
            const { data: byId } = await supabase
              .from('professionals')
              .select('id')
              .eq('id', String(prof.id))
              .maybeSingle();
            if (byId) remoteExisting = byId;
          }

          if (remoteExisting) {
            const remoteId = Number(remoteExisting.id);
            const patchPayload = buildScalarPatch('professionals', prof);
            const { error: updateErr } = await supabase
              .from('professionals')
              .update(patchPayload)
              .eq('id', String(remoteId));

            if (!updateErr) {
              prof.synced = 1;
              if (remoteId !== oldLocalId) {
                await removeLocal('professionals', oldLocalId);
                prof.id = remoteId;
                await updateLocal('professionals', prof);
                await cascadeProfessionalIdUpdate(oldLocalId, remoteId);
                anyChanges = true;
              } else {
                await updateLocal('professionals', prof);
              }
            } else {
              console.warn(`[SyncManager] Erreur update pro #${prof.id}:`, updateErr.message || updateErr);
            }
          } else {
            const insertPayload = mapLocalToSupabase('professionals', prof);
            let insertRes = await supabase
              .from('professionals')
              .insert(insertPayload)
              .select('id')
              .single();

            if (insertRes.error) {
              const payloadNoId = { ...insertPayload };
              delete payloadNoId.id;
              insertRes = await supabase
                .from('professionals')
                .insert(payloadNoId)
                .select('id')
                .single();
            }

            if (!insertRes.error && insertRes.data) {
              const remoteId = Number(insertRes.data.id);
              prof.synced = 1;
              if (remoteId !== oldLocalId) {
                await removeLocal('professionals', oldLocalId);
                prof.id = remoteId;
                await updateLocal('professionals', prof);
                await cascadeProfessionalIdUpdate(oldLocalId, remoteId);
                anyChanges = true;
              } else {
                await updateLocal('professionals', prof);
              }
            } else if (insertRes.error) {
              console.warn(`[SyncManager] Erreur insertion pro (${prof.id}):`, insertRes.error.message || insertRes.error);
            }
          }
        } catch (profErr) {
          console.warn(`[SyncManager] Exception push pro (${prof.id}):`, profErr);
        }
      }
    } catch (errProfs) {
      console.warn('[SyncManager] Erreur store professionals:', errProfs);
    }

    // 4. Pousser les animaux en attente (avec client_id désormais à jour et validé sur Supabase)
    try {
      const localAnimals = await getAll('animals');
      const unsyncedAnimals = localAnimals.filter(a => a.synced === 0);

      for (const animal of unsyncedAnimals) {
        try {
          const oldLocalId = Number(animal.id);

          // Sécurité stricte FK : vérifier que client_id existe sur Supabase
          if (!animal.client_id) {
            console.warn(`[SyncManager] Report du push de l'animal #${animal.id} : client_id absent.`);
            continue;
          }

          let { data: remoteClientCheck } = await supabase
            .from('clients')
            .select('id')
            .eq('id', String(animal.client_id))
            .maybeSingle();

          if (!remoteClientCheck) {
            // Tenter de retrouver le client local pour voir s'il doit être inséré d'urgence
            const localClient = await getById('clients', animal.client_id);
            if (localClient) {
              console.log(`[SyncManager] Client local #${animal.client_id} trouvé mais absent de Supabase. Tentative d'insertion d'urgence...`);
              const clientPayload = mapLocalToSupabase('clients', localClient);
              let cInsertRes = await supabase.from('clients').insert(clientPayload).select().single();
              if (cInsertRes.error) {
                const cPayloadNoId = { ...clientPayload };
                delete cPayloadNoId.id;
                cInsertRes = await supabase.from('clients').insert(cPayloadNoId).select().single();
              }
              if (!cInsertRes.error && cInsertRes.data) {
                const newCId = Number(cInsertRes.data.id);
                const oldCId = Number(localClient.id);
                localClient.synced = 1;
                if (newCId !== oldCId) {
                  await removeLocal('clients', oldCId);
                  localClient.id = newCId;
                  await updateLocal('clients', localClient);
                  await cascadeClientIdUpdate(oldCId, newCId);
                  animal.client_id = newCId;
                } else {
                  await updateLocal('clients', localClient);
                }
                anyChanges = true;
                remoteClientCheck = { id: String(newCId) };
              } else {
                console.warn(`[SyncManager] Client #${animal.client_id} non créé sur Supabase. Interruption envoi animal #${animal.id} pour ce cycle.`);
                continue; // Bloquer l'envoi de cet animal pour ce cycle !
              }
            } else {
              console.warn(`[SyncManager] Report du push de l'animal #${animal.id} (${animal.nom || animal.name}) : client_id=${animal.client_id} inexistant sur Supabase.`);
              continue; // Bloquer l'envoi de cet animal pour ce cycle !
            }
          }

          let remoteExisting = null;
          if (animal.id && !isNaN(Number(animal.id))) {
            const { data: byId } = await supabase
              .from('animals')
              .select('id, client_id, name')
              .eq('id', String(animal.id))
              .maybeSingle();

            if (byId && String(byId.client_id) === String(animal.client_id)) {
              remoteExisting = byId;
            }
          }

          if (remoteExisting) {
            const remoteId = Number(remoteExisting.id);
            const patchPayload = buildScalarPatch('animals', animal);
            const { error: updateErr } = await supabase
              .from('animals')
              .update(patchPayload)
              .eq('id', String(remoteId));

            if (!updateErr) {
              animal.synced = 1;
              if (remoteId !== oldLocalId) {
                await removeLocal('animals', oldLocalId);
                animal.id = remoteId;
                await updateLocal('animals', animal);
                await cascadeAnimalIdUpdate(oldLocalId, remoteId);
                anyChanges = true;
              } else {
                await updateLocal('animals', animal);
              }
            } else {
              console.warn(`[SyncManager] Erreur update animal #${animal.id}:`, updateErr.message || updateErr);
            }
          } else {
            const insertPayload = mapLocalToSupabase('animals', animal);
            if (insertPayload && typeof insertPayload.custom_details === 'object') {
              insertPayload.custom_details = JSON.stringify(insertPayload.custom_details);
            }
            insertPayload.client_id = String(animal.client_id);

            let insertRes = await supabase
              .from('animals')
              .insert(insertPayload)
              .select('id')
              .single();

            if (insertRes.error) {
              console.warn(`[SyncManager] Tentative insertion animal id=${animal.id} rejetée (${insertRes.error.message}), insertion avec ID auto-généré...`);
              const payloadNoId = { ...insertPayload };
              delete payloadNoId.id;
              insertRes = await supabase
                .from('animals')
                .insert(payloadNoId)
                .select('id')
                .single();
            }

            if (!insertRes.error && insertRes.data) {
              const remoteId = Number(insertRes.data.id);
              animal.synced = 1;
              if (remoteId !== oldLocalId) {
                console.log(`[SyncManager] Nouvel animal confirmé sur Supabase : ID local ${oldLocalId} -> ID Supabase ${remoteId}`);
                await removeLocal('animals', oldLocalId);
                animal.id = remoteId;
                await updateLocal('animals', animal);
                await cascadeAnimalIdUpdate(oldLocalId, remoteId);
                anyChanges = true;
              } else {
                await updateLocal('animals', animal);
              }
            } else if (insertRes.error) {
              console.warn(`[SyncManager] Erreur insertion animal (${animal.id}):`, insertRes.error.message || insertRes.error);
            }
          }
        } catch (animalErr) {
          console.warn(`[SyncManager] Exception push animal (${animal.id}):`, animalErr);
        }
      }
    } catch (errAnimals) {
      console.warn('[SyncManager] Erreur store animals:', errAnimals);
    }

    // 5. Pousser les séances en attente (avec animal_id désormais à jour et validé sur Supabase)
    try {
      const localSessions = await getAll('sessions');
      const unsyncedSessions = localSessions.filter(s => s.synced === 0);

      for (const session of unsyncedSessions) {
        try {
          const oldLocalId = Number(session.id);

          // Sécurité stricte FK : vérifier que animal_id existe sur Supabase
          if (!session.animal_id) {
            console.warn(`[SyncManager] Report du push de la séance #${session.id} : animal_id absent.`);
            continue;
          }

          const { data: remoteAnimalCheck } = await supabase
            .from('animals')
            .select('id')
            .eq('id', String(session.animal_id))
            .maybeSingle();

          if (!remoteAnimalCheck) {
            console.warn(`[SyncManager] Report du push de la séance #${session.id} : animal_id=${session.animal_id} inexistant sur Supabase.`);
            continue; // Ne pas pousser pour éviter l'erreur 23503 !
          }

          // Sécurité stricte FK : vérifier que client_id existe sur Supabase si présent
          if (session.client_id) {
            const { data: remoteClientCheck } = await supabase
              .from('clients')
              .select('id')
              .eq('id', String(session.client_id))
              .maybeSingle();

            if (!remoteClientCheck) {
              console.warn(`[SyncManager] Report du push de la séance #${session.id} : client_id=${session.client_id} inexistant sur Supabase.`);
              continue; // Ne pas pousser pour éviter l'erreur 23503 !
            }
          }

          let remoteExisting = null;
          if (session.id && !isNaN(Number(session.id))) {
            const { data: byId } = await supabase
              .from('sessions')
              .select('id, animal_id, client_id')
              .eq('id', String(session.id))
              .maybeSingle();

            if (byId && (!session.animal_id || String(byId.animal_id) === String(session.animal_id))) {
              remoteExisting = byId;
            }
          }

          if (remoteExisting) {
            const remoteId = Number(remoteExisting.id);
            const patchPayload = buildScalarPatch('sessions', session);
            const { error: updateErr } = await supabase
              .from('sessions')
              .update(patchPayload)
              .eq('id', String(remoteId));

            if (!updateErr) {
              session.synced = 1;
              if (remoteId !== oldLocalId) {
                await removeLocal('sessions', oldLocalId);
                session.id = remoteId;
                await updateLocal('sessions', session);
                await cascadeSessionIdUpdate(oldLocalId, remoteId);
                anyChanges = true;
              } else {
                await updateLocal('sessions', session);
              }
            } else {
              console.warn(`[SyncManager] Erreur update séance #${session.id}:`, updateErr.message || updateErr);
            }
          } else {
            const insertPayload = mapLocalToSupabase('sessions', session);
            if (session.animal_id) insertPayload.animal_id = String(session.animal_id);
            if (session.client_id) insertPayload.client_id = String(session.client_id);

            let insertRes = await supabase
              .from('sessions')
              .insert(insertPayload)
              .select('id')
              .single();

            if (insertRes.error) {
              console.warn(`[SyncManager] Tentative insertion séance id=${session.id} rejetée (${insertRes.error.message}), insertion avec ID auto-généré...`);
              const payloadNoId = { ...insertPayload };
              delete payloadNoId.id;
              insertRes = await supabase
                .from('sessions')
                .insert(payloadNoId)
                .select('id')
                .single();
            }

            if (!insertRes.error && insertRes.data) {
              const remoteId = Number(insertRes.data.id);
              session.synced = 1;
              if (remoteId !== oldLocalId) {
                console.log(`[SyncManager] Nouvelle séance confirmée sur Supabase : ID local ${oldLocalId} -> ID Supabase ${remoteId}`);
                await removeLocal('sessions', oldLocalId);
                session.id = remoteId;
                await updateLocal('sessions', session);
                await cascadeSessionIdUpdate(oldLocalId, remoteId);
                anyChanges = true;
              } else {
                await updateLocal('sessions', session);
              }
            } else if (insertRes.error) {
              console.warn(`[SyncManager] Erreur insertion séance (${session.id}):`, insertRes.error.message || insertRes.error);
            }
          }
        } catch (sessionErr) {
          console.warn(`[SyncManager] Exception push séance (${session.id}):`, sessionErr);
        }
      }
    } catch (errSessions) {
      console.warn('[SyncManager] Erreur store sessions:', errSessions);
    }

    // 6. Pousser les rappels en attente
    try {
      const localReminders = await getAll('reminders');
      const unsyncedReminders = localReminders.filter(r => r.synced === 0);

      for (const reminder of unsyncedReminders) {
        try {
          const oldLocalId = Number(reminder.id);

          // Sécurité FK : si client_id ou animal_id sont spécifiés, vérifier qu'ils existent sur Supabase
          if (reminder.client_id) {
            const { data: cCheck } = await supabase.from('clients').select('id').eq('id', String(reminder.client_id)).maybeSingle();
            if (!cCheck) continue;
          }
          if (reminder.animal_id && reminder.animal_id !== 'ALL' && !isNaN(Number(reminder.animal_id))) {
            const { data: aCheck } = await supabase.from('animals').select('id').eq('id', String(reminder.animal_id)).maybeSingle();
            if (!aCheck) continue;
          }

          let remoteExisting = null;
          if (reminder.id && !isNaN(Number(reminder.id))) {
            const { data: byId } = await supabase
              .from('tasks')
              .select('id')
              .eq('id', String(reminder.id))
              .maybeSingle();
            if (byId) remoteExisting = byId;
          }

          if (remoteExisting) {
            const remoteId = Number(remoteExisting.id);
            const patchPayload = buildScalarPatch('reminders', reminder);
            const { error: updateErr } = await supabase
              .from('tasks')
              .update(patchPayload)
              .eq('id', String(remoteId));

            if (!updateErr) {
              reminder.synced = 1;
              if (remoteId !== oldLocalId) {
                await removeLocal('reminders', oldLocalId);
                reminder.id = remoteId;
                await updateLocal('reminders', reminder);
                anyChanges = true;
              } else {
                await updateLocal('reminders', reminder);
              }
            } else {
              console.warn(`[SyncManager] Erreur update rappel #${reminder.id}:`, updateErr.message || updateErr);
            }
          } else {
            const insertPayload = mapLocalToSupabase('reminders', reminder);
            let insertRes = await supabase
              .from('tasks')
              .insert(insertPayload)
              .select('id')
              .single();

            if (insertRes.error) {
              const payloadNoId = { ...insertPayload };
              delete payloadNoId.id;
              insertRes = await supabase
                .from('tasks')
                .insert(payloadNoId)
                .select('id')
                .single();
            }

            if (!insertRes.error && insertRes.data) {
              const remoteId = Number(insertRes.data.id);
              reminder.synced = 1;
              if (remoteId !== oldLocalId) {
                await removeLocal('reminders', oldLocalId);
                reminder.id = remoteId;
                await updateLocal('reminders', reminder);
                anyChanges = true;
              } else {
                await updateLocal('reminders', reminder);
              }
            } else if (insertRes.error) {
              console.warn(`[SyncManager] Erreur insertion rappel (${reminder.id}):`, insertRes.error.message || insertRes.error);
            }
          }
        } catch (remErr) {
          console.warn(`[SyncManager] Exception push rappel (${reminder.id}):`, remErr);
        }
      }
    } catch (errReminders) {
      console.warn('[SyncManager] Erreur store reminders:', errReminders);
    }

    // 7. Pousser les paramètres en attente
    try {
      const localSettings = await getAll('settings');
      const unsyncedSettings = localSettings.filter(s => s.synced === 0);

      for (const setting of unsyncedSettings) {
        try {
          const insertPayload = {
            key: String(setting.key),
            value: typeof setting.value === 'object' && setting.value !== null ? JSON.stringify(setting.value) : String(setting.value ?? ''),
            updated_at: new Date().toISOString()
          };
          const { error } = await supabase.from('settings').upsert(insertPayload);
          if (!error) {
            setting.synced = 1;
            await updateLocal('settings', setting);
            anyChanges = true;
          } else {
            console.warn(`[SyncManager] Erreur push setting (${setting.key}):`, error.message || error);
          }
        } catch (sErr) {
          console.warn(`[SyncManager] Exception push setting (${setting.key}):`, sErr);
        }
      }
    } catch (errSettings) {
      console.warn('[SyncManager] Erreur store settings:', errSettings);
    }

    return anyChanges;
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
    let clientsUpdated = false;

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
            if (!mapped) continue;

            // Gestion spécifique du store 'settings' (clé primaire 'key')
            if (storeName === 'settings') {
              if (!mapped.key) continue;
              const localRec = await getById('settings', mapped.key);

              if (!localRec) {
                mapped.synced = 1;
                await updateLocal('settings', mapped);
                hasChanges = true;
              } else {
                const localTime = new Date(localRec.updated_at || localRec.last_modified || 0).getTime();
                const remoteTime = new Date(remoteRec.updated_at || remoteRec.last_modified || 0).getTime();

                if ((localRec.synced === 1 && remoteTime >= localTime) || remoteTime > localTime) {
                  mapped.synced = 1;
                  await updateLocal('settings', mapped);
                  hasChanges = true;
                }
              }
              continue;
            }

            if (!mapped.id) continue;

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
              if (storeName === 'clients') clientsUpdated = true;
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
                if (storeName === 'clients') clientsUpdated = true;
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

    // Déclencher un événement global pour avertir les composants UI des modifications
    const isClientSpace = typeof window !== 'undefined' && (
      (window.location && window.location.hash && window.location.hash.startsWith('#portal')) ||
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('portalClientId'))
    );

    if ((clientsUpdated || isClientSpace) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('clients-updated', { detail: { store: 'clients' } }));
    }

    if (hasChanges && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('settings-updated', { detail: { store: 'settings' } }));
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

    // Vérification de sécurité : si praticien verrouillé (et hors espace client), ne pas synchroniser les données complètes
    const isPortal = typeof window !== 'undefined' && (
      (window.location && window.location.hash && window.location.hash.startsWith('#portal')) ||
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('portalClientId'))
    );
    if (!isPortal && typeof isUnlockedFn === 'function' && !isUnlockedFn()) {
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
      const pushHadChanges = await this.pushPending();

      // 2. Récupérer les modifications distantes depuis la dernière synchronisation
      const pullHadChanges = await this.pullChanges();
      const hasChanges = Boolean(pushHadChanges || pullHadChanges);

      // 3. Mettre à jour le timestamp de dernière synchro réussie
      this.setLastSyncTimestamp(new Date().toISOString());

      // 4. Mettre à jour le statut UI
      if (!isSilent && onSyncStatusCallback) onSyncStatusCallback('online');

      // 5. Rafraîchir l'interface si des données ont changé ou dans l'espace client
      if (hasChanges || isPortal) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('clients-updated', { detail: { store: 'clients' } }));
        }
        if (hasChanges && typeof onDataChangedCallback === 'function') {
          await onDataChangedCallback();
        }
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
