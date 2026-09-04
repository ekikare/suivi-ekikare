/**
 * app.js - Logique applicative pour Suivi eKiKare
 */

import { 
  getAll, 
  getById, 
  getByIndex, 
  add, 
  update, 
  remove, 
  exportAllData, 
  importAllData,
  SYNCED_STORES,
  getSupabaseClient,
  addLocal,
  updateLocal,
  removeLocal,
  getTrackedDeletions,
  clearTrackedDeletion,
  mapLocalToSupabase,
  mapSupabaseToLocal,
  registerDatabaseChangeCallback,
  generateUUID,
  getClientByToken,
  ensureClientsHaveUUID,
  reconcileClientUUIDsFromSupabase,
  fetchClientPortalData
} from './db.js';

// --- INITIALISATION SPEECH RECOGNITION ---
let recognition = null;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechObj = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechObj();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'fr-FR';
}

// --- VARIABLES GLOBALES DE L'APPLI ---
let currentRoute = 'dashboard';
let currentSortCol = 'name';
let currentSortDir = 'asc';
let clientSortCol = 'name';
let clientSortDir = 'asc';
let previousRoute = '';
let animalDetailsProvenance = null;
let activeSpeechTarget = null;
let activeSpeechBtn = null;

// Données en cours d'édition/affichage
let currentClientId = null;
let currentAnimalId = null;
let currentSessionId = null;
let toursMap = null;
let toursMarkers = [];

const QUESTIONNAIRE_CRITERES = [
  "Moral",
  "Gestion émotionnelle",
  "Energie/Vitalité",
  "Locomotion",
  "Gestion de l'effort (récupération, endurance...)",
  "Système respiratoire",
  "Qualité yeux, peau, poils, sabots",
  "Système digestif",
  "Système immunitaire",
  "Système hormonal",
  "Autre"
];

// --- CANVAS VARIABLES AND CACHE ---
let canvasElement = null;
let canvasCtx = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let currentDrawingColor = '#ef4444'; // default red
let currentBrushSize = 2;
let canvasUndoHistory = []; // stores transparent states
const MAX_UNDO_STATES = 20;

// --- INITIALISATION AU CHARGEMENT ---
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupPractitionerLock();
  populateSpecialtyDropdown();
  setupDateHeader();
  
  // Migration automatique des UUIDs pour les clients existants
  await ensureClientsHaveUUID();

  // Enregistrer le callback de synchronisation pour les écritures locales
  registerDatabaseChangeCallback(syncData);
  
  // Initialiser l'UI de statut de synchronisation
  updateSyncStatusUI(navigator.onLine ? 'online' : 'offline');
  
  // Écouteurs de connexion réseau
  window.addEventListener('online', () => {
    showToast("Connexion rétablie. Synchronisation des données...", "info");
    if (isPractitionerUnlocked() || currentPortalClientId) {
      syncData();
    }
  });
  window.addEventListener('offline', () => {
    showToast("Connexion perdue. Passage en mode hors-ligne.", "warning");
    updateSyncStatusUI('offline');
  });

  if (isPractitionerUnlocked() || currentPortalClientId) {
    await checkAndInjectMockData();
    if (navigator.onLine) {
      await syncData();
    }
  }

  setupFormListeners();
  setupSpeechRecognition();
  setupBackupRestore();
  setupCanvasListeners();
  setupTensegriteListeners();
  setupKinesioListeners();
  setupProtocolAccordionListeners();
  setupCranioCheckboxListeners();
  setupExternalSessionListeners();
  
  // Charger la page initiale selon le hash ou défaut
  handleRouting();
});

// --- DATE HEADER ---
function setupDateHeader() {
  const dateEl = document.getElementById('current-date');
  if (dateEl) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateEl.textContent = new Date().toLocaleDateString('fr-FR', options);
  }
}

// --- UTILITAIRE URL PORTAIL CLIENT (COMPATIBLE GITHUB PAGES & LOCALHOST) ---
function getClientPortalUrl(clientOrUuid) {
  const origin = window.location.origin;
  let pathname = window.location.pathname || '/';
  if (pathname.endsWith('index.html')) {
    pathname = pathname.slice(0, -'index.html'.length);
  }
  if (!pathname.endsWith('/')) {
    pathname += '/';
  }
  let uuid = '';
  if (clientOrUuid && typeof clientOrUuid === 'object') {
    uuid = clientOrUuid.uuid || clientOrUuid.id || '';
  } else {
    uuid = clientOrUuid || '';
  }
  return `${origin}${pathname}#portal/${uuid}`;
}

// --- SÉCURITÉ & VERROUILLAGE PRATICIEN ---
function isPractitionerUnlocked() {
  return localStorage.getItem('ekikare_practitioner_unlocked') === 'true' ||
         sessionStorage.getItem('ekikare_practitioner_unlocked') === 'true';
}

function getPractitionerPin() {
  return localStorage.getItem('ekikare_practitioner_pin') || '1234';
}

function showPractitionerLockOverlay() {
  const lockOverlay = document.getElementById('practitioner-lock-overlay');
  if (lockOverlay) {
    lockOverlay.style.display = 'flex';
    document.documentElement.classList.add('locked-practitioner');
    const pinInput = document.getElementById('practitioner-pin-input');
    if (pinInput) {
      pinInput.value = '';
      setTimeout(() => pinInput.focus(), 80);
    }
  }
}

function hidePractitionerLockOverlay() {
  const lockOverlay = document.getElementById('practitioner-lock-overlay');
  if (lockOverlay) {
    lockOverlay.style.display = 'none';
    document.documentElement.classList.remove('locked-practitioner');
  }
}

function setupPractitionerLock() {
  const form = document.getElementById('practitioner-lock-form');
  const pinInput = document.getElementById('practitioner-pin-input');
  const errorMsg = document.getElementById('lock-error-msg');
  const rememberCheckbox = document.getElementById('remember-practitioner-device');
  const togglePinBtn = document.getElementById('btn-toggle-pin-visibility');

  if (togglePinBtn && pinInput) {
    togglePinBtn.onclick = () => {
      if (pinInput.type === 'password') {
        pinInput.type = 'text';
      } else {
        pinInput.type = 'password';
      }
    };
  }

  if (form && pinInput) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const enteredPin = pinInput.value.trim();
      const correctPin = getPractitionerPin();

      if (enteredPin === correctPin) {
        if (errorMsg) errorMsg.style.display = 'none';
        if (rememberCheckbox && rememberCheckbox.checked) {
          localStorage.setItem('ekikare_practitioner_unlocked', 'true');
        } else {
          sessionStorage.setItem('ekikare_practitioner_unlocked', 'true');
        }
        hidePractitionerLockOverlay();
        showToast('Espace Praticien déverrouillé avec succès !');
        
        await checkAndInjectMockData();
        handleRouting();
        if (navigator.onLine) {
          syncData();
        }
      } else {
        if (errorMsg) {
          errorMsg.style.display = 'block';
        }
        pinInput.value = '';
        pinInput.focus();
      }
    };
  }

  // Configuration dans les Paramètres
  const savePinBtn = document.getElementById('btn-save-pin');
  if (savePinBtn) {
    savePinBtn.onclick = () => {
      const currentPinInput = document.getElementById('settings-current-pin');
      const newPinInput = document.getElementById('settings-new-pin');
      const confirmPinInput = document.getElementById('settings-confirm-pin');

      const currentPin = currentPinInput ? currentPinInput.value.trim() : '';
      const newPin = newPinInput ? newPinInput.value.trim() : '';
      const confirmPin = confirmPinInput ? confirmPinInput.value.trim() : '';

      const actualPin = getPractitionerPin();
      if (currentPin !== actualPin) {
        showToast('Code PIN actuel incorrect.', 'error');
        return;
      }
      if (newPin.length < 4 || newPin.length > 8) {
        showToast('Le nouveau code PIN doit comporter entre 4 et 8 chiffres.', 'error');
        return;
      }
      if (newPin !== confirmPin) {
        showToast('Les nouveaux codes PIN ne correspondent pas.', 'error');
        return;
      }

      localStorage.setItem('ekikare_practitioner_pin', newPin);
      showToast('Nouveau code PIN praticien enregistré !');
      if (currentPinInput) currentPinInput.value = '';
      if (newPinInput) newPinInput.value = '';
      if (confirmPinInput) confirmPinInput.value = '';
    };
  }

  const lockSessionBtn = document.getElementById('btn-lock-session-now');
  if (lockSessionBtn) {
    lockSessionBtn.onclick = () => {
      localStorage.removeItem('ekikare_practitioner_unlocked');
      sessionStorage.removeItem('ekikare_practitioner_unlocked');
      showToast('Espace praticien verrouillé.');
      handleRouting();
    };
  }
}

// --- ROUTAGE & NAVIGATION ---
function setupNavigation() {
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      sessionStorage.removeItem('portalClientId');
      currentPortalClientId = null;
      document.body.classList.remove('is-client-portal');
      document.documentElement.classList.remove('portal-mode');
      document.body.classList.remove('portal-mode');
      const target = item.getAttribute('data-target');
      window.location.hash = target;
    });
  });

  const backToClientsBtn = document.getElementById('btn-back-to-clients');
  if (backToClientsBtn) {
    backToClientsBtn.addEventListener('click', () => {
      window.location.hash = 'clients';
    });
  }

  const backToAnimalsBtn = document.getElementById('btn-back-to-animals');
  if (backToAnimalsBtn) {
    backToAnimalsBtn.addEventListener('click', () => {
      window.location.hash = 'animals';
    });
  }

  window.addEventListener('hashchange', handleRouting);
}

let currentPortalClientId = null;
let currentPortalClientToken = null;

async function checkPortalContext() {
  const storedPortalId = sessionStorage.getItem('portalClientId');
  const storedPortalToken = sessionStorage.getItem('portalClientToken');
  const hash = window.location.hash.substring(1) || 'dashboard';
  const parts = hash.split('/');
  const routeBase = parts[0];
  const routeParam = parts[1];

  const isPortalRoute = routeBase === 'portal' || (window.location.hash && window.location.hash.includes('portal'));

  if (routeBase === 'portal' && routeParam) {
    let client = await fetchClientPortalData(routeParam);
    if (client) {
      currentPortalClientId = client.id;
      currentPortalClientToken = client.uuid || String(client.id);
      sessionStorage.setItem('portalClientId', currentPortalClientId);
      sessionStorage.setItem('portalClientToken', currentPortalClientToken);
    } else {
      currentPortalClientId = null;
      currentPortalClientToken = routeParam;
      sessionStorage.removeItem('portalClientId');
      sessionStorage.removeItem('portalClientToken');
    }
  } else if (storedPortalId) {
    currentPortalClientId = isNaN(Number(storedPortalId)) ? storedPortalId : Number(storedPortalId);
    currentPortalClientToken = storedPortalToken || String(storedPortalId);
  } else {
    currentPortalClientId = null;
    currentPortalClientToken = null;
  }

  if (isPortalRoute || currentPortalClientId) {
    document.body.classList.add('is-client-portal');
    document.documentElement.classList.add('portal-mode');
    document.body.classList.add('portal-mode');
  } else {
    document.body.classList.remove('is-client-portal');
    document.documentElement.classList.remove('portal-mode');
    document.body.classList.remove('portal-mode');
  }
}

async function handleRouting() {
  const hash = window.location.hash.substring(1) || 'dashboard';
  previousRoute = currentRoute;
  currentRoute = hash;
  
  await checkPortalContext();
  
  // Retirer l'état d'initialisation (Anti-Flicker)
  document.documentElement.classList.remove('app-initializing');

  let viewId = `view-${hash}`;
  let routeBase = hash;
  let routeParam = null;
  let subRoute = null;
  let subParam = null;

  if (hash.includes('/')) {
    const parts = hash.split('/');
    routeBase = parts[0];
    routeParam = parts[1];
    subRoute = parts[2] || null;
    subParam = parts[3] || null;

    if (routeBase === 'session-editor') {
      viewId = 'view-session-editor';
    } else if (routeBase === 'portal') {
      if (subRoute === 'animals' && subParam) {
        viewId = 'view-animals-details';
      } else {
        viewId = 'view-portal';
      }
    } else {
      viewId = `view-${routeBase}-details`;
    }
  }

  const isPortalRoute = routeBase === 'portal' || (window.location.hash && window.location.hash.includes('portal'));

  // 1. ROUTAGE ESPACE PORTAIL CLIENT (Bypass TOTAL et inconditionnel du code PIN praticien)
  if (isPortalRoute || currentPortalClientId) {
    hidePractitionerLockOverlay();
    
    if (routeBase === 'portal') {
      if (subRoute === 'animals' && subParam) {
        viewId = 'view-animals-details';
      } else {
        viewId = 'view-portal';
      }
    } else {
      const allowedBases = ['portal'];
      let isAllowed = allowedBases.includes(routeBase);
      
      if (routeBase === 'sessions' && hash.endsWith('/print')) {
        isAllowed = true;
      }

      if (!isAllowed) {
        window.location.hash = `portal/${currentPortalClientToken || currentPortalClientId || ''}`;
        return;
      }
    }
  } 
  // 2. ROUTAGE ESPACE PRATICIEN (Protégé par code PIN)
  else {
    if (!isPractitionerUnlocked()) {
      showPractitionerLockOverlay();
      document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
      return;
    } else {
      hidePractitionerLockOverlay();
    }
  }

  if (hash.endsWith('/print')) {
    document.body.classList.add('is-printing');
  } else {
    document.body.classList.remove('is-printing');
  }

  if (routeBase === 'animals' && routeParam) {
    if (previousRoute === 'reminders' || previousRoute === 'tournee' || previousRoute === 'clients' || previousRoute === 'professionals' || previousRoute.startsWith('clients/')) {
      animalDetailsProvenance = previousRoute;
    } else if (previousRoute && !previousRoute.startsWith('animals/')) {
      animalDetailsProvenance = null;
    }
  }
  
  // Masquer toutes les sections
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  
  // Afficher la section cible
  const targetSec = document.getElementById(viewId);
  if (targetSec) {
    targetSec.classList.add('active');
  } else {
    window.location.hash = 'dashboard';
    return;
  }
  
  // Mettre à jour l'état actif dans la sidebar
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    if (item.getAttribute('data-target') === routeBase) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Fermer la dictée
  stopDictationUI();

  // Déclencher le chargement des données spécifiques à la vue
  loadViewData(routeBase, routeParam, subRoute, subParam);
}

// --- CHARGEMENT DES DONNÉES PAR VUE ---
async function loadViewData(view, param, subRoute = null, subParam = null) {
  await updateReminderBadge();

  const portalRoute = `portal/${currentPortalClientToken || currentPortalClientId}`;

  switch (view) {
    case 'dashboard':
      if (currentPortalClientId) {
        window.location.hash = portalRoute;
        return;
      }
      await renderDashboard();
      break;
    case 'clients':
      if (param) {
        currentClientId = Number(param);
        if (currentPortalClientId && currentClientId !== currentPortalClientId) {
          window.location.hash = portalRoute;
          return;
        }
        await renderClientDetails(currentClientId);
      } else {
        if (currentPortalClientId) {
          window.location.hash = portalRoute;
          return;
        }
        await renderClientsList();
      }
      break;
    case 'animals':
      if (param) {
        currentAnimalId = Number(param);
        if (currentPortalClientId) {
          const animal = await getById('animals', currentAnimalId);
          if (animal && animal.client_id === currentPortalClientId) {
            window.location.hash = `portal/${currentPortalClientToken || currentPortalClientId}/animals/${animal.id}`;
            return;
          } else {
            showToast("Accès non autorisé.", "error");
            window.location.hash = portalRoute;
            return;
          }
        }
        await renderAnimalDetails(currentAnimalId);
      } else {
        if (currentPortalClientId) {
          window.location.hash = portalRoute;
          return;
        }
        await renderAnimalsList();
      }
      break;
    case 'tournee':
      if (currentPortalClientId) {
        window.location.hash = portalRoute;
        return;
      }
      await renderTournee();
      break;
    case 'sessions':
      if (param) {
        currentSessionId = Number(param);
        const session = await getById('sessions', currentSessionId);
        if (!session) {
          showToast("Séance introuvable.", "error");
          window.location.hash = currentPortalClientId ? portalRoute : 'dashboard';
          return;
        }
        if (currentPortalClientId) {
          const animal = await getById('animals', session.animal_id);
          if (!animal || animal.client_id !== currentPortalClientId) {
            showToast("Accès non autorisé.", "error");
            window.location.hash = portalRoute;
            return;
          }
          if (!window.location.hash.endsWith('/print')) {
            window.location.hash = portalRoute;
            return;
          }
        }
        await renderSessionDetails(currentSessionId);
      } else {
        if (currentPortalClientId) {
          window.location.hash = portalRoute;
          return;
        }
        await renderSessionsList();
      }
      break;
    case 'professionals':
      if (currentPortalClientId) {
        window.location.hash = portalRoute;
        return;
      }
      await renderProfessionalsList();
      break;
    case 'reminders':
      if (currentPortalClientId) {
        window.location.hash = portalRoute;
        return;
      }
      await renderRemindersList();
      break;
    case 'settings':
      if (currentPortalClientId) {
        window.location.hash = portalRoute;
        return;
      }
      await renderSettingsData();
      break;
    case 'session-editor':
      if (currentPortalClientId) {
        window.location.hash = portalRoute;
        return;
      }
      await prepareSessionEditor(param);
      break;
    case 'portal':
      if (param) {
        if (subRoute === 'animals' && subParam) {
          // Charger le client via son :clientUuid depuis Supabase
          const client = await fetchClientPortalData(param);
          if (!client) {
            showToast("Espace client introuvable.", "error");
            window.location.hash = 'dashboard';
            return;
          }

          const animalId = Number(subParam);
          let animal = await getById('animals', animalId);
          
          if (!animal && navigator.onLine) {
            const supabase = getSupabaseClient();
            if (supabase) {
              try {
                const { data } = await supabase.from('animals').select('*').eq('id', animalId).maybeSingle();
                if (data) {
                  animal = mapSupabaseToLocal('animals', data);
                  await updateLocal('animals', animal);
                }
              } catch (e) {
                console.warn("Erreur chargement animal distant:", e);
              }
            }
          }

          // Vérifier strictement qu'il appartient bien à ce client
          if (!animal || String(animal.client_id) !== String(client.id)) {
            showToast("Accès refusé : cet animal n'appartient pas à votre espace.", "error");
            window.location.hash = `portal/${client.uuid || client.id}`;
            return;
          }

          currentAnimalId = animal.id;
          await renderAnimalDetails(animal.id);
        } else {
          await renderPortalDetails(param);
        }
      } else {
        window.location.hash = 'dashboard';
      }
      break;
  }
}

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'warning' ? 'toast-warning' : ''}`;
  
  let icon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
  if (type === 'error') {
    icon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  } else if (type === 'warning') {
    icon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  }

  toast.innerHTML = `
    ${icon}
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease-out reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- DICTÉE VOCALE ---
function setupSpeechRecognition() {
  const dictateButtons = document.querySelectorAll('.btn-dictate');
  if (!recognition) {
    dictateButtons.forEach(btn => { btn.style.display = 'none'; });
    return;
  }
  
  dictateButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = btn.getAttribute('data-target');
      const textarea = document.getElementById(targetId);
      
      if (activeSpeechBtn === btn) {
        recognition.stop();
        return;
      }
      
      if (activeSpeechBtn) {
        recognition.stop();
      }
      
      activeSpeechTarget = textarea;
      activeSpeechBtn = btn;
      btn.classList.add('dictating');
      btn.querySelector('span').textContent = 'Écoute...';
      
      let originalText = textarea.value;
      
      recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        
        let newText = originalText;
        if (newText.length > 0 && !newText.endsWith(' ') && finalTranscript.length > 0) {
          newText += ' ';
        }
        newText += finalTranscript;
        
        textarea.value = newText + (interimTranscript ? ' ' + interimTranscript : '');
        textarea.scrollTop = textarea.scrollHeight;
      };
      
      recognition.onerror = (event) => {
        console.error('Speech error', event);
        if (event.error !== 'no-speech') {
          showToast('Erreur lors de la dictée vocale.', 'error');
          stopDictationUI();
        }
      };
      
      recognition.onend = () => { stopDictationUI(); };
      
      recognition.start();
      showToast('Micro activé. Vous pouvez dicter.');
    });
  });
}

function stopDictationUI() {
  if (activeSpeechBtn) {
    activeSpeechBtn.classList.remove('dictating');
    activeSpeechBtn.querySelector('span').textContent = 'Dicter';
    activeSpeechBtn = null;
    activeSpeechTarget = null;
  }
}

// --- HELPER DATES ET AGES ---
function calculateAge(birthdateStr, estAge = '') {
  if (!birthdateStr) return estAge || '-';
  const birthDate = new Date(birthdateStr);
  if (isNaN(birthDate.getTime())) return estAge || birthdateStr;
  
  const today = new Date();
  const age = today.getFullYear() - birthDate.getFullYear();
  
  if (age === 0) {
    const months = (today.getFullYear() - birthDate.getFullYear()) * 12 + today.getMonth() - birthDate.getMonth();
    return months > 0 ? `${months} mois` : 'Nouveau-né';
  }
  
  return age === 1 ? '1 an' : `${age} ans`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('fr-FR');
}

// Récupère la semaine au format YYYY-Www
function getYearWeek(dateObj) {
  const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1)/7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Formate la semaine pour l'affichage
function formatWeekDisplay(yearWeekStr) {
  if (!yearWeekStr || !yearWeekStr.includes('-W')) return yearWeekStr;
  const parts = yearWeekStr.split('-W');
  return `Semaine ${parts[1]} (${parts[0]})`;
}

function calculateFutureDate(fromDateStr, delayType) {
  const date = new Date(fromDateStr);
  if (isNaN(date.getTime())) return fromDateStr;
  
  switch(delayType) {
    case '2w': date.setDate(date.getDate() + 14); break;
    case '3w': date.setDate(date.getDate() + 21); break;
    case '1m': date.setMonth(date.getMonth() + 1); break;
    case '2m': date.setMonth(date.getMonth() + 2); break;
    case '3m': date.setMonth(date.getMonth() + 3); break;
  }
  
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// --- LOGIQUE DE REMINDER DE 2 SEMAINES (TRIGGER) ---
function isReminderTriggered(datePrevueStr) {
  if (!datePrevueStr) return false;
  const prevue = new Date(datePrevueStr);
  if (isNaN(prevue.getTime())) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Différence en millisecondes
  const diffTime = prevue - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  // Déclenché à partir de 14 jours avant la date prévue
  return diffDays <= 14;
}

// --- REMINDER BADGE SIDEBAR ---
async function updateReminderBadge() {
  const reminders = await getAll('reminders');
  const activeReminders = reminders.filter(r => r.statut === 'en_attente' && isReminderTriggered(r.date_prevue));
  const badge = document.getElementById('reminder-badge');
  if (badge) {
    if (activeReminders.length > 0) {
      badge.textContent = activeReminders.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

// --- RENDU : TABLEAU DE BORD (DASHBOARD) ---
async function renderDashboard() {
  const clients = await getAll('clients');
  const animals = await getAll('animals');
  const sessions = await getAll('sessions');
  const reminders = await getAll('reminders');

  // Stats numeriques
  document.getElementById('stat-clients-count').textContent = clients.length;
  document.getElementById('stat-animals-count').textContent = animals.length;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const sessionsThisMonth = sessions.filter(s => {
    if (!s.date_seance) return false;
    const sDate = new Date(s.date_seance);
    return sDate.getFullYear() === currentYear && sDate.getMonth() === currentMonth;
  });

  const sessionMonthEl = document.getElementById('stat-sessions-month');
  if (sessionMonthEl) {
    sessionMonthEl.innerHTML = `${sessionsThisMonth.length} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-sub);">ce mois</span>`;
  }
  const sessionTotalEl = document.getElementById('stat-sessions-total');
  if (sessionTotalEl) {
    sessionTotalEl.textContent = sessions.length;
  }

  const urgentReminders = reminders.filter(r => r.statut === 'en_attente' && isReminderTriggered(r.date_prevue));
  document.getElementById('stat-reminders-count').textContent = urgentReminders.length;
  document.getElementById('urgent-reminders-badge').textContent = `${urgentReminders.length} actif(s)`;

  // Click navigation handlers for stat cards
  const cardClients = document.getElementById('card-nav-clients');
  if (cardClients) {
    cardClients.onclick = () => { window.location.hash = 'clients'; };
  }
  const cardAnimals = document.getElementById('card-nav-animals');
  if (cardAnimals) {
    cardAnimals.onclick = () => { window.location.hash = 'animals'; };
  }
  const cardSessions = document.getElementById('card-nav-sessions');
  if (cardSessions) {
    cardSessions.onclick = () => { window.location.hash = 'sessions'; };
  }
  const cardReminders = document.getElementById('card-nav-reminders');
  if (cardReminders) {
    cardReminders.onclick = () => { window.location.hash = 'reminders'; };
  }

  // Liste des rappels urgents sur le Dashboard
  const listContainer = document.getElementById('dashboard-reminders-list');
  listContainer.innerHTML = '';

  if (urgentReminders.length === 0) {
    listContainer.innerHTML = '<p class="empty-state">Aucun rappel actif pour le moment. Tout est à jour !</p>';
  } else {
    // Trier par date prévue ascendante (les plus en retard d'abord)
    urgentReminders.sort((a, b) => new Date(a.date_prevue) - new Date(b.date_prevue));
    
    for (const r of urgentReminders) {
      const animal = animals.find(an => an.id === r.animal_id);
      const client = clients.find(cl => cl.id === r.client_id);
      
      const animalName = animal ? animal.nom : 'Animal inconnu';
      const ownerName = client ? `${client.prenom} ${client.nom}` : 'Propriétaire inconnu';
      
      const rItem = document.createElement('div');
      const delayDays = Math.ceil((new Date(r.date_prevue) - new Date()) / (1000 * 60 * 60 * 24));
      
      let statusClass = 'status-future';
      if (delayDays < 0) {
        statusClass = 'status-overdue';
      } else if (delayDays === 0) {
        statusClass = 'status-today';
      }

      rItem.className = `reminder-item ${statusClass}`;
      rItem.innerHTML = `
        <div class="reminder-left">
          <span class="reminder-date-tag">${formatDate(r.date_prevue)} (${delayDays < 0 ? 'En retard' : delayDays === 0 ? 'Aujourd\'hui' : 'Dans ' + delayDays + ' j'})</span>
          <span class="reminder-title">${r.type_rappel === 'prendre_des_nouvelles' ? 'Prendre des nouvelles' : 'Relance RDV'} &bull; ${animalName}</span>
          <span class="reminder-meta">Propriétaire : ${ownerName} &bull; ${r.notes || 'Pas de note'}</span>
        </div>
        <button class="btn btn-secondary btn-small btn-complete-reminder" data-id="${r.id}">Marquer Fait</button>
      `;

      // Clic pour aller à la fiche animal
      rItem.querySelector('.reminder-left').addEventListener('click', () => {
        window.location.hash = `animals/${r.animal_id}`;
      });

      // Clic pour marquer fait
      rItem.querySelector('.btn-complete-reminder').addEventListener('click', async (e) => {
        e.stopPropagation();
        r.statut = 'fait';
        await update('reminders', r);
        showToast('Rappel marqué comme effectué.');
        await renderDashboard();
      });

      listContainer.appendChild(rItem);
    }
  }

  // Distribution des espèces (Mini Chart)
  const speciesLegend = document.getElementById('species-chart-legend');
  speciesLegend.innerHTML = '';
  
  if (animals.length === 0) {
    speciesLegend.innerHTML = '<p class="empty-state">Aucune statistique disponible.</p>';
  } else {
    const speciesCounts = {};
    animals.forEach(an => {
      const sp = an.espece || 'Autre';
      speciesCounts[sp] = (speciesCounts[sp] || 0) + 1;
    });

    const items = Object.entries(speciesCounts).sort((a,b) => b[1] - a[1]);
    for (const [sp, val] of items) {
      const pct = Math.round((val / animals.length) * 100);
      const row = document.createElement('div');
      row.style.margin = '10px 0';
      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:4px;">
          <span>${sp}</span>
          <strong>${val} (${pct}%)</strong>
        </div>
        <div style="height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
          <div style="height:100%; width:${pct}%; background:var(--color-primary); border-radius:3px;"></div>
        </div>
      `;
      speciesLegend.appendChild(row);
    }
  }
}

// --- RENDU : ANNUAIRE CLIENTS ---
async function renderClientsList() {
  const clients = await getAll('clients');
  const animals = await getAll('animals');
  
  const searchInput = document.getElementById('client-search-input');
  if (searchInput && !searchInput.dataset.listener) {
    searchInput.dataset.listener = 'true';
    searchInput.addEventListener('input', renderClientsList);
  }
  const filterVal = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const tbody = document.getElementById('clients-table-body');
  tbody.innerHTML = '';

  const filtered = clients.filter(c => {
    if (!filterVal) return true;
    const term = normalizeText(filterVal);
    
    // Check client details
    if (normalizeText(c.nom).includes(term)) return true;
    if (normalizeText(c.prenom).includes(term)) return true;
    if (normalizeText(c.telephone).includes(term)) return true;
    if (normalizeText(c.email).includes(term)) return true;
    if (normalizeText(c.adresse).includes(term)) return true;

    // Check associated animals
    const clientAnimals = animals.filter(an => an.client_id === c.id);
    for (const an of clientAnimals) {
      if (normalizeText(an.nom).includes(term)) return true;
      if (normalizeText(an.stable_name).includes(term)) return true;
      if (normalizeText(an.stable_city).includes(term)) return true;
      if (normalizeText(an.stable_zip).includes(term)) return true;
      if (normalizeText(an.lieu_de_vie).includes(term)) return true;
      
      // Also check department display name if zip matches (e.g. Gironde, Yvelines)
      if (an.stable_zip) {
        const deptNum = an.stable_zip.substring(0, 2);
        const deptName = DEPARTEMENTS[deptNum] || '';
        if (normalizeText(deptName).includes(term)) return true;
      }
    }
    
    return false;
  });

  // Tri des clients
  filtered.sort((a, b) => {
    if (!a || !b) return 0;
    let valA = '';
    let valB = '';

    if (clientSortCol === 'name') {
      valA = (a.prenom || '').toLowerCase();
      valB = (b.prenom || '').toLowerCase();
    } else if (clientSortCol === 'location') {
      const animsA = animals.filter(an => an.client_id === a.id);
      const animsB = animals.filter(an => an.client_id === b.id);
      
      const zipA = animsA.length > 0 ? (animsA[0].stable_zip || '') : '';
      const zipB = animsB.length > 0 ? (animsB[0].stable_zip || '') : '';
      const cityA = animsA.length > 0 ? (animsA[0].stable_city || '').toLowerCase() : '';
      const cityB = animsB.length > 0 ? (animsB[0].stable_city || '').toLowerCase() : '';
      
      if (zipA !== zipB) {
        if (!zipA) return 1;
        if (!zipB) return -1;
        return clientSortDir === 'asc' ? zipA.localeCompare(zipB) : zipB.localeCompare(zipA);
      }
      if (cityA !== cityB) {
        if (!cityA) return 1;
        if (!cityB) return -1;
        return clientSortDir === 'asc' ? cityA.localeCompare(cityB, 'fr') : cityB.localeCompare(cityA, 'fr');
      }
      return 0;
    }

    if (valA < valB) return clientSortDir === 'asc' ? -1 : 1;
    if (valA > valB) return clientSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // Configurer le tri interactif sur les en-têtes du tableau clients
  const headers = document.querySelectorAll('#view-clients th.sortable');
  headers.forEach(th => {
    if (!th.dataset.listener) {
      th.dataset.listener = 'true';
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (clientSortCol === col) {
          clientSortDir = clientSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          clientSortCol = col;
          clientSortDir = 'asc';
        }
        renderClientsList();
      });
    }
    
    const iconSpan = th.querySelector('.sort-icon');
    if (iconSpan) {
      if (th.dataset.sort === clientSortCol) {
        iconSpan.textContent = clientSortDir === 'asc' ? ' ▲' : ' ▼';
      } else {
        iconSpan.textContent = '';
      }
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Aucun client trouvé.</td></tr>';
  } else {
    for (const c of filtered) {
      const clientAnimals = animals.filter(an => an.client_id === c.id);
      
      const animalsHtml = clientAnimals.map(an => {
        const spec = an.species || an.espece || 'Cheval';
        let icon = '🐾';
        if (spec === 'Cheval') icon = '🐴';
        else if (spec === 'Chien') icon = '🐕';
        else if (spec === 'Chat') icon = '🐱';
        return `<span style="white-space: nowrap; margin-right: 8px;">${icon} ${an.nom}</span>`;
      }).join(' ');

      const locationsHtml = clientAnimals.map(an => {
        return `<div style="font-size: 0.9rem; color: var(--text-sub); white-space: nowrap;">📍 ${getAnimalLocationSummary(an)}</div>`;
      }).join('');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${c.nom.toUpperCase()}</strong> ${c.prenom}</td>
        <td>${c.telephone}</td>
        <td>${c.email || '-'}</td>
        <td>${animalsHtml || '<span class="empty-state">-</span>'}</td>
        <td>${locationsHtml || '<span class="empty-state">-</span>'}</td>
        <td class="actions-column">
          <button class="btn btn-secondary btn-small btn-view-client" data-id="${c.id}">Fiche</button>
        </td>
      `;

      tr.addEventListener('click', () => { window.location.hash = `clients/${c.id}`; });
      tr.querySelector('.btn-view-client').addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.hash = `clients/${c.id}`;
      });

      tbody.appendChild(tr);
    }
  }
}

// --- RENDU : FICHE CLIENT (DÉTAILS) ---
async function renderClientDetails(clientId) {
  const client = await getById('clients', clientId);
  if (!client) {
    showToast('Client introuvable.', 'error');
    window.location.hash = 'clients';
    return;
  }

  document.getElementById('detail-client-name').textContent = `${client.prenom} ${client.nom.toUpperCase()}`;
  document.getElementById('detail-client-phone').textContent = client.telephone;
  document.getElementById('detail-client-email').textContent = client.email || '-';
  document.getElementById('detail-client-address').textContent = client.adresse || '-';
  document.getElementById('detail-client-stable').textContent = client.ecurie || '-';
  document.getElementById('detail-client-notes').textContent = client.notes ? String(client.notes).replace(/\[portal_token:[^\]]+\]/g, '').trim() : 'Aucune note enregistrée.';

  // Charger les animaux du client
  const animals = await getByIndex('animals', 'client_id', clientId);
  const listContainer = document.getElementById('detail-client-animals');
  listContainer.innerHTML = '';

  if (animals.length === 0) {
    listContainer.innerHTML = '<p class="empty-state">Aucun animal enregistré pour ce client.</p>';
  } else {
    for (const an of animals) {
      const card = document.createElement('a');
      card.className = 'animal-mini-card';
      const targetHash = currentPortalClientId 
        ? `portal/${currentPortalClientToken || currentPortalClientId}/animals/${an.id}`
        : `animals/${an.id}`;
      card.href = `#${targetHash}`;
      
      const avatarText = an.nom.substring(0,2).toUpperCase();
      const ageDisplay = calculateAge(an.date_naissance_ou_age, an.date_naissance_ou_age);

      const locText = getAnimalLocationSummary(an);

      card.innerHTML = `
        <div class="animal-mini-info">
          <div class="animal-avatar-mini">${avatarText}</div>
          <div>
            <span class="animal-mini-name">${an.nom}</span>
            <div class="animal-mini-details">${an.espece} &bull; ${an.race || 'Race inconnue'} &bull; ${ageDisplay}</div>
            <div class="animal-mini-location" style="font-size:0.85rem; color:var(--text-sub); margin-top:2px;">📍 ${locText}</div>
          </div>
        </div>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      `;

      listContainer.appendChild(card);
    }
  }

  // Configurer le clic boutons d'actions
  document.getElementById('btn-copy-client-portal-link').onclick = async () => {
    let freshClient = await getById('clients', clientId);
    if (!freshClient) freshClient = client;
    if (!freshClient.uuid) {
      freshClient.uuid = generateUUID();
      await update('clients', freshClient);
    }
    const portalUrl = getClientPortalUrl(freshClient.uuid);
    navigator.clipboard.writeText(portalUrl).then(() => {
      showToast('Lien Espace Client sécurisé copié dans le presse-papier !');
    }).catch(err => {
      console.error('Erreur copie lien:', err);
      showToast('Impossible de copier le lien.', 'error');
    });
  };

  document.getElementById('btn-edit-client-detail').onclick = () => {
    openClientDialog(client);
  };

  document.getElementById('btn-add-animal-to-client').onclick = () => {
    openAnimalDialog(null, client.id);
  };
}

// --- RENDU : ANIMAL LIST ---
async function renderAnimalsList() {
  const animals = await getAll('animals');
  const clients = await getAll('clients');
  
  const searchInput = document.getElementById('animal-search-input');
  if (searchInput && !searchInput.dataset.listener) {
    searchInput.dataset.listener = 'true';
    searchInput.addEventListener('input', renderAnimalsList);
  }
  const speciesFilter = document.getElementById('animal-species-filter');
  if (speciesFilter && !speciesFilter.dataset.listener) {
    speciesFilter.dataset.listener = 'true';
    speciesFilter.addEventListener('change', renderAnimalsList);
  }
  
  const filterVal = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const specVal = speciesFilter ? speciesFilter.value : '';

  const tbody = document.getElementById('animals-table-body');
  tbody.innerHTML = '';

  const filtered = animals.filter(an => {
    if (!an) return false;
    const spec = an.species || an.espece || 'Cheval';
    
    // Espèce filter
    if (specVal) {
      if (specVal === 'Autre') {
        if (['Cheval', 'Chien', 'Chat'].includes(spec)) return false;
      } else {
        if (spec !== specVal) return false;
      }
    }
    
    // Texte
    if (!filterVal) return true;
    
    const client = clients.find(c => c.id === an.client_id);
    const ownerName = client ? `${client.prenom} ${client.nom}`.toLowerCase() : '';
    
    const stableName = (an.stable_name || '').toLowerCase();
    const stableAddress = (an.stable_address || '').toLowerCase();
    const stableZip = (an.stable_zip || '').toLowerCase();
    const stableCity = (an.stable_city || '').toLowerCase();
    const oldLieu = (an.lieu_de_vie || '').toLowerCase();

    return (an.nom && an.nom.toLowerCase().includes(filterVal)) ||
           (an.race && an.race.toLowerCase().includes(filterVal)) ||
           spec.toLowerCase().includes(filterVal) ||
           stableName.includes(filterVal) ||
           stableAddress.includes(filterVal) ||
           stableZip.includes(filterVal) ||
           stableCity.includes(filterVal) ||
           oldLieu.includes(filterVal) ||
           ownerName.includes(filterVal);
  });

  // Tri
  filtered.sort((a, b) => {
    if (!a || !b) return 0;
    let valA = '';
    let valB = '';

    if (currentSortCol === 'name') {
      valA = (a.nom || '').toLowerCase();
      valB = (b.nom || '').toLowerCase();
    } else if (currentSortCol === 'breed') {
      valA = `${a.race || ''} ${a.robe || ''}`.toLowerCase();
      valB = `${b.race || ''} ${b.robe || ''}`.toLowerCase();
    } else if (currentSortCol === 'owner') {
      const clientA = clients.find(c => c.id === a.client_id);
      const clientB = clients.find(c => c.id === b.client_id);
      valA = clientA ? `${clientA.prenom} ${clientA.nom}`.toLowerCase() : '';
      valB = clientB ? `${clientB.prenom} ${clientB.nom}`.toLowerCase() : '';
    } else if (currentSortCol === 'location') {
      const clientA = clients.find(c => c.id === a.client_id);
      const clientB = clients.find(c => c.id === b.client_id);
      valA = (a.stable_name || a.lieu_de_vie || '').toLowerCase();
      valB = (b.stable_name || b.lieu_de_vie || '').toLowerCase();
    } else if (currentSortCol === 'age') {
      const dobA = a.date_naissance_ou_age || '';
      const dobB = b.date_naissance_ou_age || '';
      const dateA = dobA ? new Date(dobA) : null;
      const dateB = dobB ? new Date(dobB) : null;
      const timeA = (dateA && !isNaN(dateA.getTime())) ? dateA.getTime() : 0;
      const timeB = (dateB && !isNaN(dateB.getTime())) ? dateB.getTime() : 0;
      return currentSortDir === 'asc' ? timeB - timeA : timeA - timeB;
    } else if (currentSortCol === 'tracking') {
      const trackA = a.trackingMode || a.modeSuivi || a.tracking_mode || 'À la demande';
      const trackB = b.trackingMode || b.modeSuivi || b.tracking_mode || 'À la demande';
      const otherA = a.tracking_mode_other || '';
      const otherB = b.tracking_mode_other || '';
      valA = (trackA === 'Autre' ? otherA : trackA).toLowerCase();
      valB = (trackB === 'Autre' ? otherB : trackB).toLowerCase();
    }

    if (valA < valB) return currentSortDir === 'asc' ? -1 : 1;
    if (valA > valB) return currentSortDir === 'asc' ? 1 : -1;
    return 0;
  });

  // Configurer le tri interactif sur les en-têtes
  const headers = document.querySelectorAll('.data-table th.sortable');
  headers.forEach(th => {
    if (!th.dataset.listener) {
      th.dataset.listener = 'true';
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (currentSortCol === col) {
          currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          currentSortCol = col;
          currentSortDir = 'asc';
        }
        renderAnimalsList();
      });
    }
    
    const iconSpan = th.querySelector('.sort-icon');
    if (iconSpan) {
      if (th.dataset.sort === currentSortCol) {
        iconSpan.textContent = currentSortDir === 'asc' ? ' ▲' : ' ▼';
      } else {
        iconSpan.textContent = '';
      }
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Aucun animal trouvé.</td></tr>';
  } else {
    for (const an of filtered) {
      if (!an) continue;
      const client = clients.find(c => c.id === an.client_id);
      const ownerName = client ? `${client.prenom} ${client.nom}` : '-';
      const ageDisplay = calculateAge(an.date_naissance_ou_age, an.date_naissance_ou_age);
      
      const spec = an.species || an.espece || 'Cheval';
      let specIcon = '🐾';
      if (spec === 'Cheval') specIcon = '🐴';
      else if (spec === 'Chien') specIcon = '🐕';
      else if (spec === 'Chat') specIcon = '🐱';

      const prob = an.mainIssues || an.problematique || an.main_problems || '-';
      
      const tracking = an.trackingMode || an.modeSuivi || an.tracking_mode || 'À la demande';
      const trackingText = tracking === 'Autre' ? (an.tracking_mode_other || 'Autre') : tracking;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${specIcon} &nbsp; <strong>${an.nom || 'Sans nom'}</strong></td>
        <td>${an.race || '-'} ${an.robe ? '('+an.robe+')' : ''}</td>
        <td>${ownerName}</td>
        <td>${an.stable_name || an.lieu_de_vie || '-'}</td>
        <td>${ageDisplay}</td>
        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${prob}</td>
        <td>${trackingText}</td>
        <td class="actions-column">
          <button class="btn btn-secondary btn-small btn-view-animal" data-id="${an.id}">Fiche</button>
        </td>
      `;

      tr.addEventListener('click', () => { window.location.hash = `animals/${an.id}`; });
      tr.querySelector('.btn-view-animal').addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.hash = `animals/${an.id}`;
      });

      tbody.appendChild(tr);
    }
  }
}

// --- RENDU : ANIMAL DETAIL (FICHE) ---
async function renderAnimalDetails(animalId) {
  const animal = await getById('animals', animalId);
  if (!animal) {
    showToast('Animal introuvable.', 'error');
    window.location.hash = 'animals';
    return;
  }

  // Dynamic contextual back button logic
  const contextualBtn = document.getElementById('btn-back-contextual');
  const contextualText = document.getElementById('btn-back-contextual-text');
  
  if (contextualBtn && contextualText) {
    if (currentPortalClientId) {
      contextualBtn.style.display = 'inline-flex';
      contextualText.textContent = 'Retour à mon espace';
      contextualBtn.onclick = () => { window.location.hash = `portal/${currentPortalClientToken || currentPortalClientId}`; };
    } else if (animalDetailsProvenance) {
      contextualBtn.style.display = 'inline-flex';
      
      if (animalDetailsProvenance === 'reminders') {
        contextualText.textContent = 'Retour aux rappels';
        contextualBtn.onclick = () => { window.location.hash = 'reminders'; };
      } else if (animalDetailsProvenance === 'tournee') {
        contextualText.textContent = 'Retour aux tournées';
        contextualBtn.onclick = () => { window.location.hash = 'tournee'; };
      } else if (animalDetailsProvenance === 'clients') {
        contextualText.textContent = 'Retour aux clients';
        contextualBtn.onclick = () => { window.location.hash = 'clients'; };
      } else if (animalDetailsProvenance === 'professionals') {
        contextualText.textContent = 'Retour aux professionnels';
        contextualBtn.onclick = () => { window.location.hash = 'professionals'; };
      } else if (animalDetailsProvenance.startsWith('clients/')) {
        contextualText.textContent = 'Retour au client';
        contextualBtn.onclick = () => { window.location.hash = animalDetailsProvenance; };
      } else {
        contextualBtn.style.display = 'none';
      }
    } else {
      contextualBtn.style.display = 'none';
    }
  }

  const client = await getById('clients', animal.client_id);
  const ownerName = client ? `${client.prenom} ${client.nom.toUpperCase()}` : 'Propriétaire inconnu';

  document.getElementById('detail-animal-name').textContent = animal.nom;
  document.getElementById('detail-animal-owner').innerHTML = client 
    ? (currentPortalClientId ? ownerName : `<a href="#clients/${client.id}" style="color:var(--color-primary); font-weight:600; text-decoration:none;">${ownerName}</a>`)
    : ownerName;

  document.getElementById('detail-animal-identity').textContent = `${animal.espece} • ${animal.race || 'Race inconnue'} ${animal.robe ? '('+animal.robe+')' : ''}`;
  document.getElementById('detail-animal-sex').textContent = animal.sexe || 'Non précisé';
  
  const birthdateStr = animal.date_naissance_ou_age || '';
  const ageDisplay = calculateAge(birthdateStr, birthdateStr);
  document.getElementById('detail-animal-age').textContent = birthdateStr 
    ? `${formatDate(birthdateStr)} (${ageDisplay})`
    : ageDisplay;

  // New photo display logic
  const detailPhoto = document.getElementById('detail-animal-photo');
  const detailPlaceholder = document.getElementById('detail-animal-photo-placeholder');
  if (animal.photo_data_url) {
    detailPhoto.src = animal.photo_data_url;
    detailPhoto.style.display = 'block';
    detailPlaceholder.style.display = 'none';
  } else {
    detailPhoto.src = '';
    detailPhoto.style.display = 'none';
    detailPlaceholder.style.display = 'block';
  }

  // Tracking frequency display
  const trackingText = animal.tracking_mode === 'Autre' ? (animal.tracking_mode_other || 'Autre suivi') : (animal.tracking_mode || 'À la demande');
  document.getElementById('detail-animal-tracking-mode-display').textContent = `Suivi : ${trackingText}`;
  document.getElementById('detail-animal-tracking-mode').textContent = trackingText;

  // Pension, Location & Distance
  const stableName = animal.stable_name || animal.lieu_de_vie || '-';
  let stableAddress = animal.stable_address || '';
  let stableZip = animal.stable_zip || '';
  let stableCity = animal.stable_city || '';
  const stableDistance = animal.stable_distance || 0;

  // Fallback: if stable_address has content but zip and city are empty, try parsing
  if (stableAddress && !stableZip && !stableCity) {
    const parsed = parseAddress(stableAddress);
    stableAddress = parsed.address;
    stableZip = parsed.zip;
    stableCity = parsed.city;
  }

  const fullAddressParts = [];
  if (stableAddress) fullAddressParts.push(stableAddress);
  if (stableZip || stableCity) {
    fullAddressParts.push(`${stableZip} ${stableCity}`.trim());
  }
  const fullAddress = fullAddressParts.join(', ') || '-';

  document.getElementById('detail-animal-lieu').textContent = stableName;
  document.getElementById('detail-animal-address').textContent = fullAddress;
  document.getElementById('detail-animal-distance').textContent = stableDistance ? `${stableDistance} km` : '-';
  
  const isHorse = animal.espece === 'Cheval';
  
  const housingRow = document.getElementById('detail-animal-housing-row');
  const workRow = document.getElementById('detail-animal-work-row');
  const lifestyleRow = document.getElementById('detail-animal-lifestyle-row');

  if (housingRow) housingRow.style.display = isHorse ? 'flex' : 'none';
  if (workRow) workRow.style.display = isHorse ? 'flex' : 'none';
  if (lifestyleRow) {
    lifestyleRow.style.display = isHorse ? 'none' : 'flex';
    document.getElementById('detail-animal-lifestyle').textContent = animal.lifestyle_details || '-';
  }

  // Housing mode
  let hType = animal.housing_type || animal.housing_mode || '-';
  if (hType === 'Autre') {
    hType = animal.housing_type_other || animal.housing_mode_other || 'Autre hébergement';
  }
  let sType = animal.social_type || '';
  if (sType === 'Autre') {
    sType = 'Autre vie sociale';
  }
  
  let combinedHousing = hType;
  if (sType) {
    combinedHousing += ` • ${sType}`;
  }
  document.getElementById('detail-animal-housing').textContent = combinedHousing;

  // Nutrition
  document.getElementById('detail-animal-nutritionist').textContent = animal.nutritionist ? 'Oui' : 'Non';
  document.getElementById('detail-animal-nutrition-details').textContent = animal.nutrition_details || '-';

  // Work & Main problems
  document.getElementById('detail-animal-work').textContent = animal.work_objective || '-';
  document.getElementById('detail-animal-problems').textContent = animal.main_problems || '-';

  // Structured medical history rendering
  const medHistoryContainer = document.getElementById('detail-animal-medical-history');
  medHistoryContainer.innerHTML = '';
  const medEvents = animal.medical_events || [];
  if (medEvents.length === 0) {
    if (animal.antecedents) {
      // Fallback to old text format if any exists
      const fallbackDiv = document.createElement('div');
      fallbackDiv.className = 'medical-history-item';
      fallbackDiv.textContent = animal.antecedents;
      medHistoryContainer.appendChild(fallbackDiv);
    } else {
      medHistoryContainer.innerHTML = '<p class="empty-state">Aucun antécédent médical enregistré.</p>';
    }
  } else {
    // Sort chronologically descending (newer to older)
    const MONTHS_ORDER = {
      "Janvier": 1, "Février": 2, "Mars": 3, "Avril": 4, "Mai": 5, "Juin": 6,
      "Juillet": 7, "Août": 8, "Septembre": 9, "Octobre": 10, "Novembre": 11, "Décembre": 12
    };
    medEvents.sort((a, b) => {
      const yearA = parseInt(a.year) || 0;
      const yearB = parseInt(b.year) || 0;
      if (yearA !== yearB) return yearB - yearA;
      
      const monthA = MONTHS_ORDER[a.month] || 0;
      const monthB = MONTHS_ORDER[b.month] || 0;
      return monthB - monthA;
    });
    medEvents.forEach(ev => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'medical-history-item';
      itemDiv.innerHTML = `
        <span class="medical-history-date">${ev.year}${ev.month ? ' - ' + ev.month : ''}</span>
        <span>: ${ev.event}</span>
      `;
      medHistoryContainer.appendChild(itemDiv);
    });
  }

  // Charger les professionnels associés
  const professionals = await getAll('professionals');
  const profsListContainer = document.getElementById('detail-animal-professionals');
  profsListContainer.innerHTML = '';

  const assocIds = animal.pros_associes_ids || [];
  const assocProfs = professionals.filter(p => assocIds.includes(p.id));

  if (assocProfs.length === 0) {
    profsListContainer.innerHTML = '<p class="empty-state">Aucun professionnel enregistré pour le moment.</p>';
  } else {
    for (const p of assocProfs) {
      const pItem = document.createElement('div');
      pItem.className = 'prof-mini-item';
      pItem.innerHTML = `
        <div class="prof-mini-info">
          <h4>${p.prenom} ${p.nom}</h4>
          <p>${p.specialite} &bull; Tel : ${p.telephone || '-'}</p>
        </div>
      `;
      profsListContainer.appendChild(pItem);
    }
  }

  // Historique des séances de l'animal
  const sessions = await getAll('sessions');
  const animalSessions = sessions.filter(s => s.animal_id === animalId);
  const sessionsContainer = document.getElementById('detail-animal-sessions');
  sessionsContainer.innerHTML = '';

  // Trier par date descendante (les plus récentes en premier)
  animalSessions.sort((a,b) => new Date(b.date_seance) - new Date(a.date_seance));

  if (animalSessions.length === 0) {
    sessionsContainer.innerHTML = '<p class="empty-state">Aucune séance enregistrée pour cet animal.</p>';
  } else {
    for (const s of animalSessions) {
      const item = document.createElement('div');
      
      if (s.isExternal) {
        item.className = 'timeline-item timeline-item-external';
        item.style.cursor = s.fileData ? 'pointer' : 'default';
        
        const cleanSummary = formatTimelineSummary(s.summary || '-');
        const crBtnHtml = s.fileData ? `<button type="button" class="btn btn-secondary btn-small btn-view-cr" style="display:inline-flex; align-items:center; gap:4px; padding: 2px 8px; font-size: 0.78rem;">📄 Voir le CR</button>` : '';
        
        item.innerHTML = `
          <div class="timeline-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
            <div class="timeline-objective" style="font-size:0.86rem; font-weight:700; color:#ffffff; margin:0;">
              ${s.profession || 'Intervention'}${s.practitionerName ? ` - <em style="font-weight:normal; font-style:italic; color:#96A5BA;">${s.practitionerName}</em>` : ''}
            </div>
            <span class="badge-external" style="font-size:0.72rem; padding: 2px 8px; margin:0;">${formatDate(s.date_seance)}</span>
          </div>
          ${s.motif ? `<div class="timeline-motif" style="font-size:0.82rem; margin-bottom:2px; line-height:1.35; color:#96A5BA; text-indent:0; margin-left:0; padding-left:0;"><strong>Motif :</strong> ${s.motif}</div>` : ''}
          <div class="timeline-preview" style="-webkit-line-clamp:unset; max-height:none; overflow:visible; font-size:0.82rem; line-height:1.35; margin:0; word-break:break-word; color:#96A5BA; text-indent:0; margin-left:0; padding-left:0; white-space:normal;"><strong>Résumé :</strong> <span style="white-space:pre-wrap; color:#96A5BA;">${cleanSummary}</span></div>
          <div class="timeline-actions-ext" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:6px;">
            <button type="button" class="btn btn-secondary btn-small btn-edit-ext-session" style="padding: 2px 8px; font-size: 0.78rem;">Modifier</button>
            <button type="button" class="btn btn-danger btn-small btn-delete-ext-session" style="padding: 2px 8px; font-size: 0.78rem;">Supprimer</button>
            ${crBtnHtml}
          </div>
        `;
        
        if (s.fileData) {
          const openDocHandler = () => {
            openDocumentViewerModal(s.fileData, s.fileType, s.fileName, {
              subtitle: `Séance du ${formatDate(s.date_seance)} • ${s.profession}`,
              text: `Compte-rendu ${s.profession} pour ${animal.nom} (${formatDate(s.date_seance)})`
            });
          };

          item.addEventListener('click', () => {
            openDocHandler();
          });

          item.querySelector('.btn-view-cr')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openDocHandler();
          });
        }

        item.querySelector('.btn-edit-ext-session')?.addEventListener('click', (e) => {
          e.stopPropagation();
          openExternalSessionDialog(s, animalId);
        });

        item.querySelector('.btn-delete-ext-session')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm("Êtes-vous sûr de vouloir supprimer cette séance ?")) {
            await remove('sessions', s.id);
            showToast("Séance supprimée.");
            await renderAnimalDetails(animalId);
          }
        });
        
      } else {
        item.className = 'timeline-item';
        item.style.cursor = 'pointer';
        
        const rawSum = s.resume_client_genere || 'Aucun résumé client rédigé.';
        const cleanSummary = formatTimelineSummary(rawSum);
        
        // Détection de tous les protocoles cochés/utilisés lors de la séance
        const protos = s.protocoles_realises || {};
        const activeProtocols = [];
        if (protos.shiatsu && protos.shiatsu.checked) activeProtocols.push('Shiatsu');
        if (protos.manuelles && protos.manuelles.checked) activeProtocols.push('Techniques manuelles');
        if (protos.tensegrite && protos.tensegrite.checked) activeProtocols.push('Tenségrité');
        if (protos.cranio && protos.cranio.checked) activeProtocols.push('Cranio-Sacrée');
        if (protos.kinesiologie && protos.kinesiologie.checked) activeProtocols.push('Kinésiologie');
        if (protos.aura && protos.aura.checked) activeProtocols.push('Aura');

        const cardTitle = activeProtocols.length > 0 ? activeProtocols.join(' + ') : (s.motif || `Séance du ${formatDate(s.date_seance)}`);
        
        item.innerHTML = `
          <div class="timeline-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
            <div class="timeline-objective" style="font-size:0.86rem; font-weight:700; color:#ffffff; margin:0;">${cardTitle}</div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="timeline-date" style="font-size:0.75rem; color:#96A5BA;">${formatDate(s.date_seance)}</span>
              <span class="timeline-n-session" style="font-size:0.72rem; padding:1px 6px; color:#96A5BA;">Séance ${s.n_seance_annee || 1}</span>
            </div>
          </div>
          ${s.motif ? `<div class="timeline-motif" style="font-size:0.82rem; color:#96A5BA; margin-bottom:2px; line-height:1.35; text-indent:0; margin-left:0; padding-left:0;"><strong>Motif :</strong> ${s.motif}</div>` : ''}
          <div class="timeline-preview" style="-webkit-line-clamp:unset; max-height:none; overflow:visible; font-size:0.82rem; line-height:1.35; margin:0; word-break:break-word; color:#96A5BA; text-indent:0; margin-left:0; padding-left:0; white-space:normal;"><strong>Résumé :</strong> <span style="white-space:pre-wrap; color:#96A5BA;">${cleanSummary}</span></div>
          <div style="margin-top:6px; display:flex; gap:6px; align-items:center;">
            <button class="btn btn-secondary btn-small btn-print-direct" style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; font-size:0.78rem;">📄 Voir le CR</button>
          </div>
        `;

        item.addEventListener('click', () => {
          if (currentPortalClientId) {
            openPortalSessionModal(s, animal);
          } else {
            window.location.hash = `sessions/${s.id}`;
          }
        });

        item.querySelector('.btn-print-direct').addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentPortalClientId) {
            openPortalSessionModal(s, animal);
          } else {
            window.open(`#sessions/${s.id}/print`, '_blank');
          }
        });
      }
      
      sessionsContainer.appendChild(item);
    }
  }

  // Rappels associés
  const reminders = await getAll('reminders');
  const animalReminders = reminders.filter(r => r.animal_id === animalId && r.statut === 'en_attente');
  const remindersContainer = document.getElementById('detail-animal-reminders');
  remindersContainer.innerHTML = '';

  if (animalReminders.length === 0) {
    remindersContainer.innerHTML = '<p class="empty-state">Aucun rappel en attente.</p>';
  } else {
    for (const r of animalReminders) {
      const rDiv = document.createElement('div');
      
      let statusClass = 'status-future';
      let tagColorVar = '--color-info';
      
      const delayDays = Math.ceil((new Date(r.date_prevue) - new Date()) / (1000 * 60 * 60 * 24));
      if (delayDays < 0) {
        statusClass = 'status-overdue';
        tagColorVar = '--color-danger';
      } else if (delayDays === 0) {
        statusClass = 'status-today';
        tagColorVar = '--color-warning';
      }

      rDiv.className = `reminder-item ${statusClass}`;
      rDiv.style.cursor = 'pointer';
      
      const displayName = r.type_rappel === 'prendre_des_nouvelles' ? 'Prendre des nouvelles' : (r.type_rappel === 'fixer_rdv' ? 'Fixer RDV' : r.type_rappel);

      rDiv.innerHTML = `
        <div class="reminder-left" style="flex-grow: 1; margin-right: 15px;">
          <span class="reminder-date-tag" style="color:var(${tagColorVar});">${formatDate(r.date_prevue)}</span>
          <span class="reminder-title">${displayName}</span>
          <span class="reminder-meta">${r.notes || ''}</span>
        </div>
        <button class="btn btn-secondary btn-small btn-complete-reminder-animal" data-id="${r.id}">Marquer Fait</button>
      `;

      rDiv.addEventListener('click', () => {
        openReminderDialog(r);
      });

      rDiv.querySelector('.btn-complete-reminder-animal').addEventListener('click', async (e) => {
        e.stopPropagation();
        r.statut = 'fait';
        await update('reminders', r);
        showToast('Rappel marqué fait.');
        await renderAnimalDetails(animalId);
      });

      remindersContainer.appendChild(rDiv);
    }
  }

  // Boutons d'actions
  document.getElementById('btn-copy-animal-portal-link').onclick = async () => {
    let freshAnimal = await getById('animals', animalId);
    if (!freshAnimal) freshAnimal = animal;
    let freshClient = await getById('clients', freshAnimal.client_id);
    if (!freshClient) {
      showToast('Client associé introuvable.', 'error');
      return;
    }
    if (!freshClient.uuid) {
      freshClient.uuid = generateUUID();
      await update('clients', freshClient);
    }
    const portalUrl = getClientPortalUrl(freshClient.uuid);
    navigator.clipboard.writeText(portalUrl).then(() => {
      showToast('Lien Espace Client sécurisé copié dans le presse-papier !');
    }).catch(err => {
      console.error('Erreur copie lien:', err);
      showToast('Impossible de copier le lien.', 'error');
    });
  };

  document.getElementById('btn-edit-animal-detail').onclick = () => {
    openAnimalDialog(animal);
  };

  const addExtSessionBtn = document.getElementById('btn-add-external-session-for-animal');
  if (addExtSessionBtn) {
    addExtSessionBtn.onclick = () => {
      openExternalSessionDialog(null, animal.id);
    };
  }

  document.getElementById('btn-new-session-for-animal').onclick = () => {
    window.location.hash = `session-editor/animal-${animal.id}`;
  };

  document.getElementById('btn-associate-prof').onclick = () => {
    openAssociateProfsDialog(animal);
  };

  const addReminderForAnimalBtn = document.getElementById('btn-add-reminder-for-animal');
  if (addReminderForAnimalBtn) {
    addReminderForAnimalBtn.onclick = () => {
      openReminderDialog(null, animal.id);
    };
  }

  const addMedicalEventBtn = document.getElementById('btn-add-medical-event');
  if (addMedicalEventBtn) {
    addMedicalEventBtn.onclick = () => {
      openMedicalEventDialog(animal);
    };
  }

  const exportDossierBtn = document.getElementById('btn-export-animal-dossier');
  if (exportDossierBtn) {
    exportDossierBtn.onclick = () => {
      openExportAnimalDossierModal(animal);
    };
  }
}

// Helpers for Leaflet geocoding with official French API Adresse and Nominatim fallbacks
async function fetchFromFrenchApi(query) {
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.features && data.features.length > 0) {
      const feat = data.features[0];
      if (feat.geometry && feat.geometry.coordinates) {
        const lon = feat.geometry.coordinates[0];
        const lat = feat.geometry.coordinates[1];
        return [lat, lon];
      }
    }
  } catch (err) {
    console.error('French API Adresse error for query:', query, err);
  }
  return null;
}

async function fetchFromNominatim(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query + ', France')}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'eKiKare-App/1.0'
      }
    });
    const data = await res.json();
    if (data && data.length > 0) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
  } catch (err) {
    console.error('Nominatim API error for query:', query, err);
  }
  return null;
}

async function getCoordsForLocation(loc) {
  const cacheKey = `geo_cache_${normalizeText(loc.zip || '')}_${normalizeText(loc.city || '')}_${normalizeText(loc.address || '')}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const zip = (loc.zip || '').trim();
  const city = (loc.city || '').trim() === 'Ville non spécifiée' ? '' : (loc.city || '').trim();
  const address = (loc.address || '').trim();

  // Cascade fallbacks
  // Try 1: Full Query (Rue + CP + Ville)
  if (address && zip && city) {
    const q1 = `${address} ${zip} ${city}`;
    let coords = await fetchFromFrenchApi(q1);
    if (!coords) coords = await fetchFromNominatim(q1);
    if (coords) {
      localStorage.setItem(cacheKey, JSON.stringify(coords));
      return coords;
    }
  }

  // Try 2: Rue + Ville
  if (address && city) {
    const q2 = `${address} ${city}`;
    let coords = await fetchFromFrenchApi(q2);
    if (!coords) coords = await fetchFromNominatim(q2);
    if (coords) {
      localStorage.setItem(cacheKey, JSON.stringify(coords));
      return coords;
    }
  }

  // Try 3: Code Postal + Ville (centre-ville fallback)
  if (zip && city) {
    const q3 = `${zip} ${city}`;
    let coords = await fetchFromFrenchApi(q3);
    if (!coords) coords = await fetchFromNominatim(q3);
    if (coords) {
      localStorage.setItem(cacheKey, JSON.stringify(coords));
      return coords;
    }
  } else if (city) {
    const q3_city = `${city}`;
    let coords = await fetchFromFrenchApi(q3_city);
    if (!coords) coords = await fetchFromNominatim(q3_city);
    if (coords) {
      localStorage.setItem(cacheKey, JSON.stringify(coords));
      return coords;
    }
  } else if (zip) {
    const q3_zip = `${zip}`;
    let coords = await fetchFromFrenchApi(q3_zip);
    if (!coords) coords = await fetchFromNominatim(q3_zip);
    if (coords) {
      localStorage.setItem(cacheKey, JSON.stringify(coords));
      return coords;
    }
  }

  // Fallback default coordinates if all fail (Center of France)
  const defaultCoords = [46.603354, 1.888334];
  return defaultCoords;
}

// --- RENDU : LIEUX DE VIE / TOURNEES ---
async function renderTournee() {
  const modeSelect = document.getElementById('tournee-grouping-mode');
  const groupingMode = modeSelect ? modeSelect.value : 'location'; // default: location

  const clients = await getAll('clients');
  const animals = await getAll('animals');
  
  const container = document.getElementById('tournee-container');
  container.innerHTML = '';

  // Setup toggle button and map visibility
  const toggleBtn = document.getElementById('btn-toggle-tours-map');
  const toggleText = document.getElementById('btn-toggle-tours-map-text');
  const mapContainer = document.getElementById('tours-map-container');
  const cardHeaderAction = toggleBtn ? toggleBtn.closest('.card-header-action') : null;
  
  if (toggleBtn && mapContainer && !toggleBtn.dataset.listener) {
    toggleBtn.dataset.listener = 'true';
    
    // Always hide on init
    mapContainer.style.display = 'none';
    if (toggleText) toggleText.textContent = 'Afficher la carte des lieux de vie';
    if (cardHeaderAction) cardHeaderAction.style.margin = '0';

    toggleBtn.onclick = () => {
      const currentlyHidden = mapContainer.style.display === 'none';
      if (currentlyHidden) {
        mapContainer.style.display = 'block';
        if (toggleText) toggleText.textContent = 'Masquer la carte';
        if (cardHeaderAction) cardHeaderAction.style.marginBottom = '12px';
        if (toursMap) {
          setTimeout(() => {
            toursMap.invalidateSize();
            if (toursMarkers.length > 0) {
              const coords = toursMarkers.map(m => m.getLatLng());
              const bounds = L.latLngBounds(coords);
              toursMap.fitBounds(bounds, { padding: [30, 30] });
            }
          }, 50);
        }
      } else {
        mapContainer.style.display = 'none';
        if (toggleText) toggleText.textContent = 'Afficher la carte des lieux de vie';
        if (cardHeaderAction) cardHeaderAction.style.marginBottom = '0';
      }
    };
  } else if (toggleBtn && mapContainer) {
    // Reset to closed state on every view refresh/enter
    mapContainer.style.display = 'none';
    if (toggleText) toggleText.textContent = 'Afficher la carte des lieux de vie';
    if (cardHeaderAction) cardHeaderAction.style.marginBottom = '0';
  }

  // Initialize Leaflet Map
  const mapElement = document.getElementById('tours-map');
  if (mapElement && !toursMap) {
    toursMap = L.map('tours-map').setView([46.603354, 1.888334], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(toursMap);
  }

  const searchInput = document.getElementById('tournee-search-input');
  if (searchInput && !searchInput.dataset.listener) {
    searchInput.dataset.listener = 'true';
    searchInput.addEventListener('input', renderTournee);
  }
  const filterVal = searchInput ? searchInput.value.toLowerCase().trim() : '';

  if (animals.length === 0) {
    container.innerHTML = '<p class="empty-state">Aucun animal à planifier.</p>';
    if (toursMap) {
      toursMarkers.forEach(m => toursMap.removeLayer(m));
      toursMarkers = [];
    }
    return;
  }

  // Filter animals based on search input
  const filteredAnimals = animals.filter(an => {
    if (!filterVal) return true;
    const term = normalizeText(filterVal);
    const client = clients.find(cl => cl.id === an.client_id);
    const ownerName = client ? `${client.prenom} ${client.nom}` : '';
    
    let stableName = (an.stable_name || '').trim();
    let stableAddress = (an.stable_address || '').trim();
    let stableZip = (an.stable_zip || '').trim();
    let stableCity = (an.stable_city || '').trim();
    if (!stableName && !stableAddress && !stableZip && !stableCity) {
      const fallbackLoc = an.lieu_de_vie || '';
      if (fallbackLoc && fallbackLoc !== 'Non spécifié') {
        stableName = fallbackLoc;
        const parsed = parseAddress(fallbackLoc);
        stableAddress = parsed.address;
        stableZip = parsed.zip;
        stableCity = parsed.city;
      }
    }
    if (stableAddress && !stableZip && !stableCity) {
      const parsed = parseAddress(stableAddress);
      stableAddress = parsed.address;
      stableZip = parsed.zip;
      stableCity = parsed.city;
    }
    stableName = stableName || 'Domicile / Pré privé';
    stableCity = stableCity || 'Ville non spécifiée';
    const deptName = getDepartmentDisplay(stableZip);

    return normalizeText(an.nom).includes(term) ||
           normalizeText(an.espece).includes(term) ||
           normalizeText(ownerName).includes(term) ||
           normalizeText(stableName).includes(term) ||
           normalizeText(stableAddress).includes(term) ||
           normalizeText(stableZip).includes(term) ||
           normalizeText(stableCity).includes(term) ||
           normalizeText(deptName).includes(term);
  });

  if (filteredAnimals.length === 0) {
    container.innerHTML = '<p class="empty-state">Aucun animal ne correspond à votre recherche.</p>';
    if (toursMap) {
      toursMarkers.forEach(m => toursMap.removeLayer(m));
      toursMarkers = [];
    }
    return;
  }

  if (groupingMode === 'location') {
    // 1. Grouper les animaux par lieu de vie (Département -> Ville -> Écurie)
    const depts = {};
    
    filteredAnimals.forEach(an => {
      const client = clients.find(cl => cl.id === an.client_id);
      
      let stableName = (an.stable_name || '').trim();
      let stableAddress = (an.stable_address || '').trim();
      let stableZip = (an.stable_zip || '').trim();
      let stableCity = (an.stable_city || '').trim();
      let stableDistance = an.stable_distance || 0;
      
      // Fallback si l'animal n'a pas encore les champs découpés (tous les champs nouveaux sont vides)
      if (!stableName && !stableAddress && !stableZip && !stableCity) {
        const fallbackLoc = an.lieu_de_vie || '';
        if (fallbackLoc && fallbackLoc !== 'Non spécifié') {
          stableName = fallbackLoc;
          const parsed = parseAddress(fallbackLoc);
          stableAddress = parsed.address;
          stableZip = parsed.zip;
          stableCity = parsed.city;
        }
      }
      
      // Si stable_address est configuré mais pas zip/city (ancien format)
      if (stableAddress && !stableZip && !stableCity) {
        const parsed = parseAddress(stableAddress);
        stableAddress = parsed.address;
        stableZip = parsed.zip;
        stableCity = parsed.city;
      }
      
      stableName = stableName || 'Domicile / Pré privé';
      stableCity = stableCity || 'Ville non spécifiée';
      
      const deptName = getDepartmentDisplay(stableZip);
      
      if (!depts[deptName]) {
        depts[deptName] = {};
      }
      if (!depts[deptName][stableCity]) {
        depts[deptName][stableCity] = {};
      }
      if (!depts[deptName][stableCity][stableName]) {
        depts[deptName][stableCity][stableName] = {
          address: stableAddress,
          zip: stableZip,
          distance: stableDistance,
          animals: []
        };
      }
      
      depts[deptName][stableCity][stableName].animals.push({ animal: an, client });
    });

    const sortedDeptKeys = Object.keys(depts).sort((a, b) => {
      if (a === 'Département non spécifié') return 1;
      if (b === 'Département non spécifié') return -1;
      return a.localeCompare(b, 'fr');
    });
    
    sortedDeptKeys.forEach(deptKey => {
      const deptBox = document.createElement('div');
      deptBox.className = 'tournee-dept-box';
      
      const citiesCount = Object.keys(depts[deptKey]).length;
      
      deptBox.innerHTML = `
        <div class="tournee-dept-header">
          <span>🗺️ &nbsp; ${deptKey}</span>
          <span class="tournee-count-badge">${citiesCount} ville(s)</span>
        </div>
        <div class="tournee-dept-content"></div>
      `;
      
      const deptContent = deptBox.querySelector('.tournee-dept-content');
      
      const sortedCities = Object.keys(depts[deptKey]).sort((a, b) => {
        if (a === 'Ville non spécifiée') return 1;
        if (b === 'Ville non spécifiée') return -1;
        return a.localeCompare(b, 'fr');
      });
      
      sortedCities.forEach(cityName => {
        const cityBox = document.createElement('div');
        cityBox.className = 'tournee-city-box';
        
        cityBox.innerHTML = `
          <div class="tournee-city-header">
            <span>🏙️ &nbsp; ${cityName}</span>
          </div>
          <div class="tournee-city-content"></div>
        `;
        
        const cityContent = cityBox.querySelector('.tournee-city-content');
        
        const sortedStables = Object.keys(depts[deptKey][cityName]).sort((a, b) => {
          if (a === 'Domicile / Pré privé') return 1;
          if (b === 'Domicile / Pré privé') return -1;
          if (a === 'Non spécifié') return 1;
          if (b === 'Non spécifié') return -1;
          return a.localeCompare(b, 'fr');
        });
        
        sortedStables.forEach(stableName => {
          const stableData = depts[deptKey][cityName][stableName];
          const stableBox = document.createElement('div');
          stableBox.className = 'tournee-stable-box';
          
          const metaParts = [];
          if (stableData.address) metaParts.push(stableData.address);
          if (stableData.zip) metaParts.push(stableData.zip);
          const addrStr = metaParts.join(', ');
          const distStr = stableData.distance ? `${stableData.distance} km` : '';
          let metaStr = '';
          if (addrStr && distStr) {
            metaStr = `${addrStr} &bull; ${distStr}`;
          } else {
            metaStr = addrStr || distStr || '';
          }
          
          stableBox.innerHTML = `
            <div class="tournee-stable-header">
              <span class="stable-name-icon">📍 &nbsp; ${stableName}</span>
              <span class="stable-meta-info">${metaStr}</span>
            </div>
            <div class="tournee-animals-grid"></div>
          `;
          
          const grid = stableBox.querySelector('.tournee-animals-grid');
          stableData.animals.forEach(item => {
            const aCard = document.createElement('div');
            aCard.className = 'tournee-animal-card';
            
            const ownerName = item.client ? `${item.client.prenom} ${item.client.nom}` : 'Propriétaire inconnu';
            
            aCard.innerHTML = `
              <div class="tournee-animal-name">${item.animal.nom}</div>
              <div class="tournee-animal-meta">${item.animal.espece} &bull; ${item.animal.race || '-'}</div>
              <div class="tournee-animal-meta" style="color:var(--color-primary); font-weight:600; margin-top:4px;">Proprio : ${ownerName}</div>
            `;
            
            aCard.addEventListener('click', () => {
              window.location.hash = `animals/${item.animal.id}`;
            });
            grid.appendChild(aCard);
          });
          
          cityContent.appendChild(stableBox);
        });
        
        cityBox.appendChild(cityContent);
        deptContent.appendChild(cityBox);
      });
      
      container.appendChild(deptBox);
    });
  } else {
    // 2. Grouper les animaux par Client
    for (const c of clients) {
      const clientAnimals = filteredAnimals.filter(an => an.client_id === c.id);
      if (clientAnimals.length === 0) continue;

      const clientCard = document.createElement('div');
      clientCard.className = 'tournee-card';
      
      clientCard.innerHTML = `
        <div class="tournee-card-header">${c.prenom} ${c.nom.toUpperCase()}</div>
        <div class="tournee-location-box" style="padding:15px;">
          <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:10px;">
            Adresse : ${c.adresse || '-'} &bull; Tel : ${c.telephone}
          </div>
          <div class="tournee-animals-grid"></div>
        </div>
      `;

      const grid = clientCard.querySelector('.tournee-animals-grid');
      for (const an of clientAnimals) {
        const aCard = document.createElement('div');
        aCard.className = 'tournee-animal-card';
        
        aCard.innerHTML = `
          <div class="tournee-animal-name">${an.nom}</div>
          <div class="tournee-animal-meta">${an.espece} &bull; ${an.race || '-'}</div>
          <div class="tournee-animal-meta" style="color:var(--color-secondary); font-weight:600; margin-top:4px;">Lieu : ${an.stable_name || an.lieu_de_vie || 'Non spécifié'}</div>
        `;

        aCard.addEventListener('click', () => {
          window.location.hash = `animals/${an.id}`;
        });
        grid.appendChild(aCard);
      }

      container.appendChild(clientCard);
    }
  }

  // Populate the Leaflet Map
  if (toursMap) {
    // Clear existing markers
    toursMarkers.forEach(m => toursMap.removeLayer(m));
    toursMarkers = [];

    // Group animals by unique location for map markers
    const locations = {};
    filteredAnimals.forEach(an => {
      let stableName = (an.stable_name || '').trim();
      let stableAddress = (an.stable_address || '').trim();
      let stableZip = (an.stable_zip || '').trim();
      let stableCity = (an.stable_city || '').trim();
      let stableDistance = an.stable_distance || 0;

      // Fallback
      if (!stableName && !stableAddress && !stableZip && !stableCity) {
        const fallbackLoc = an.lieu_de_vie || '';
        if (fallbackLoc && fallbackLoc !== 'Non spécifié') {
          stableName = fallbackLoc;
          const parsed = parseAddress(fallbackLoc);
          stableAddress = parsed.address;
          stableZip = parsed.zip;
          stableCity = parsed.city;
        }
      }
      if (stableAddress && !stableZip && !stableCity) {
        const parsed = parseAddress(stableAddress);
        stableAddress = parsed.address;
        stableZip = parsed.zip;
        stableCity = parsed.city;
      }

      stableName = stableName || 'Domicile / Pré privé';
      stableCity = stableCity || 'Ville non spécifiée';
      
      const key = `${stableName} | ${stableAddress} | ${stableZip} | ${stableCity}`;
      if (!locations[key]) {
        locations[key] = {
          name: stableName,
          address: stableAddress,
          zip: stableZip,
          city: stableCity,
          distance: stableDistance,
          animals: []
        };
      }
      const client = clients.find(cl => cl.id === an.client_id);
      locations[key].animals.push({ animal: an, client });
    });

    const markersCoords = [];

    for (const key of Object.keys(locations)) {
      const loc = locations[key];
      const coords = await getCoordsForLocation(loc);
      markersCoords.push(coords);

      const animalsList = loc.animals.map(item => {
        const emojiMap = {
          'cheval': '🐴',
          'chien': '🐕',
          'chat': '🐱'
        };
        const emoji = emojiMap[item.animal.espece.toLowerCase()] || '🐾';
        const ownerName = item.client ? `${item.client.prenom} ${item.client.nom}` : '-';
        return `<li style="margin: 4px 0; font-size: 0.85rem; color: #1e293b;">
          <span>${emoji}</span> <strong>${item.animal.nom}</strong> (Propriétaire : ${ownerName})
        </li>`;
      }).join('');

      const distText = loc.distance ? ` &bull; ${loc.distance} km` : '';
      const popupHtml = `
        <div style="font-family: 'Outfit', sans-serif; color: #1e293b; padding: 4px; min-width: 200px;">
          <h4 style="margin: 0 0 4px 0; font-size: 0.95rem; font-weight: 600; color: #0f172a;">${loc.name}</h4>
          <p style="margin: 0 0 8px 0; font-size: 0.8rem; color: #64748b;">${loc.address ? loc.address + ', ' : ''}${loc.zip} ${loc.city}${distText}</p>
          <div style="border-top: 1px solid #e2e8f0; padding-top: 6px;">
            <strong style="font-size: 0.8rem; color: #334155;">Animaux (${loc.animals.length}) :</strong>
            <ul style="margin: 4px 0 0 0; padding-left: 15px; list-style-type: disc;">
              ${animalsList}
            </ul>
          </div>
        </div>
      `;

      const marker = L.marker(coords).addTo(toursMap).bindPopup(popupHtml);
      toursMarkers.push(marker);
    }

    if (markersCoords.length > 0 && mapContainer && mapContainer.style.display !== 'none') {
      setTimeout(() => {
        toursMap.invalidateSize();
        const bounds = L.latLngBounds(markersCoords);
        toursMap.fitBounds(bounds, { padding: [30, 30] });
      }, 100);
    }
  }
}

// Configurer le listener de changement de filtre Tournée
const tourneeGroupingSelect = document.getElementById('tournee-grouping-mode');
if (tourneeGroupingSelect) {
  tourneeGroupingSelect.addEventListener('change', renderTournee);
}

// --- RENDU : LISTE DES SEANCES ---
async function renderSessionsList() {
  const sessions = await getAll('sessions');
  const animals = await getAll('animals');
  const clients = await getAll('clients');

  const searchInput = document.getElementById('session-search-input');
  if (searchInput && !searchInput.dataset.listener) {
    searchInput.dataset.listener = 'true';
    searchInput.addEventListener('input', renderSessionsList);
  }
  const filterVal = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const tbody = document.getElementById('sessions-table-body');
  tbody.innerHTML = '';

  // Trier par date descendante (plus récentes d'abord)
  const ownSessions = sessions.filter(s => !s.isExternal);
  ownSessions.sort((a, b) => new Date(b.date_seance) - new Date(a.date_seance));

  const filtered = ownSessions.filter(s => {
    if (!filterVal) return true;
    
    const animal = animals.find(an => an.id === s.animal_id);
    const client = clients.find(cl => cl.id === s.client_id);
    
    const animalName = animal ? animal.nom.toLowerCase() : '';
    const ownerName = client ? `${client.prenom} ${client.nom}`.toLowerCase() : '';
    const motifText = s.motif ? s.motif.toLowerCase() : '';
    
    return animalName.includes(filterVal) || ownerName.includes(filterVal) || motifText.includes(filterVal);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Aucune séance trouvée.</td></tr>';
  } else {
    for (const s of filtered) {
      const animal = animals.find(an => an.id === s.animal_id);
      const client = clients.find(cl => cl.id === s.client_id);
      
      const animalName = animal ? animal.nom : 'Animal supprimé';
      const ownerName = client ? `${client.prenom} ${client.nom}` : '-';

      const resumePreview = s.resume_client_genere 
        ? (s.resume_client_genere.length > 50 ? s.resume_client_genere.substring(0, 50) + '...' : s.resume_client_genere) 
        : '<span class="text-muted" style="font-style:italic;">Aucun résumé</span>';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${formatDate(s.date_seance)}</strong></td>
        <td>${animalName}</td>
        <td>${ownerName}</td>
        <td>${s.motif}</td>
        <td class="text-sub" style="font-size: 0.85rem;">${resumePreview}</td>
        <td>${s.n_seance_annee || 1}</td>
        <td class="actions-column">
          <button class="btn btn-secondary btn-small btn-view-session" data-id="${s.id}">Consulter</button>
        </td>
      `;

      tr.addEventListener('click', () => { window.location.hash = `sessions/${s.id}`; });
      tr.querySelector('.btn-view-session').addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.hash = `sessions/${s.id}`;
      });

      tbody.appendChild(tr);
    }
  }
}

// --- RENDU : COMPTE-RENDU (DÉTAILS SÉANCE) ---

function formatTensegriteReportData(t, isClientSummary = false) {
  if (!t) return '';
  
  const catStrings = [];

  function formatDetailedCategory(catData, label, subsDef) {
    if (!catData) return null;
    const activeSubs = [];
    for (const subKey in subsDef) {
      const val = catData[subKey];
      if (val === 'Moyen' || val === 'Élevé') {
        activeSubs.push(`${subsDef[subKey]} (${val})`);
      }
    }
    if (activeSubs.length > 0) {
      return `• ${label} : ${activeSubs.join(', ')}`;
    }
    return null;
  }

  // 1. FTM
  if (t.ftm) {
    if (isClientSummary) {
      const override = t.ftm.override || 'Faible';
      if (override === 'Moyen' || override === 'Élevé') {
        catStrings.push(`• FTM (${override})`);
      }
    } else {
      const ftmStr = formatDetailedCategory(t.ftm, 'FTM', {
        queue: 'Queue',
        oeil_droit: 'Œil Droit',
        oeil_gauche: 'Œil Gauche',
        energetique: 'Énergétique'
      });
      if (ftmStr) catStrings.push(ftmStr);
    }
  }

  // 2. Torsion Physiologique
  if (t.torsion) {
    if (isClientSummary) {
      const override = t.torsion.override || 'Faible';
      if (override === 'Moyen' || override === 'Élevé') {
        catStrings.push(`• Torsion Physiologique (${override})`);
      }
    } else {
      const torsionStr = formatDetailedCategory(t.torsion, 'Torsion Physiologique', {
        hanche_droite: 'Hanche Droite',
        hanche_gauche: 'Hanche Gauche',
        occiput: 'Occiput'
      });
      if (torsionStr) catStrings.push(torsionStr);
    }
  }

  // 3. Diaphragmes
  const diaphragmeStr = formatDetailedCategory(t.diaphragme, 'Diaphragmes', {
    pelvien: 'Pelvien',
    thoraco_lombaire: 'Thoraco-lombaire',
    cervico_thoracique: 'Cervico-thoracique',
    c0_c1: 'C0-C1'
  });
  if (diaphragmeStr) catStrings.push(diaphragmeStr);

  // 4. Loges
  const logeStr = formatDetailedCategory(t.loge, 'Loges', {
    digestive: 'Digestive',
    thoracique: 'Thoracique',
    gorge: 'Gorge',
    cervelet: 'Cervelet'
  });
  if (logeStr) catStrings.push(logeStr);

  return catStrings.join('\n');
}

// Rendu détaillé CR (réservé au praticien)
function renderDetailedCR(session) {
  let html = `<h3 style="margin-top: 0; color: var(--color-secondary); font-size:1.15rem; border-bottom:1px solid var(--glass-border); padding-bottom:5px;">CR Métier Détaillé (Espace Praticienne)</h3>`;
  
  // 1. Notes d'observation de début de séance
  if (session.notes_observations) {
    html += `<div style="margin-bottom: 20px;"><strong>1. Notes d'observation de début de séance :</strong><p style="white-space: pre-line; margin-top:5px; background:rgba(255,255,255,0.02); padding:10px; border-radius:4px; border:1px solid var(--glass-border);">${session.notes_observations}</p></div>`;
  } else {
    html += `<div style="margin-bottom: 20px;"><strong>1. Notes d'observation de début de séance :</strong><p class="text-muted" style="margin-top:5px; font-style:italic;">Aucune note d'observation saisie.</p></div>`;
  }

  // 2. Protocoles réalisés (avec détails techniques Shiatsu abréviations, Tenségrité complet, Cranio-Sacrée, Kinésio, Aura, etc., et le schéma anatomique annoté)
  const p = session.protocoles_realises || {};
  let protocolsListHtml = '';

  // Shiatsu
  if (p.shiatsu && p.shiatsu.checked) {
    const items = [];
    const ys = p.shiatsu.yin || {};
    const ygs = p.shiatsu.yang || {};
    const v = p.shiatsu.vaisseaux || {};

    if (ys.foie) items.push('F<sup>2</sup>');
    if (ys.maitre_coeur) items.push('MC<sup>2</sup>');
    if (ys.coeur) items.push('C<sup>3</sup>');
    if (ys.rate) items.push('Rte<sup>1</sup>');
    if (ys.poumon) items.push('P<sup>1</sup>');
    if (ys.reins) items.push('Rein<sup>3</sup>');

    if (ygs.vesicule) items.push('VB<sup>2</sup>');
    if (ygs.triple) items.push('TR<sup>2</sup>');
    if (ygs.grele) items.push('IG<sup>1</sup>');
    if (ygs.estomac) items.push('E<sup>3</sup>');
    if (ygs.gros_intestin) items.push('GI<sup>3</sup>');
    if (ygs.vessie) items.push('V<sup>1</sup>');

    if (v.gouverneur) items.push('VG');
    if (v.conception) items.push('VC');

    protocolsListHtml += `<div style="padding:10px; border:1px solid var(--glass-border); border-radius:4px; background:rgba(255,255,255,0.01);">
      <strong style="color:var(--color-primary)">Shiatsu</strong>
      <p style="margin:5px 0 0 0; font-size:0.9rem;">
        ${items.join(', ') || 'aucun'}
      </p>
      ${p.shiatsu.precisions ? `<p style="margin:4px 0 0 0; font-size:0.85rem; font-style:italic;">Précisions : ${p.shiatsu.precisions}</p>` : ''}
    </div>`;
  }
  
  // Manual Tech
  if (p.manuelles && p.manuelles.checked) {
    protocolsListHtml += `<div style="padding:10px; border:1px solid var(--glass-border); border-radius:4px; background:rgba(255,255,255,0.01);">
      <strong style="color:var(--color-primary)">Techniques manuelles</strong>
      <p style="margin:5px 0 0 0; font-size:0.9rem; white-space:pre-line;">${p.manuelles.texte || 'Aucune observation saisie.'}</p>
    </div>`;
  }
  
  // Tenségrité
  if (p.tensegrite && p.tensegrite.checked) {
    const rawTensegriteStr = formatTensegriteReportData(p.tensegrite);
    const tensegriteHtml = rawTensegriteStr 
      ? rawTensegriteStr.replace(/\n/g, '<br>') 
      : '• Aucune tension majeure';

    protocolsListHtml += `<div style="padding:10px; border:1px solid var(--glass-border); border-radius:4px; background:rgba(255,255,255,0.01);">
      <strong style="color:var(--color-primary)">Tenségrité</strong>
      <p style="margin:5px 0 0 0; font-size:0.9rem; font-weight:bold; color:var(--text-main);">item et zones travaillés :</p>
      <p style="margin:3px 0 0 0; font-size:0.9rem; line-height:1.4;">
        ${tensegriteHtml}
      </p>
      ${p.tensegrite.helices ? `<p style="margin:4px 0 0 0; font-size:0.85rem;"><strong>Hélices :</strong> ${p.tensegrite.helices}</p>` : ''}
      ${p.tensegrite.precisions ? `<p style="margin:4px 0 0 0; font-size:0.85rem; font-style:italic;">Précisions : ${p.tensegrite.precisions}</p>` : ''}
    </div>`;
  }

  // Cranio
  if (p.cranio && p.cranio.checked) {
    const lines = [];

    if (p.cranio.ambiance) {
      lines.push(`• Ambiance émotionnelle : ${p.cranio.ambiance}`);
    }

    const adaptatifList = [];
    if (p.cranio.adaptatif) {
      if (p.cranio.adaptatif.sacro) adaptatifList.push("Sacro-iliaque");
      if (p.cranio.adaptatif.rre) adaptatifList.push("Os du crâne");
      if (p.cranio.adaptatif.occiput) adaptatifList.push("Occiput");
      if (p.cranio.adaptatif.couple) adaptatifList.push("Couple scapho-cuboïdien");
      if (p.cranio.adaptatif.strains) adaptatifList.push("sphénoïde");
      if (p.cranio.adaptatif.grosse_art) adaptatifList.push("Grosse articulation");
    }
    if (adaptatifList.length > 0) {
      lines.push(`• Adaptatif : ${adaptatifList.join(', ')}`);
    }

    const pelvienneList = [];
    if (p.cranio.somatique) {
      if (p.cranio.somatique.iliaque_ensemble) pelvienneList.push("Iliaques ensemble");
      if (p.cranio.somatique.coccygienne) pelvienneList.push("Coccygienne");
      if (p.cranio.somatique.ixions) pelvienneList.push("Ixions");
      if (p.cranio.somatique.pubis) pelvienneList.push("Pubis");
      if (p.cranio.somatique.iliaque_indep) pelvienneList.push("Iliaques indép.");
      if (p.cranio.somatique.sacrum_liaison) pelvienneList.push("Liaison Iliaque-Sacrum");
    }
    if (pelvienneList.length > 0) {
      lines.push(`• Ceinture pelvienne : ${pelvienneList.join(', ')}`);
    }

    const autresList = [];
    if (p.cranio.somatique) {
      if (p.cranio.somatique.vertebres) autresList.push("Vertèbres");
      if (p.cranio.somatique.scapulaire) autresList.push("Ceinture scapulaire");
      if (p.cranio.somatique.ant_complet) autresList.push("Membres ant.");
      if (p.cranio.somatique.post_complet) autresList.push("Membres post.");
      if (p.cranio.somatique.genoux) autresList.push("Genoux");
      if (p.cranio.somatique.jarrets) autresList.push("Jarrets");
      if (p.cranio.somatique.visceres) {
        autresList.push("Viscères" + (p.cranio.somatique.visceres_text ? ` (${p.cranio.somatique.visceres_text})` : ''));
      }
    }
    if (autresList.length > 0) {
      lines.push(`• Autres structures : ${autresList.join(', ')}`);
    }

    const cranioHtml = lines.length > 0 
      ? lines.join('<br>') 
      : '• Aucune zone spécifique';

    protocolsListHtml += `<div style="padding:10px; border:1px solid var(--glass-border); border-radius:4px; background:rgba(255,255,255,0.01);">
      <strong style="color:var(--color-primary)">Cranio-Sacrée</strong>
      <p style="margin:5px 0 0 0; font-size:0.9rem; line-height:1.4;">
        ${cranioHtml}
      </p>
      ${p.cranio.precisions ? `<p style="margin:4px 0 0 0; font-size:0.85rem; font-style:italic;">Précisions : ${p.cranio.precisions}</p>` : ''}
    </div>`;
  }
  
  // Kinésio
  if (p.kinesiologie && p.kinesiologie.checked) {
    const partsHtml = [];
    
    if (p.kinesiologie.problematique) {
      partsHtml.push(`<p style="margin:15px 0 0 0; font-size:0.9rem; white-space:pre-line;"><strong><u>Problématique travaillée :</u></strong>\n${p.kinesiologie.problematique}</p>`);
    }
    
    if (p.kinesiologie.type === 'Émotions réactives') {
      if (p.kinesiologie.emot_reactives) {
        partsHtml.push(`<p style="margin:15px 0 0 0; font-size:0.9rem; white-space:pre-line;"><strong><u>Émotions réactives :</u></strong>\n${p.kinesiologie.emot_reactives}</p>`);
      }
      if (p.kinesiologie.emot_reactrice) {
        partsHtml.push(`<p style="margin:15px 0 0 0; font-size:0.9rem; white-space:pre-line;"><strong><u>Émotions réactrices :</u></strong>\n${p.kinesiologie.emot_reactrice}</p>`);
      }
    }
    
    if (p.kinesiologie.type === 'Émotion d’urgence' || p.kinesiologie.type === "Émotion d'urgence") {
      if (p.kinesiologie.emot_liberee) {
        partsHtml.push(`<p style="margin:15px 0 0 0; font-size:0.9rem; white-space:pre-line;"><strong><u>Émotion d'urgence libérée :</u></strong>\n${p.kinesiologie.emot_liberee}</p>`);
      }
    }
    
    if (p.kinesiologie.type !== 'Émotions réactives' && p.kinesiologie.type !== 'Émotion d’urgence' && p.kinesiologie.type !== "Émotion d'urgence" && p.kinesiologie.syntho) {
      partsHtml.push(`<p style="margin:15px 0 0 0; font-size:0.9rem; white-space:pre-line;"><strong><u>Syntonisation :</u></strong>\n${p.kinesiologie.syntho}</p>`);
    }
    
    if (p.kinesiologie.objectif) {
      partsHtml.push(`<p style="margin:15px 0 0 0; font-size:0.9rem; white-space:pre-line;"><strong><u>Objectif :</u></strong>\n${p.kinesiologie.objectif}</p>`);
    }
    
    if (p.kinesiologie.ldt) {
      partsHtml.push(`<p style="margin:15px 0 0 0; font-size:0.9rem; white-space:pre-line;"><strong><u>Ligne de Temps (LDT) :</u></strong>\n${p.kinesiologie.ldt}</p>`);
    }
    
    // CEN
    partsHtml.push(`<p style="margin:15px 0 0 0; font-size:0.9rem;"><strong><u>CEN :</u></strong> de ${p.kinesiologie.cen_debut || 0}% à ${p.kinesiologie.cen_fin || 0}%</p>`);
    
    if (p.kinesiologie.precisions) {
      partsHtml.push(`<p style="margin:15px 0 0 0; font-size:0.85rem; font-style:italic; white-space:pre-line;"><strong><u>Précisions Kinésiologie :</u></strong>\n${p.kinesiologie.precisions}</p>`);
    }
    
    protocolsListHtml += `<div style="padding:10px; border:1px solid var(--glass-border); border-radius:4px; background:rgba(255,255,255,0.01);">
      <strong style="color:var(--color-primary)">Kinésiologie (${p.kinesiologie.type})</strong>
      ${partsHtml.join('')}
    </div>`;
  }
  
  // Aura
  if (p.aura && p.aura.checked) {
    const list = [];
    if (p.aura.recentrage) list.push("Recentrage de l'aura");
    if (p.aura.liens) list.push("Section des liens énergétiques");
    if (p.aura.vidange) list.push("Vidange des énergies usagées");
    
    // Filet
    if (p.aura.filet) {
      const fList = [];
      if (p.aura.filet_options) {
        if (p.aura.filet_options.energies) fList.push('énergies négatives');
        if (p.aura.filet_options.emotions) fList.push('émotions négatives');
        if (p.aura.filet_options.parasites) fList.push('parasites');
        if (p.aura.filet_options.entites) fList.push('petites entités');
        if (p.aura.filet_options.sorts) fList.push('sorts');
        if (p.aura.filet_options.incorporations) fList.push('incorporations');
      }
      list.push("Technique du filet" + (fList.length > 0 ? ` [${fList.join(', ')}]` : ''));
    }
    
    if (p.aura.fleches) list.push("Élimination des flèches" + (p.aura.fleches_loc ? " : " + p.aura.fleches_loc : ""));
    if (p.aura.masses) list.push("Élimination des masses" + (p.aura.masses_loc ? " : " + p.aura.masses_loc : ""));
    if (p.aura.recharge) list.push("Recharge énergétique & comblement");
    if (p.aura.chakras) list.push("Régulation des chakras");
    if (p.aura.circulation) list.push("Relance de la circulation générale");
    if (p.aura.mouvement) list.push("Relance du mouvement primordial");

    // Locaux
    if (p.aura.local_filament) list.push("Filament incandescent");
    if (p.aura.local_polarites) list.push("Équilibre polarités");
    if (p.aura.local_recharge) list.push("Recharge locale");
    if (p.aura.local_complement) list.push("Technique complémentaire" + (p.aura.local_complement_text ? ' (' + p.aura.local_complement_text + ')' : ''));
    if (p.aura.repolarisation) list.push("Repolarisation");

    const stepsHtml = list.map(item => `• ${item}`).join('<br>');

    protocolsListHtml += `<div style="padding:10px; border:1px solid var(--glass-border); border-radius:4px; background:rgba(255,255,255,0.01);">
      <strong style="color:var(--color-primary)">Aura</strong>
      <p style="margin:5px 0; font-size:0.9rem; line-height:1.45;">
        ${stepsHtml || 'Aucune étape spécifique'}
      </p>
      ${p.aura.precisions ? `<p style="margin:8px 0 0 0; font-size:0.85rem; font-style:italic; white-space:pre-line;">Précisions : ${p.aura.precisions}</p>` : ''}
    </div>`;
  }
  
  // Build the Protocols section container
  html += `<div style="margin-bottom: 20px;"><strong>2. Protocoles réalisés :</strong>`;
  if (protocolsListHtml) {
    html += `<div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">${protocolsListHtml}</div>`;
  } else {
    html += `<p class="text-muted" style="margin-top:5px; font-style:italic;">Aucun protocole réalisé lors de cette séance.</p>`;
  }

  // Schema inside the Protocols section
  if (session.canvas_annotation_image_blob) {
    html += `
      <div style="margin-top: 15px; text-align: center;">
        <strong style="display:block; margin-bottom:8px; text-align:left;">Schéma d'annotations de la séance :</strong>
        <div class="session-canvas-preview" style="border: 1px solid var(--glass-border); border-radius: 8px; padding: 10px; background: rgba(0, 0, 0, 0.2); max-width: 500px; margin: 0 auto;">
          <img src="${session.canvas_annotation_image_blob}" alt="Schéma d'annotations" style="max-width: 100%; height: auto; border-radius: 4px; display: block; margin: 0 auto;">
        </div>
      </div>
    `;
  }
  html += `</div>`;

  // 3. Notes cliniques privées / observations
  if (session.cr_personnel) {
    html += `<div style="margin-bottom: 20px;"><strong>3. Notes cliniques privées / observations :</strong><p style="white-space: pre-line; margin-top:5px; background:rgba(255,255,255,0.02); padding:10px; border-radius:4px; border:1px solid var(--glass-border);">${session.cr_personnel}</p></div>`;
  } else {
    html += `<div style="margin-bottom: 20px;"><strong>3. Notes cliniques privées / observations :</strong><p class="text-muted" style="margin-top:5px; font-style:italic;">Aucune note clinique privée saisie.</p></div>`;
  }

  // 4. Précisions générales de la séance (champ de précisions globales)
  if (session.precisions) {
    html += `<div style="margin-bottom: 20px;"><strong>4. Précisions générales de la séance :</strong><p style="white-space: pre-line; margin-top:5px; background:rgba(255,255,255,0.02); padding:10px; border-radius:4px; border:1px solid var(--glass-border);">${session.precisions}</p></div>`;
  } else {
    html += `<div style="margin-bottom: 20px;"><strong>4. Précisions générales de la séance :</strong><p class="text-muted" style="margin-top:5px; font-style:italic;">Aucune précision générale saisie.</p></div>`;
  }

  html += `</div>`;
  return html;
}

// Modal questionnaire de suivi
function openFollowupQDialog(session) {
  const dialog = document.getElementById('dialog-followup-q');
  const form = document.getElementById('dialog-followup-q-form');
  form.reset();

  buildQuestionnaireInputs('q-followup-dialog-container', session.q_3_semaines);

  const cancels = dialog.querySelectorAll('.btn-cancel-dialog, .btn-close-dialog');
  cancels.forEach(btn => {
    btn.onclick = () => dialog.close();
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const q3Data = collectQuestionnaireData('q-followup-dialog-container');
    session.q_3_semaines = q3Data;
    
    await update('sessions', session);
    showToast('Questionnaire de suivi enregistré avec succès.');
    dialog.close();
    await renderSessionDetails(session.id);
  };

  dialog.showModal();
}

function interpretMarkdownToHtml(text) {
  if (!text) return '';
  return text
    .replace(/(?:\r?\n)+\s*Précisions\s*:[\s\S]*$/i, '') // Supprimer bloc Précisions dupliqué
    .replace(/\s*-{3,}\s*/g, '<br><br>') // Supprimer tous les séparateurs ---
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>') // Convertir **texte** en <strong>texte</strong>
    .replace(/\*([^*]+?)\*/g, '<em>$1</em>') // Convertir *texte* en <em>texte</em>
    .replace(/\r?\n/g, '<br>')
    .replace(/(?:<br\s*\/?>\s*){3,}/g, '<br><br>') // Normaliser les sauts de lignes multiples
    .trim();
}

function formatTimelineSummary(text) {
  if (!text) return 'Aucun résumé client rédigé.';
  return text
    .replace(/(?:\r?\n)+\s*Précisions\s*:[\s\S]*$/i, '') // Supprimer bloc Précisions dupliqué
    .replace(/\s*-{3,}\s*/g, '\n\n') // Supprimer tous les séparateurs ---
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>') // Convertir **texte** en <strong>texte</strong>
    .replace(/\*([^*]+?)\*/g, '<em>$1</em>') // Convertir *texte* en <em>texte</em>
    .replace(/(?:\r?\n){3,}/g, '\n\n') // Normaliser les sauts de lignes multiples
    .trim();
}

async function renderSessionDetails(sessionId) {
  const session = await getById('sessions', sessionId);
  if (!session) {
    showToast('Séance introuvable.', 'error');
    window.location.hash = 'sessions';
    return;
  }

  const animal = await getById('animals', session.animal_id);
  const client = await getById('clients', session.client_id);

  // En-tête contextuel de la vue session
  const mainTitleEl = document.getElementById('session-detail-main-title');
  if (mainTitleEl) {
    mainTitleEl.textContent = `Compte-rendu — ${animal ? animal.nom : 'Animal'}`;
  }
  const subtitleEl = document.getElementById('session-detail-subtitle');
  if (subtitleEl) {
    const dateStr = formatDate(session.date_seance);
    const ownerStr = client ? ` • Propriétaire : ${client.prenom} ${client.nom.toUpperCase()}` : '';
    subtitleEl.textContent = `Séance du ${dateStr}${ownerStr}`;
  }

  document.getElementById('print-session-date').textContent = `Séance du : ${formatDate(session.date_seance)}`;
  
  if (client) {
    document.getElementById('print-client-name').textContent = `${client.prenom} ${client.nom.toUpperCase()}`;
    document.getElementById('print-client-contact').innerHTML = `Tél : ${client.telephone} &bull; E-mail : ${client.email || '-'}`;
  }
  
  if (animal) {
    document.getElementById('print-animal-name').textContent = animal.nom;
    document.getElementById('print-animal-identity').innerHTML = `${animal.espece} &bull; ${animal.race || '-'} ${animal.robe ? '('+animal.robe+')' : ''}`;
    document.getElementById('print-animal-details').innerHTML = `Sexe : ${animal.sexe || '-'} &bull; Âge : ${calculateAge(animal.date_naissance_ou_age)}`;
    document.getElementById('print-animal-living').textContent = `Lieu de vie : ${animal.stable_name || animal.lieu_de_vie || '-'}`;
  }

  document.getElementById('print-session-objective').textContent = session.motif;
  document.getElementById('print-session-resume-content').innerHTML = interpretMarkdownToHtml(session.resume_client_genere || 'Aucun résumé rédigé.');
  document.getElementById('print-generation-date').textContent = new Date().toLocaleDateString('fr-FR');

  // Précisions générales de la séance (si renseignées)
  const precisionsSection = document.getElementById('print-section-precisions');
  const precisionsContent = document.getElementById('print-session-precisions-content');
  if (precisionsContent) {
    if (session.precisions) {
      precisionsContent.textContent = session.precisions;
      if (precisionsSection) precisionsSection.style.display = 'block';
    } else {
      if (precisionsSection) precisionsSection.style.display = 'none';
    }
  }

  // Canvas d'annotation image
  const imgSection = document.getElementById('print-section-canvas');
  const imgElement = document.getElementById('print-session-canvas-img');
  if (session.canvas_annotation_image_blob) {
    imgElement.src = session.canvas_annotation_image_blob;
    imgSection.style.display = 'block';
  } else {
    imgSection.style.display = 'none';
  }

  // --- RENDU DE L'HISTORIQUE DE L'ANIMAL ---
  const fromAnimal = previousRoute && previousRoute.startsWith('animals/');
  const historySection = document.getElementById('print-section-history');
  if (historySection) {
    historySection.style.display = fromAnimal ? 'none' : 'block';
  }

  const animalSessions = await getByIndex('sessions', 'animal_id', session.animal_id);
  animalSessions.sort((a, b) => new Date(b.date_seance) - new Date(a.date_seance));
  
  let historyHtml = '<table class="print-history-table" style="width:100%; border-collapse:collapse; margin-top:10px;"><thead><tr style="border-bottom:1px solid #cbd5e1; text-align:left; font-size:0.85rem;"><th style="padding:6px 0;">Date</th><th style="padding:6px 0;">Motif</th><th style="padding:6px 0;">Résumé</th></tr></thead><tbody>';
  animalSessions.forEach(s => {
    const resumePreview = s.resume_client_genere 
      ? (s.resume_client_genere.length > 80 ? s.resume_client_genere.substring(0, 80) + '...' : s.resume_client_genere) 
      : 'Aucun résumé';
    const isCurrent = s.id === session.id;
    historyHtml += `<tr style="border-bottom:1px solid #e2e8f0; font-size:0.8rem; ${isCurrent ? 'font-weight:bold; background-color:rgba(255,255,255,0.05);' : ''}">
      <td style="padding:6px 0;">${formatDate(s.date_seance)} ${isCurrent ? '(Séance actuelle)' : ''}</td>
      <td style="padding:6px 0;">${s.motif}</td>
      <td style="padding:6px 0; color:var(--text-sub);">${resumePreview}</td>
    </tr>`;
  });
  historyHtml += '</tbody></table>';
  document.getElementById('print-session-history-list').innerHTML = historyHtml;

  // --- BOUTONS PRATICIEN ---
  // Toggling CR détaillé
  const toggleCrBtn = document.getElementById('btn-toggle-cr-detaille');
  const crDetailleContent = document.getElementById('practitioner-cr-detaille-content');
  if (toggleCrBtn && crDetailleContent) {
    // Show detailed CR by default
    crDetailleContent.innerHTML = renderDetailedCR(session);
    crDetailleContent.style.display = 'block';
    toggleCrBtn.textContent = 'Masquer le CR métier (détaillé)';
    
    toggleCrBtn.onclick = () => {
      if (crDetailleContent.style.display === 'none') {
        crDetailleContent.innerHTML = renderDetailedCR(session);
        crDetailleContent.style.display = 'block';
        toggleCrBtn.textContent = 'Masquer le CR métier (détaillé)';
      } else {
        crDetailleContent.style.display = 'none';
        toggleCrBtn.textContent = 'Afficher le CR métier (détaillé)';
      }
    };
  }

  // Completing follow-up Q
  const completeFollowupBtn = document.getElementById('btn-complete-followup-q');
  if (completeFollowupBtn) {
    completeFollowupBtn.onclick = () => {
      openFollowupQDialog(session);
    };
  }

  // Redirection back button
  document.getElementById('btn-back-to-animal-from-session').onclick = () => {
    window.location.hash = `animals/${session.animal_id}`;
  };

  const backToSessionsListBtn = document.getElementById('btn-back-to-sessions-list');
  if (backToSessionsListBtn) {
    backToSessionsListBtn.onclick = () => {
      window.location.hash = 'sessions';
    };
  }

  // Modifier la séance
  document.getElementById('btn-edit-session-detail').onclick = () => {
    window.location.hash = `session-editor/${session.id}`;
  };

  // Voir le PDF via la modale A4 officielle
  document.getElementById('btn-print-session').onclick = () => {
    openPortalSessionModal(session, animal);
  };
}

// --- QUESTIONNAIRE GENERATOR HELPER ---
function buildQuestionnaireInputs(containerId, data = null, compareData = null) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const isFollowup = containerId === 'q-3-semaines-container' || containerId === 'q-followup-dialog-container';

  QUESTIONNAIRE_CRITERES.forEach((critere, idx) => {
    const safeId = critere.replace(/[^a-zA-Z0-9]/g, '_');
    
    // Valeur par défaut
    let currentNote = 10;
    let currentPrecisions = '';
    
    if (data && data[critere]) {
      currentNote = data[critere].note !== undefined ? data[critere].note : 10;
      currentPrecisions = data[critere].precisions || '';
    }

    const card = document.createElement('div');
    card.className = 'question-card';
    if (critere === 'Autre') {
      card.classList.add('full-width');
    }
    
    // Rendu comparatif initial
    let comparativeHtml = '';
    if (isFollowup) {
      let initNote = 10;
      let initPrec = '';
      
      // Essayer d'abord de lire depuis le compareData (chargement depuis la base)
      if (compareData && compareData[critere]) {
        initNote = compareData[critere].note !== undefined ? compareData[critere].note : 10;
        initPrec = compareData[critere].precisions || '';
      } else {
        // Sinon, essayer de lire en direct du DOM du formulaire d'avant séance
        const avantSlider = document.getElementById(`slide-q-avant-seance-container-${safeId}`);
        const avantPrec = document.getElementById(`prec-q-avant-seance-container-${safeId}`);
        if (avantSlider) initNote = parseInt(avantSlider.value);
        if (avantPrec) initPrec = avantPrec.value.trim();
      }
      
      comparativeHtml = `
        <div class="comparative-score-display" id="comp-${containerId}-${safeId}" style="color: #a78bfa; font-size: 0.85rem; margin-top: 5px; font-weight: 600; font-style: italic;">
          ⏮️ Score initial : <strong id="comp-note-${containerId}-${safeId}">${initNote}/10</strong>${initPrec ? ' - <span id="comp-prec-' + containerId + '-' + safeId + '">' + initPrec + '</span>' : ''}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="question-header">
        <span class="question-title">${critere}</span>
        <span class="question-value-display" id="disp-${containerId}-${safeId}">${currentNote}</span>
      </div>
      <div class="question-slider-container">
        <span style="font-size:0.75rem; color:var(--text-muted);">1</span>
        <input type="range" class="question-slider" id="slide-${containerId}-${safeId}" min="1" max="10" value="${currentNote}">
        <span style="font-size:0.75rem; color:var(--text-muted);">10</span>
      </div>
      <div class="question-precisions-container" id="prec-container-${containerId}-${safeId}">
        <textarea id="prec-${containerId}-${safeId}" rows="2" placeholder="Précisez pourquoi la note est basse...">${currentPrecisions}</textarea>
      </div>
      ${comparativeHtml}
    `;

    const slider = card.querySelector('.question-slider');
    const display = card.querySelector('.question-value-display');
    const precContainer = card.querySelector('.question-precisions-container');

    // Déterminer la visibilité initiale du champ précisions
    const isAutre = critere === 'Autre';
    if (isAutre || currentNote < 7) {
      precContainer.style.display = 'block';
    } else {
      precContainer.style.display = 'none';
    }

    // Gérer les changements de valeur
    slider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      display.textContent = val;
      if (isAutre || val < 7) {
        precContainer.style.display = 'block';
      } else {
        precContainer.style.display = 'none';
      }
      
      // Mettre à jour l'affichage comparatif en temps réel dans le questionnaire de suivi si on modifie le questionnaire d'avant séance
      if (containerId === 'q-avant-seance-container') {
        const targetIds = ['q-3-semaines-container', 'q-followup-dialog-container'];
        targetIds.forEach(targetId => {
          const compNote = document.getElementById(`comp-note-${targetId}-${safeId}`);
          if (compNote) compNote.textContent = `${val}/10`;
        });
      }
    });

    // Mettre à jour la précision comparée en temps réel
    if (containerId === 'q-avant-seance-container') {
      const textarea = card.querySelector('textarea');
      textarea.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        const targetIds = ['q-3-semaines-container', 'q-followup-dialog-container'];
        targetIds.forEach(targetId => {
          const compPrec = document.getElementById(`comp-prec-${targetId}-${safeId}`);
          if (compPrec) {
            compPrec.textContent = val;
          } else {
            // Reconstruire l'affichage si vide précédemment
            const compDiv = document.getElementById(`comp-${targetId}-${safeId}`);
            if (compDiv) {
              const compNoteEl = document.getElementById(`comp-note-${targetId}-${safeId}`);
              const noteText = compNoteEl ? compNoteEl.textContent : '10/10';
              compDiv.innerHTML = `⏮️ Score initial : <strong id="comp-note-${targetId}-${safeId}">${noteText}</strong>${val ? ' - <span id="comp-prec-' + targetId + '-' + safeId + '">' + val + '</span>' : ''}`;
            }
          }
        });
      });
    }

    container.appendChild(card);
  });
}

// Extraire les données saisies d'un questionnaire dans le DOM
function collectQuestionnaireData(containerId) {
  const result = {};
  QUESTIONNAIRE_CRITERES.forEach(critere => {
    const safeId = critere.replace(/[^a-zA-Z0-9]/g, '_');
    const slider = document.getElementById(`slide-${containerId}-${safeId}`);
    const precArea = document.getElementById(`prec-${containerId}-${safeId}`);
    
    if (slider) {
      result[critere] = {
        note: parseInt(slider.value),
        precisions: precArea ? precArea.value : ''
      };
    }
  });
  return result;
}

let reminderItemIndex = 0;
function addReminderRow(data = null) {
  const container = document.getElementById('reminders-dynamic-list');
  if (!container) return;
  
  const idx = reminderItemIndex++;
  const row = document.createElement('div');
  row.className = 'reminder-row-item glass-card';
  row.style.padding = '15px';
  row.style.position = 'relative';
  row.style.marginBottom = '10px';
  row.style.background = 'rgba(255, 255, 255, 0.02)';
  row.style.border = '1px solid var(--glass-border)';
  row.style.borderRadius = 'var(--border-radius-md)';
  row.setAttribute('data-index', idx);
  
  // Pre-fill values
  const dateVal = data ? data.date_prevue : '';
  const delayVal = data ? (data.delay || '2m') : '2m';
  const typeVal = data ? data.type_rappel : 'prendre_des_nouvelles';
  const notesVal = data ? data.notes : '';
  
  row.innerHTML = `
    <button type="button" class="btn-remove-reminder-row" style="position: absolute; top: 10px; right: 10px; background: transparent; border: none; color: var(--color-danger); cursor: pointer;" title="Supprimer ce rappel">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    
    <div class="form-grid-3" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px;">
      <div class="form-group" style="margin-bottom: 0;">
        <label style="font-size:0.85rem; font-weight:500;">Délai pré-programmé</label>
        <select class="reminder-item-delay" data-index="${idx}" style="padding: 8px; font-size:0.85rem; width:100%;">
          <option value="2w" ${delayVal === '2w' ? 'selected' : ''}>Dans 2 semaines</option>
          <option value="3w" ${delayVal === '3w' ? 'selected' : ''}>Dans 3 semaines</option>
          <option value="1m" ${delayVal === '1m' ? 'selected' : ''}>Dans 1 mois</option>
          <option value="2m" ${delayVal === '2m' ? 'selected' : ''}>Dans 2 mois</option>
          <option value="3m" ${delayVal === '3m' ? 'selected' : ''}>Dans 3 mois</option>
          <option value="custom" ${delayVal === 'custom' ? 'selected' : ''}>Date personnalisée</option>
        </select>
      </div>
      
      <div class="form-group custom-date-field" style="margin-bottom: 0; display: ${delayVal === 'custom' ? 'block' : 'none'};">
        <label style="font-size:0.85rem; font-weight:500;">Date prévue <span style="color:var(--color-danger)">*</span></label>
        <input type="date" class="reminder-item-date" data-index="${idx}" value="${dateVal}" style="padding: 8px; font-size:0.85rem; width:100%;">
      </div>
      
      <div class="form-group" style="margin-bottom: 0;">
        <label style="font-size:0.85rem; font-weight:500;">Type de rappel</label>
        <select class="reminder-item-type" data-index="${idx}" style="padding: 8px; font-size:0.85rem; width:100%;">
          <option value="prendre_des_nouvelles" ${typeVal === 'prendre_des_nouvelles' ? 'selected' : ''}>Prendre des nouvelles</option>
          <option value="prendre_rdv" ${typeVal === 'prendre_rdv' ? 'selected' : ''}>Proposer de planifier un RDV</option>
        </select>
      </div>
    </div>
    
    <div class="form-group" style="margin-top: 15px; margin-bottom: 0;">
      <label style="font-size:0.85rem; font-weight:500;">Note de rappel</label>
      <input type="text" class="reminder-item-notes" data-index="${idx}" value="${notesVal}" placeholder="Ex: Prendre des nouvelles du postérieur droit..." style="padding: 8px; font-size:0.85rem; width:100%;">
    </div>
  `;
  
  // Handle delay change
  const delaySelect = row.querySelector('.reminder-item-delay');
  const dateInput = row.querySelector('.reminder-item-date');
  const customField = row.querySelector('.custom-date-field');
  
  const updateDateFromDelay = () => {
    const delay = delaySelect.value;
    const isCustom = delay === 'custom';
    customField.style.display = isCustom ? 'block' : 'none';
    
    if (!isCustom) {
      const sessionDate = document.getElementById('session-form-date').value || new Date().toISOString().split('T')[0];
      const targetDate = calculateFutureDate(sessionDate, delay);
      dateInput.value = targetDate;
    }
  };
  
  delaySelect.addEventListener('change', updateDateFromDelay);
  
  // Set initial date if not custom and empty
  if (!dateVal && delayVal !== 'custom') {
    updateDateFromDelay();
  }
  
  // Delete row listener
  row.querySelector('.btn-remove-reminder-row').addEventListener('click', () => {
    row.remove();
  });
  
  container.appendChild(row);
}

// --- RENDU : EDITEUR DE SEANCE (CRÉER / ÉDITER) ---
async function prepareSessionEditor(param) {
  const form = document.getElementById('session-form');
  form.reset();
  syncCranioParentCheckboxes();

  const animalSelect = document.getElementById('session-form-animal');
  animalSelect.innerHTML = '<option value="">-- Choisir un animal... --</option>';

  const animals = await getAll('animals');
  const clients = await getAll('clients');

  for (const an of animals) {
    const client = clients.find(c => c.id === an.client_id);
    const ownerName = client ? `${client.prenom} ${client.nom}` : 'Propriétaire inconnu';
    const opt = document.createElement('option');
    opt.value = an.id;
    opt.textContent = `${an.nom} (${an.espece} - Propriétaire : ${ownerName})`;
    animalSelect.appendChild(opt);
  }

  // Charger les rappels multiples
  const remindersContainer = document.getElementById('reminders-dynamic-list');
  if (remindersContainer) {
    remindersContainer.innerHTML = '';
  }
  
  // Date par défaut aujourd'hui
  document.getElementById('session-form-date').value = new Date().toISOString().split('T')[0];

  // Réinitialiser les accordions de protocoles
  document.querySelectorAll('.protocol-checkbox').forEach(cb => {
    cb.checked = false;
    const body = cb.closest('.protocol-accordion').querySelector('.protocol-body');
    body.style.display = 'none';
  });

  // Réinitialiser le calque transparent du Canvas
  clearTransparentCanvas();
  canvasUndoHistory = [];

  currentSessionId = null;

  // Déterminer s'il s'agit d'une édition de séance ou d'une nouvelle séance
  let isEditing = false;
  let targetSession = null;
  let targetAnimalId = null;

  if (param) {
    if (typeof param === 'string' && param.startsWith('animal-')) {
      targetAnimalId = Number(param.replace('animal-', ''));
    } else {
      const ses = await getById('sessions', Number(param));
      if (ses) {
        isEditing = true;
        targetSession = ses;
        targetAnimalId = ses.animal_id;
        currentSessionId = ses.id;
      } else {
        targetAnimalId = Number(param);
      }
    }
  }

  // Configurer le sélecteur d'animal
  if (targetAnimalId) {
    animalSelect.value = targetAnimalId;
  }

  // --- LOGIQUE DE PRÉ-REMPLISSAGE INTELLIGENT < 2 MOIS ---
  const prefillContainer = document.getElementById('session-prefill-banner-container');
  prefillContainer.innerHTML = '';

  if (!isEditing && targetAnimalId) {
    const allSessions = await getAll('sessions');
    const animalSessions = allSessions.filter(s => s.animal_id === targetAnimalId);
    
    if (animalSessions.length > 0) {
      // Récupérer la dernière séance
      animalSessions.sort((a,b) => new Date(b.date_seance) - new Date(a.date_seance));
      const lastSession = animalSessions[0];

      // Vérifier le délai de moins de 2 mois (60 jours)
      const diffTime = new Date() - new Date(lastSession.date_seance);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 60) {
        const banner = document.createElement('div');
        banner.className = 'prefill-banner';
        banner.innerHTML = `
          <span class="prefill-text">
            💡 <strong>Séance récente détectée</strong> : Une séance a été réalisée il y a ${diffDays} jours (${formatDate(lastSession.date_seance)}).
          </span>
          <button type="button" class="btn btn-secondary btn-small" id="btn-trigger-prefill">Pré-remplir avec le suivi à 3 semaines</button>
        `;

        banner.querySelector('#btn-trigger-prefill').addEventListener('click', () => {
          if (lastSession.q_3_semaines) {
            buildQuestionnaireInputs('q-avant-seance-container', lastSession.q_3_semaines);
            showToast('Questionnaire avant séance pré-rempli avec les scores à 3 semaines.');
            banner.remove();
          } else {
            showToast('Le questionnaire à 3 semaines de la séance précédente est vide.', 'warning');
          }
        });

        prefillContainer.appendChild(banner);
      }
    }
  }

  // Charger les structures des Questionnaires
  if (isEditing) {
    document.getElementById('session-editor-title').textContent = `Modifier la Séance`;
    document.getElementById('session-form-id').value = targetSession.id;
    document.getElementById('session-form-date').value = targetSession.date_seance;
    document.getElementById('session-form-number').value = targetSession.n_seance_annee || 1;
    document.getElementById('session-form-objective').value = targetSession.motif;
    document.getElementById('session-form-notes-obs').value = targetSession.notes_observations || '';
    document.getElementById('session-form-cr-practicienne').value = targetSession.cr_personnel || '';
    document.getElementById('session-form-resume').value = targetSession.resume_client_genere || '';
    document.getElementById('session-form-precisions').value = targetSession.precisions || '';

    // Charger les Questionnaires
    buildQuestionnaireInputs('q-avant-seance-container', targetSession.q_avant_seance);
    
    // Déterminer s'il faut afficher le questionnaire de suivi
    const hasQ3 = targetSession.q_3_semaines && Object.values(targetSession.q_3_semaines).some(c => (c.note !== undefined && c.note < 10) || c.precisions);
    if (hasQ3) {
      document.getElementById('q-suivi-wrapper').style.display = 'block';
      document.getElementById('container-add-followup-q').style.display = 'none';
      buildQuestionnaireInputs('q-3-semaines-container', targetSession.q_3_semaines, targetSession.q_avant_seance);
    } else {
      document.getElementById('q-suivi-wrapper').style.display = 'none';
      document.getElementById('container-add-followup-q').style.display = 'block';
      buildQuestionnaireInputs('q-3-semaines-container', null, targetSession.q_avant_seance);
    }

    // Charger les protocoles
    const protos = targetSession.protocoles_realises || {};

    // 1. Shiatsu
    if (protos.shiatsu && protos.shiatsu.checked) {
      document.getElementById('proto-shiatsu-enable').checked = true;
      document.getElementById('protocol-shiatsu-acc').querySelector('.protocol-body').style.display = 'block';
      
      const ys = protos.shiatsu.yin || {};
      const ygs = protos.shiatsu.yang || {};
      
      document.getElementById('meridian-reins').checked = !!ys.reins;
      document.getElementById('meridian-foie').checked = !!ys.foie;
      document.getElementById('meridian-coeur').checked = !!ys.coeur;
      document.getElementById('meridian-maitre-coeur').checked = !!ys.maitre_coeur;
      document.getElementById('meridian-rate').checked = !!ys.rate;
      document.getElementById('meridian-poumon').checked = !!ys.poumon;

      document.getElementById('meridian-vessie').checked = !!ygs.vessie;
      document.getElementById('meridian-vesicule').checked = !!ygs.vesicule;
      document.getElementById('meridian-grele').checked = !!ygs.grele;
      document.getElementById('meridian-triple-rechauffeur').checked = !!ygs.triple;
      document.getElementById('meridian-estomac').checked = !!ygs.estomac;
      document.getElementById('meridian-gros-intestin').checked = !!ygs.gros_intestin;

      const v = protos.shiatsu.vaisseaux || {};
      document.getElementById('mv-gouverneur').checked = !!v.gouverneur;
      document.getElementById('mv-conception').checked = !!v.conception;

    }

    // 2. Techniques Manuelles
    if (protos.manuelles && protos.manuelles.checked) {
      document.getElementById('proto-manuelles-enable').checked = true;
      document.getElementById('protocol-manuelles-acc').querySelector('.protocol-body').style.display = 'block';
      document.getElementById('proto-manuelles-texte').value = protos.manuelles.texte || '';
    }

    // 3. Tenségrité
    if (protos.tensegrite && protos.tensegrite.checked) {
      document.getElementById('proto-tensegrite-enable').checked = true;
      document.getElementById('protocol-tensegrite-acc').querySelector('.protocol-body').style.display = 'block';
      
      // Charger les intensités
      const ftm = protos.tensegrite.ftm || {};
      const torsion = protos.tensegrite.torsion || {};
      const diaphragme = protos.tensegrite.diaphragme || {};
      const loge = protos.tensegrite.loge || {};

      // FTM
      setSelectedValue('override-ftm', ftm.override);
      setSelectedValue('select[data-sub="queue"]', ftm.queue);
      setSelectedValue('select[data-sub="oeil_droit"]', ftm.oeil_droit);
      setSelectedValue('select[data-sub="oeil_gauche"]', ftm.oeil_gauche);
      setSelectedValue('select[data-sub="energetique"]', ftm.energetique);

      // Torsion
      setSelectedValue('override-torsion', torsion.override);
      setSelectedValue('select[data-sub="hanche_droite"]', torsion.hanche_droite);
      setSelectedValue('select[data-sub="hanche_gauche"]', torsion.hanche_gauche);
      setSelectedValue('select[data-sub="occiput"]', torsion.occiput);

      // Diaphragme
      setSelectedValue('override-diaphragme', diaphragme.override);
      setSelectedValue('select[data-sub="pelvien"]', diaphragme.pelvien);
      setSelectedValue('select[data-sub="thoraco_lombaire"]', diaphragme.thoraco_lombaire);
      setSelectedValue('select[data-sub="cervico_thoracique"]', diaphragme.cervico_thoracique);
      setSelectedValue('select[data-sub="c0_c1"]', diaphragme.c0_c1);

      // Loge
      setSelectedValue('override-loge', loge.override);
      setSelectedValue('select[data-sub="digestive"]', loge.digestive);
      setSelectedValue('select[data-sub="thoracique"]', loge.thoracique);
      setSelectedValue('select[data-sub="gorge"]', loge.gorge);
      setSelectedValue('select[data-sub="cervelet"]', loge.cervelet);

      document.getElementById('proto-tensegrite-helices').value = protos.tensegrite.helices || '';

      updateTensegriteTitles(); // recalcule la moyenne calculée à côté
    }

    // 4. Cranio-Sacrée
    if (protos.cranio && protos.cranio.checked) {
      document.getElementById('proto-cranio-enable').checked = true;
      document.getElementById('protocol-cranio-acc').querySelector('.protocol-body').style.display = 'block';
      
      document.getElementById('proto-cranio-ambiance').value = protos.cranio.ambiance || '';

      const adapt = protos.cranio.adaptatif || {};
      document.getElementById('cranio-sacro').checked = !!adapt.sacro;
      document.getElementById('cranio-rre').checked = !!adapt.rre;
      document.getElementById('cranio-occiput').checked = !!adapt.occiput;
      document.getElementById('cranio-couple').checked = !!adapt.couple;
      document.getElementById('cranio-strains').checked = !!adapt.strains;
      document.getElementById('cranio-grosse-art').checked = !!adapt.grosse_art;

      const som = protos.cranio.somatique || {};
      document.getElementById('cranio-iliaque-ensemble').checked = !!som.iliaque_ensemble;
      document.getElementById('cranio-coccygienne').checked = !!som.coccygienne;
      document.getElementById('cranio-ixions').checked = !!som.ixions;
      document.getElementById('cranio-pubis').checked = !!som.pubis;
      document.getElementById('cranio-iliaque-indep').checked = !!som.iliaque_indep;
      document.getElementById('cranio-sacrum-liaison').checked = !!som.sacrum_liaison;

      document.getElementById('cranio-vertebres').checked = !!som.vertebres;
      document.getElementById('cranio-scapulaire').checked = !!som.scapulaire;
      document.getElementById('cranio-ant-complet').checked = !!som.ant_complet;
      document.getElementById('cranio-post-complet').checked = !!som.post_complet;
      document.getElementById('cranio-genoux').checked = !!som.genoux;
      document.getElementById('cranio-jarrets').checked = !!som.jarrets;

      document.getElementById('cranio-visceres').checked = !!som.visceres;
      document.getElementById('cranio-visceres-text').value = som.visceres_text || '';

      syncCranioParentCheckboxes();
    }

    // 5. Kinésiologie
    if (protos.kinesiologie && protos.kinesiologie.checked) {
      document.getElementById('proto-kinesiologie-enable').checked = true;
      document.getElementById('protocol-kinesiologie-acc').querySelector('.protocol-body').style.display = 'block';
      
      const type = protos.kinesiologie.type || 'Classique';
      document.getElementById('proto-kinesiologie-type').value = type;
      handleKinesioTypeChange(type);

      document.getElementById('kinesio-reactives').value = protos.kinesiologie.emot_reactives || '';

      document.getElementById('kinesio-problematique').value = protos.kinesiologie.problematique || '';
      document.getElementById('kinesio-syntho').value = protos.kinesiologie.syntho || '';
      document.getElementById('kinesio-objectif').value = protos.kinesiologie.objectif || '';
      document.getElementById('kinesio-cen-debut').value = protos.kinesiologie.cen_debut !== undefined ? protos.kinesiologie.cen_debut : 100;
      document.getElementById('kinesio-cen-fin').value = protos.kinesiologie.cen_fin !== undefined ? protos.kinesiologie.cen_fin : 0;
      document.getElementById('kinesio-ldt').value = protos.kinesiologie.ldt || '';
    }

    // 6. Aura
    if (protos.aura && protos.aura.checked) {
      document.getElementById('proto-aura-enable').checked = true;
      document.getElementById('protocol-aura-acc').querySelector('.protocol-body').style.display = 'block';
      
      document.getElementById('aura-recentrage').checked = !!protos.aura.recentrage;
      document.getElementById('aura-liens').checked = !!protos.aura.liens;
      document.getElementById('aura-vidange').checked = !!protos.aura.vidange;
      document.getElementById('aura-fleches').checked = !!protos.aura.fleches;
      document.getElementById('aura-fleches-loc').value = protos.aura.fleches_loc || '';
      document.getElementById('panel-aura-fleches-loc').style.display = !!protos.aura.fleches ? 'block' : 'none';

      document.getElementById('aura-masses').checked = !!protos.aura.masses;
      document.getElementById('aura-masses-loc').value = protos.aura.masses_loc || '';
      document.getElementById('panel-aura-masses-loc').style.display = !!protos.aura.masses ? 'block' : 'none';
      document.getElementById('aura-recharge').checked = !!protos.aura.recharge;
      document.getElementById('aura-chakras').checked = !!protos.aura.chakras;
      document.getElementById('aura-circulation').checked = !!protos.aura.circulation;
      document.getElementById('aura-mouvement').checked = !!protos.aura.mouvement;
      document.getElementById('aura-repolarisation').checked = !!protos.aura.repolarisation;

      document.getElementById('aura-filet').checked = !!protos.aura.filet;
      document.getElementById('panel-filet-options').style.display = !!protos.aura.filet ? 'block' : 'none';
      const filetOpts = protos.aura.filet_options || {};
      document.getElementById('filet-energies').checked = !!filetOpts.energies;
      document.getElementById('filet-emotions').checked = !!filetOpts.emotions;
      document.getElementById('filet-parasites').checked = !!filetOpts.parasites;
      document.getElementById('filet-entites').checked = !!filetOpts.entites;
      document.getElementById('filet-sorts').checked = !!filetOpts.sorts;
      document.getElementById('filet-incorporations').checked = !!filetOpts.incorporations;

      document.getElementById('aura-local-filament').checked = !!protos.aura.local_filament;
      document.getElementById('aura-local-polarites').checked = !!protos.aura.local_polarites;
      document.getElementById('aura-local-recharge').checked = !!protos.aura.local_recharge;
      document.getElementById('aura-local-complement').checked = !!protos.aura.local_complement;
      document.getElementById('aura-local-complement-text').value = protos.aura.local_complement_text || '';

    }

    // Charger les rappels associés à cette séance
    const sessionReminders = await getByIndex('reminders', 'session_id', targetSession.id);
    if (sessionReminders && sessionReminders.length > 0) {
      sessionReminders.forEach(r => addReminderRow(r));
    }

    // Charger le dessin du Canvas
    if (targetSession.canvas_drawing_data_url) {
      const img = new Image();
      img.onload = () => {
        canvasCtx.drawImage(img, 0, 0);
        saveCanvasState(); // init undo state
      };
      img.src = targetSession.canvas_drawing_data_url;
    }
  } else {
    document.getElementById('session-editor-title').textContent = `Nouvelle Séance`;
    document.getElementById('session-form-id').value = '';
    document.getElementById('session-form-notes-obs').value = '';
    document.getElementById('session-form-precisions').value = '';
    
    // Créer des questionnaires vides
    buildQuestionnaireInputs('q-avant-seance-container');
    document.getElementById('q-suivi-wrapper').style.display = 'none';
    document.getElementById('container-add-followup-q').style.display = 'block';
    buildQuestionnaireInputs('q-3-semaines-container');
    document.getElementById('panel-filet-options').style.display = 'none';
    document.getElementById('panel-aura-fleches-loc').style.display = 'none';
    document.getElementById('panel-aura-masses-loc').style.display = 'none';
    
    // Kinésio commun et type par défaut
    document.getElementById('proto-kinesiologie-type').value = 'Classique';
    handleKinesioTypeChange('Classique');

    // Recalculer les titres de Tenségrité pour afficher [Moyen] par défaut
    updateTensegriteTitles();
  }
}

function setSelectedValue(selector, value) {
  const el = document.querySelector(selector);
  if (el && value) el.value = value;
}

// --- LOGIQUE ACCORDIONS PROTOCOLES ---
function setupProtocolAccordionListeners() {
  document.querySelectorAll('.protocol-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const parent = cb.closest('.protocol-accordion');
      const body = parent.querySelector('.protocol-body');
      
      if (cb.checked) {
        body.style.display = 'block';
      } else {
        body.style.display = 'none';
      }
    });
  });
}

// --- SYNCHRONISATION PARENT/ENFANTS CRANIO-SACRÉE ---
function syncCranioParentCheckboxes() {
  const adaptatifSubIds = ['cranio-sacro', 'cranio-rre', 'cranio-occiput', 'cranio-couple', 'cranio-strains', 'cranio-grosse-art'];
  const pelvienneSubIds = ['cranio-iliaque-ensemble', 'cranio-coccygienne', 'cranio-ixions', 'cranio-pubis', 'cranio-iliaque-indep', 'cranio-sacrum-liaison'];

  const parentAdaptatif = document.getElementById('cranio-parent-adaptatif');
  const parentPelvienne = document.getElementById('cranio-parent-pelvienne');

  if (parentAdaptatif) {
    const checkedCount = adaptatifSubIds.filter(id => {
      const el = document.getElementById(id);
      return el && el.checked;
    }).length;
    parentAdaptatif.checked = checkedCount > 0;
  }

  if (parentPelvienne) {
    const checkedCount = pelvienneSubIds.filter(id => {
      const el = document.getElementById(id);
      return el && el.checked;
    }).length;
    parentPelvienne.checked = checkedCount > 0;
  }
}

function setupCranioCheckboxListeners() {
  const parentAdaptatif = document.getElementById('cranio-parent-adaptatif');
  const parentPelvienne = document.getElementById('cranio-parent-pelvienne');

  const adaptatifSubIds = ['cranio-sacro', 'cranio-rre', 'cranio-occiput', 'cranio-couple', 'cranio-strains', 'cranio-grosse-art'];
  const pelvienneSubIds = ['cranio-iliaque-ensemble', 'cranio-coccygienne', 'cranio-ixions', 'cranio-pubis', 'cranio-iliaque-indep', 'cranio-sacrum-liaison'];

  if (parentAdaptatif) {
    parentAdaptatif.addEventListener('change', () => {
      const isChecked = parentAdaptatif.checked;
      adaptatifSubIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = isChecked;
      });
    });
  }

  if (parentPelvienne) {
    parentPelvienne.addEventListener('change', () => {
      const isChecked = parentPelvienne.checked;
      pelvienneSubIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = isChecked;
      });
    });
  }

  [...adaptatifSubIds, ...pelvienneSubIds].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        syncCranioParentCheckboxes();
      });
    }
  });
}

// --- LOGIQUE DU CANVAS D'ANNOTATION (DESSIN/GOMME) ---
function setupCanvasListeners() {
  canvasElement = document.getElementById('annotation-canvas');
  if (!canvasElement) return;
  
  canvasCtx = canvasElement.getContext('2d');
  
  // Activer les événements tactiles et souris
  canvasElement.addEventListener('mousedown', startDrawingEvent);
  canvasElement.addEventListener('mousemove', drawEvent);
  canvasElement.addEventListener('mouseup', stopDrawingEvent);
  canvasElement.addEventListener('mouseleave', stopDrawingEvent);
  
  canvasElement.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    canvasElement.dispatchEvent(mouseEvent);
  }, { passive: false });
  
  canvasElement.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    canvasElement.dispatchEvent(mouseEvent);
  }, { passive: false });

  canvasElement.addEventListener('touchend', (e) => {
    const mouseEvent = new MouseEvent('mouseup', {});
    canvasElement.dispatchEvent(mouseEvent);
  });

  // Palette de couleur
  const colorBtns = document.querySelectorAll('.color-btn');
  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      colorBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentDrawingColor = btn.getAttribute('data-color');
      
      // Désactiver le mode Gomme
      const eraserBtn = document.getElementById('btn-canvas-eraser');
      if (eraserBtn) eraserBtn.classList.remove('active');
      canvasCtx.globalCompositeOperation = 'source-over';
      
      // Restaurer la taille du pinceau depuis le slider
      const bSlider = document.getElementById('canvas-brush-size');
      const bDisplay = document.getElementById('brush-size-display');
      if (bSlider && bDisplay) {
        currentBrushSize = parseInt(bSlider.value);
        bDisplay.textContent = `${currentBrushSize}px`;
      }
    });
  });

  // Taille du pinceau
  const brushSlider = document.getElementById('canvas-brush-size');
  const brushSizeDisplay = document.getElementById('brush-size-display');
  if (brushSlider && brushSizeDisplay) {
    brushSlider.addEventListener('input', (e) => {
      currentBrushSize = parseInt(e.target.value);
      brushSizeDisplay.textContent = `${currentBrushSize}px`;
    });
  }

  // Mode Gomme (Transparent)
  const eraserBtn = document.getElementById('btn-canvas-eraser');
  if (eraserBtn) {
    eraserBtn.addEventListener('click', () => {
      eraserBtn.classList.toggle('active');
      const bSlider = document.getElementById('canvas-brush-size');
      const bDisplay = document.getElementById('brush-size-display');
      
      if (eraserBtn.classList.contains('active')) {
        canvasCtx.globalCompositeOperation = 'destination-out'; // efface le calque de dessin
        // Set automatically to max brush size (20px)
        if (bSlider && bDisplay) {
          bSlider.value = 20;
          currentBrushSize = 20;
          bDisplay.textContent = '20px';
        }
      } else {
        canvasCtx.globalCompositeOperation = 'source-over';
        // Revert to 2px brush size
        if (bSlider && bDisplay) {
          bSlider.value = 2;
          currentBrushSize = 2;
          bDisplay.textContent = '2px';
        }
      }
    });
  }

  // Clear Canvas
  const clearBtn = document.getElementById('btn-canvas-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('Voulez-vous effacer toutes les annotations ?')) {
        clearTransparentCanvas();
        canvasUndoHistory = []; // Reset history
        saveCanvasState(); // Save first blank state
      }
    });
  }

  // Undo Canvas
  const undoBtn = document.getElementById('btn-canvas-undo');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      restoreCanvasState();
    });
  }
}

function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function startDrawingEvent(e) {
  isDrawing = true;
  const rect = canvasElement.getBoundingClientRect();
  lastX = e.clientX - rect.left;
  lastY = e.clientY - rect.top;
}

function drawEvent(e) {
  if (!isDrawing) return;
  const rect = canvasElement.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  canvasCtx.beginPath();
  canvasCtx.moveTo(lastX, lastY);
  canvasCtx.lineTo(x, y);
  
  canvasCtx.lineWidth = currentBrushSize;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';
  
  if (canvasCtx.globalCompositeOperation === 'destination-out') {
    canvasCtx.strokeStyle = currentDrawingColor;
    canvasCtx.globalAlpha = 1.0;
  } else {
    canvasCtx.strokeStyle = currentDrawingColor.startsWith('#') ? hexToRgba(currentDrawingColor, 0.5) : currentDrawingColor;
    canvasCtx.globalAlpha = 0.5;
  }
  
  canvasCtx.stroke();
  
  lastX = x;
  lastY = y;
}

function stopDrawingEvent() {
  if (isDrawing) {
    isDrawing = false;
    saveCanvasState();
  }
}

function clearTransparentCanvas() {
  if (canvasCtx && canvasElement) {
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  }
}

function saveCanvasState() {
  if (canvasUndoHistory.length >= MAX_UNDO_STATES) {
    canvasUndoHistory.shift();
  }
  canvasUndoHistory.push(canvasElement.toDataURL('image/png'));
}

function restoreCanvasState() {
  if (canvasUndoHistory.length > 1) {
    canvasUndoHistory.pop(); // supprimer l'état actuel
    const prevStateDataUrl = canvasUndoHistory[canvasUndoHistory.length - 1];
    
    const img = new Image();
    img.onload = () => {
      clearTransparentCanvas();
      canvasCtx.drawImage(img, 0, 0);
    };
    img.src = prevStateDataUrl;
  } else if (canvasUndoHistory.length === 1) {
    canvasUndoHistory.pop();
    clearTransparentCanvas();
  } else {
    showToast('Aucun tracé à annuler.', 'warning');
  }
}

// Génère la fusion Image squelette + Dessin transparent (en respectant "contain" pour éviter tout décalage)
function generateMergedCanvasDataUrl() {
  return new Promise((resolve) => {
    const bgImg = document.getElementById('canvas-skeleton-img');
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvasElement.width;
    tempCanvas.height = canvasElement.height;
    const tempCtx = tempCanvas.getContext('2d');

    // Remplir de blanc en fond pour l'impression propre
    tempCtx.fillStyle = '#ffffff';
    tempCtx.fillRect(0,0,tempCanvas.width,tempCanvas.height);

    // Fonction utilitaire pour dessiner l'image en respectant l'aspect ratio (contain)
    const drawImageContained = (ctx, img, targetW, targetH) => {
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const canvasRatio = targetW / targetH;
      let dWidth, dHeight, dX, dY;

      if (imgRatio > canvasRatio) {
        dWidth = targetW;
        dHeight = targetW / imgRatio;
        dX = 0;
        dY = (targetH - dHeight) / 2;
      } else {
        dWidth = targetH * imgRatio;
        dHeight = targetH;
        dX = (targetW - dWidth) / 2;
        dY = 0;
      }
      ctx.drawImage(img, dX, dY, dWidth, dHeight);
    };

    // Dessiner le squelette
    if (bgImg && bgImg.complete && bgImg.naturalWidth !== 0) {
      drawImageContained(tempCtx, bgImg, tempCanvas.width, tempCanvas.height);
      // Dessiner le tracé transparent par dessus
      tempCtx.drawImage(canvasElement, 0, 0);
      resolve(tempCanvas.toDataURL('image/png'));
    } else {
      // Si l'image n'est pas chargée, charger et dessiner l'image et l'annotation
      const newImg = new Image();
      newImg.onload = () => {
        drawImageContained(tempCtx, newImg, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(canvasElement, 0, 0);
        resolve(tempCanvas.toDataURL('image/png'));
      };
      newImg.onerror = () => {
        // En cas d'erreur de chargement image, renvoyer seulement le tracé
        tempCtx.drawImage(canvasElement, 0, 0);
        resolve(tempCanvas.toDataURL('image/png'));
      };
      newImg.src = bgImg ? bgImg.src : 'horse_skeleton.png';
    }
  });
}

// --- LOGIQUE CALCUL AUTOMATIQUE TENSÉGRITÉ ---
function setupTensegriteListeners() {
  // Ecouteurs sur les sous-intensités pour calculer la moyenne
  document.querySelectorAll('.sub-intensity').forEach(sel => {
    sel.addEventListener('change', () => {
      const parentBox = sel.closest('.tensegrite-category-box');
      const category = parentBox.getAttribute('data-category');
      
      // Calcul de la moyenne des sous-catégories
      const selects = parentBox.querySelectorAll('.sub-intensity');
      let sum = 0;
      let count = 0;
      
      selects.forEach(s => {
        const val = s.value;
        let num = 1; // Faible par defaut
        if (val === 'Moyen') num = 2;
        else if (val === 'Élevé') num = 3;
        
        sum += num;
        count++;
      });

      const avg = Math.round(sum / count);
      let textAvg = 'Faible';
      if (avg === 2) textAvg = 'Moyen';
      else if (avg === 3) textAvg = 'Élevé';

      // Assigner à la surcharge
      const overrideSelect = document.getElementById(`override-${category}`);
      if (overrideSelect) {
        overrideSelect.value = textAvg;
      }

      updateTensegriteTitles();
    });
  });

  // Ecouteurs de changement manuel (surcharge) pour mettre à jour le titre immédiatement
  ['ftm', 'torsion', 'diaphragme', 'loge'].forEach(cat => {
    const overrideSelect = document.getElementById(`override-${cat}`);
    if (overrideSelect) {
      overrideSelect.addEventListener('change', updateTensegriteTitles);
    }
  });
}

function updateTensegriteTitles() {
  // Met à jour l'affichage des titres de Tenségrité
  const categories = ['ftm', 'torsion', 'diaphragme', 'loge'];
  categories.forEach(cat => {
    const override = document.getElementById(`override-${cat}`).value;
    const parent = document.querySelector(`.tensegrite-category-box[data-category="${cat}"]`);
    const titleSpan = parent.querySelector('.tensegrite-category-title');
    
    // Enlever ancienne intensité
    let originalTitle = titleSpan.textContent.split(' - ')[0];
    titleSpan.textContent = `${originalTitle} - [${override}]`;
  });
}

// --- LOGIQUE KINÉSIOLOGIE DYNAMIQUE ---
function setupKinesioListeners() {
  const typeSelect = document.getElementById('proto-kinesiologie-type');
  if (typeSelect) {
    typeSelect.addEventListener('change', (e) => {
      handleKinesioTypeChange(e.target.value);
    });
  }
}

function handleKinesioTypeChange(type) {
  // Masquer tous les panels
  document.getElementById('panel-kinesio-emotions-reactives').style.display = 'none';
  document.getElementById('panel-kinesio-emotion-urgence').style.display = 'none';
  document.getElementById('panel-kinesio-autre').style.display = 'none';
  document.getElementById('panel-kinesio-commun').style.display = 'block'; // visible par defaut

  const probContainer = document.getElementById('container-kinesio-problematique');
  if (probContainer) probContainer.style.display = 'block';

  const synthoContainer = document.getElementById('container-kinesio-syntho');
  if (synthoContainer) synthoContainer.style.display = 'block';

  // Résilience sur l'apostrophe (normalise typographique ’ en droite ')
  const normType = type.replace(/’/g, "'");

  if (normType === 'Émotions réactives') {
    document.getElementById('panel-kinesio-emotions-reactives').style.display = 'block';
    if (synthoContainer) synthoContainer.style.display = 'none'; // Masquer Syntonisation pour émotions réactives
  } else if (normType === "Émotion d'urgence") {
    document.getElementById('panel-kinesio-emotion-urgence').style.display = 'block';
    document.getElementById('panel-kinesio-commun').style.display = 'none'; // Masquer commun pour urgence
    if (probContainer) probContainer.style.display = 'none';
  } else if (normType === 'Autre') {
    document.getElementById('panel-kinesio-autre').style.display = 'block';
  }
}

// --- GÉNÉRATEUR AUTOMATIQUE COMPTE-RENDU CLIENT FILTRÉ ---
function setupFormListeners() {
  const summaryBtn = document.getElementById('btn-generate-client-summary');
  if (summaryBtn) {
    summaryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      generateClientSummaryReport();
    });
  }

  // Soumission formulaire séance
  const sessionForm = document.getElementById('session-form');
  if (sessionForm) {
    sessionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveSessionForm();
    });
  }

  // Clic Annuler Séance en bas
  const btnCancelSessionForm = document.getElementById('btn-cancel-session-form');
  if (btnCancelSessionForm) {
    btnCancelSessionForm.onclick = (e) => {
      e.preventDefault();
      const animalSelect = document.getElementById('session-form-animal');
      if (animalSelect && animalSelect.value) {
        window.location.hash = `animals/${animalSelect.value}`;
      } else {
        window.location.hash = 'sessions';
      }
    };
  }

  // Clic Annuler en haut (btn-back-to-sessions)
  const btnBackToSessions = document.getElementById('btn-back-to-sessions');
  if (btnBackToSessions) {
    btnBackToSessions.onclick = (e) => {
      e.preventDefault();
      const animalSelect = document.getElementById('session-form-animal');
      if (animalSelect && animalSelect.value) {
        window.location.hash = `animals/${animalSelect.value}`;
      } else {
        window.location.hash = 'sessions';
      }
    };
  }

  // Dynamic reminders add button wiring
  const btnAddReminderItem = document.getElementById('btn-add-reminder-item');
  if (btnAddReminderItem) {
    btnAddReminderItem.onclick = (e) => {
      e.preventDefault();
      addReminderRow();
    };
  }

  // Cacher/Afficher champs délai rappel
  const reminderSelect = document.getElementById('session-reminder-enable');
  if (reminderSelect) {
    reminderSelect.addEventListener('change', (e) => {
      const show = e.target.value === 'yes';
      document.querySelectorAll('.schedule-field').forEach(el => {
        el.style.display = show ? 'block' : 'none';
      });
      // Déclencher le changement pour afficher la date custom
      const delaySelect = document.getElementById('session-reminder-delay');
      if (delaySelect) delaySelect.dispatchEvent(new Event('change'));
    });
  }

  // Toggling Technique du Filet Options in editor
  const auraFiletCb = document.getElementById('aura-filet');
  if (auraFiletCb) {
    auraFiletCb.addEventListener('change', (e) => {
      document.getElementById('panel-filet-options').style.display = e.target.checked ? 'block' : 'none';
    });
  }

  const auraFlechesCb = document.getElementById('aura-fleches');
  if (auraFlechesCb) {
    auraFlechesCb.addEventListener('change', (e) => {
      document.getElementById('panel-aura-fleches-loc').style.display = e.target.checked ? 'block' : 'none';
    });
  }

  const auraMassesCb = document.getElementById('aura-masses');
  if (auraMassesCb) {
    auraMassesCb.addEventListener('change', (e) => {
      document.getElementById('panel-aura-masses-loc').style.display = e.target.checked ? 'block' : 'none';
    });
  }

  const delaySelect = document.getElementById('session-reminder-delay');
  if (delaySelect) {
    delaySelect.addEventListener('change', (e) => {
      const isCustom = e.target.value === 'custom';
      const customField = document.querySelector('.custom-date-field');
      if (customField) {
        customField.style.display = isCustom ? 'block' : 'none';
      }
      
      if (!isCustom) {
        const sessionDate = document.getElementById('session-form-date').value;
        const targetDate = calculateFutureDate(sessionDate, e.target.value);
        document.getElementById('session-reminder-date').value = targetDate;
      }
    });
  }

  // Modifier la date de séance recalculera la date de rappel si pas en custom
  const sessionFormDateEl = document.getElementById('session-form-date');
  if (sessionFormDateEl) {
    sessionFormDateEl.addEventListener('change', () => {
      const delayEl = document.getElementById('session-reminder-delay');
      if (delayEl) {
        const delay = delayEl.value;
        if (delay !== 'custom') {
          const sessionDate = sessionFormDateEl.value;
          const targetDate = calculateFutureDate(sessionDate, delay);
          const reminderDateEl = document.getElementById('session-reminder-date');
          if (reminderDateEl) reminderDateEl.value = targetDate;
        }
      }
    });
  }
}

function getCalculatedSummaryText() {
  const parts = [];
  
  // 1. Shiatsu
  if (document.getElementById('proto-shiatsu-enable').checked) {
    const worked = [];
    if (document.getElementById('meridian-reins').checked) worked.push('Reins');
    if (document.getElementById('meridian-vessie').checked) worked.push('Vessie');
    if (document.getElementById('meridian-foie').checked) worked.push('Foie');
    if (document.getElementById('meridian-vesicule').checked) worked.push('Vésicule Biliaire');
    if (document.getElementById('meridian-coeur').checked) worked.push('Cœur');
    if (document.getElementById('meridian-grele').checked) worked.push('Intestin Grêle');
    if (document.getElementById('meridian-maitre-coeur').checked) worked.push('Maître Cœur');
    if (document.getElementById('meridian-triple-rechauffeur').checked) worked.push('Triple Réchauffeur');
    if (document.getElementById('meridian-rate').checked) worked.push('Rate/Pancréas');
    if (document.getElementById('meridian-estomac').checked) worked.push('Estomac');
    if (document.getElementById('meridian-poumon').checked) worked.push('Poumon');
    if (document.getElementById('meridian-gros-intestin').checked) worked.push('Gros Intestin');

    if (document.getElementById('mv-gouverneur').checked) worked.push('Vaisseau Gouverneur');
    if (document.getElementById('mv-conception').checked) worked.push('Vaisseau Conception');

    let text = `**Shiatsu**\nMéridiens travaillés : ` + (worked.length > 0 ? worked.join(', ') : 'Aucun');
    parts.push(text);
  }

  // 2. Techniques Manuelles
  if (document.getElementById('proto-manuelles-enable').checked) {
    const txt = document.getElementById('proto-manuelles-texte').value.trim();
    parts.push(`**Techniques manuelles**\nZones travaillées : ` + (txt || 'Aucune observation saisie.'));
  }

  // 3. Tenségrité
  if (document.getElementById('proto-tensegrite-enable').checked) {
    const mockTensegriteObj = {
      ftm: {
        override: document.getElementById('override-ftm').value,
        queue: document.querySelector('select[data-sub="queue"]').value,
        oeil_droit: document.querySelector('select[data-sub="oeil_droit"]').value,
        oeil_gauche: document.querySelector('select[data-sub="oeil_gauche"]').value,
        energetique: document.querySelector('select[data-sub="energetique"]').value
      },
      torsion: {
        override: document.getElementById('override-torsion').value,
        hanche_droite: document.querySelector('select[data-sub="hanche_droite"]').value,
        hanche_gauche: document.querySelector('select[data-sub="hanche_gauche"]').value,
        occiput: document.querySelector('select[data-sub="occiput"]').value
      },
      diaphragme: {
        override: document.getElementById('override-diaphragme').value,
        pelvien: document.querySelector('select[data-sub="pelvien"]').value,
        thoraco_lombaire: document.querySelector('select[data-sub="thoraco_lombaire"]').value,
        cervico_thoracique: document.querySelector('select[data-sub="cervico_thoracique"]').value,
        c0_c1: document.querySelector('select[data-sub="c0_c1"]').value
      },
      loge: {
        override: document.getElementById('override-loge').value,
        digestive: document.querySelector('select[data-sub="digestive"]').value,
        thoracique: document.querySelector('select[data-sub="thoracique"]').value,
        gorge: document.querySelector('select[data-sub="gorge"]').value,
        cervelet: document.querySelector('select[data-sub="cervelet"]').value
      }
    };

    const tensegriteStr = formatTensegriteReportData(mockTensegriteObj, true);
    const helices = document.getElementById('proto-tensegrite-helices').value.trim();

    let text = `**Tenségrité**\nitem et zones travaillés :`;
    if (tensegriteStr) {
      text += `\n${tensegriteStr}`;
    } else {
      text += `\n• Aucune tension majeure`;
    }
    if (helices) text += `\nHélices : ${helices}`;
    parts.push(text);
  }

  // 4. Cranio-Sacrée
  if (document.getElementById('proto-cranio-enable').checked) {
    const lines = [];

    const ambiance = document.getElementById('proto-cranio-ambiance').value.trim();
    if (ambiance) {
      lines.push(`• Ambiance émotionnelle : ${ambiance}`);
    }

    // Adaptatif
    const adaptatifList = [];
    if (document.getElementById('cranio-sacro').checked) adaptatifList.push("Sacro-iliaque");
    if (document.getElementById('cranio-rre').checked) adaptatifList.push("Os du crâne");
    if (document.getElementById('cranio-occiput').checked) adaptatifList.push("Occiput");
    if (document.getElementById('cranio-couple').checked) adaptatifList.push("Couple scapho-cuboïdien");
    if (document.getElementById('cranio-strains').checked) adaptatifList.push("sphénoïde");
    if (document.getElementById('cranio-grosse-art').checked) adaptatifList.push("Grosse articulation");
    if (adaptatifList.length > 0) {
      lines.push(`• Adaptatif : ${adaptatifList.join(', ')}`);
    }

    // Ceinture pelvienne
    const pelvienneList = [];
    if (document.getElementById('cranio-iliaque-ensemble').checked) pelvienneList.push("Iliaques ensemble");
    if (document.getElementById('cranio-coccygienne').checked) pelvienneList.push("Coccygienne");
    if (document.getElementById('cranio-ixions').checked) pelvienneList.push("Ixions");
    if (document.getElementById('cranio-pubis').checked) pelvienneList.push("Pubis");
    if (document.getElementById('cranio-iliaque-indep').checked) pelvienneList.push("Iliaques indép.");
    if (document.getElementById('cranio-sacrum-liaison').checked) pelvienneList.push("Liaison Iliaque-Sacrum");
    if (pelvienneList.length > 0) {
      lines.push(`• Ceinture pelvienne : ${pelvienneList.join(', ')}`);
    }

    // Autres structures somatiques
    const autresList = [];
    if (document.getElementById('cranio-vertebres').checked) autresList.push("Vertèbres");
    if (document.getElementById('cranio-scapulaire').checked) autresList.push("Ceinture scapulaire");
    if (document.getElementById('cranio-ant-complet').checked) autresList.push("Membres antérieurs");
    if (document.getElementById('cranio-post-complet').checked) autresList.push("Membres postérieurs");
    if (document.getElementById('cranio-genoux').checked) autresList.push("Genoux");
    if (document.getElementById('cranio-jarrets').checked) autresList.push("Jarrets");
    if (document.getElementById('cranio-visceres').checked) {
      const vTxt = document.getElementById('cranio-visceres-text').value.trim();
      autresList.push("Viscères" + (vTxt ? ' ('+vTxt+')' : ''));
    }
    if (autresList.length > 0) {
      lines.push(`• Autres structures : ${autresList.join(', ')}`);
    }

    let text = `**Cranio-Sacrée**`;
    if (lines.length > 0) {
      text += `\n` + lines.join('\n');
    } else {
      text += `\n• Aucune zone spécifique`;
    }
    parts.push(text);
  }

  // 5. Kinésiologie
  if (document.getElementById('proto-kinesiologie-enable').checked) {
    const type = document.getElementById('proto-kinesiologie-type').value;
    const prob = document.getElementById('kinesio-problematique').value.trim();
    const goal = document.getElementById('kinesio-objectif').value.trim();

    let text = `**Kinésiologie** (${type})`;
    const subParts = [];

    if (prob) subParts.push(`<u>Problématique travaillée :</u>\n${prob}`);

    if (type === 'Émotions réactives') {
      const reactives = document.getElementById('kinesio-reactives').value.trim();
      const reactrice = document.getElementById('kinesio-reactrice').value.trim();
      if (reactives) subParts.push(`<u>Émotions réactives :</u>\n${reactives}`);
      if (reactrice) subParts.push(`<u>Émotions réactrices :</u>\n${reactrice}`);
    }

    if (type === 'Émotion d’urgence' || type === 'Émotions d\'urgence') {
      const liberee = document.getElementById('kinesio-liberee').value.trim();
      if (liberee) subParts.push(`<u>Émotion d'urgence libérée :</u>\n${liberee}`);
    }

    const syntho = document.getElementById('kinesio-syntho').value.trim();
    if (type !== 'Émotions réactives' && type !== 'Émotion d’urgence' && type !== 'Émotions d\'urgence' && syntho) {
      subParts.push(`<u>Syntonisation :</u>\n${syntho}`);
    }

    if (goal) subParts.push(`<u>Objectif :</u>\n${goal}`);
    if (ldt) subParts.push(`<u>Ligne de Temps (LDT) :</u>\n${ldt}`);
    subParts.push(`<u>CEN :</u>\nde ${cenD}% à ${cenF}%`);

    text += `\n\n` + subParts.join(`\n\n`);
    parts.push(text);
  }

  // 6. Aura
  if (document.getElementById('proto-aura-enable').checked) {
    const list = [];
    if (document.getElementById('aura-recentrage').checked) list.push("Recentrage");
    if (document.getElementById('aura-liens').checked) list.push("Section des liens");
    if (document.getElementById('aura-vidange').checked) list.push("Vidange");
    if (document.getElementById('aura-fleches').checked) {
      const loc = document.getElementById('aura-fleches-loc').value.trim();
      list.push("Élimination des flèches" + (loc ? ` : ${loc}` : ''));
    }
    if (document.getElementById('aura-masses').checked) {
      const loc = document.getElementById('aura-masses-loc').value.trim();
      list.push("Élimination des masses" + (loc ? ` : ${loc}` : ''));
    }
    if (document.getElementById('aura-recharge').checked) list.push("Recharge / comblement");
    if (document.getElementById('aura-chakras').checked) list.push("Régulation chakras");
    if (document.getElementById('aura-circulation').checked) list.push("Relance circulation");
    if (document.getElementById('aura-mouvement').checked) list.push("Relance mouv. primordial");
    
    // Filet
    if (document.getElementById('aura-filet').checked) {
      const fList = [];
      if (document.getElementById('filet-energies').checked) fList.push('énergies négatives');
      if (document.getElementById('filet-emotions').checked) fList.push('émotions négatives');
      if (document.getElementById('filet-parasites').checked) fList.push('parasites');
      if (document.getElementById('filet-entites').checked) fList.push('petites entités');
      if (document.getElementById('filet-sorts').checked) fList.push('sorts');
      if (document.getElementById('filet-incorporations').checked) fList.push('incorporations');
      list.push(`Technique du filet ${fList.length > 0 ? '['+fList.join(', ')+']' : ''}`);
    }

    // Locaux
    if (document.getElementById('aura-local-filament').checked) list.push("Filament incandescent");
    if (document.getElementById('aura-local-polarites').checked) list.push("Équilibre polarités");
    if (document.getElementById('aura-local-recharge').checked) list.push("Recharge locale");
    if (document.getElementById('aura-local-complement').checked) {
      const cTxt = document.getElementById('aura-local-complement-text').value.trim();
      list.push("Techniques complémentaires" + (cTxt ? ' ('+cTxt+')' : ''));
    }
    
    if (document.getElementById('aura-repolarisation').checked) list.push("Repolarisation");

    let text = `**Aura**`;
    if (list.length > 0) {
      text += `\n` + list.map(item => `• ${item}`).join('\n');
    } else {
      text += `\n• Aucune étape spécifique`;
    }
    parts.push(text);
  }

  let generatedSummaryText = parts.join('\n\n');
  return generatedSummaryText;
}

function generateClientSummaryReport() {
  let generatedSummaryText = getCalculatedSummaryText();
  document.getElementById('session-form-resume').value = generatedSummaryText;
  showToast('Résumé de séance client généré avec succès.');
}

function collectSubIntensities(catName) {
  // Collecte uniquement les éléments en Moyen ou Elevé pour les afficher à côté
  const res = [];
  const selects = document.querySelectorAll(`.tensegrite-category-box[data-category="${catName}"] .sub-intensity`);
  selects.forEach(s => {
    const val = s.value;
    const name = s.closest('.tensegrite-sub-item').querySelector('.tensegrite-sub-name').textContent;
    if (val === 'Moyen' || val === 'Élevé') {
      res.push(`${name} : ${val}`);
    }
  });
  return res;
}

// Enregistrer la séance
async function saveSessionForm() {
  // COLLECTE ET VALIDATION DES RAPPELS DYNAMIQUES
  const reminderRows = document.querySelectorAll('.reminder-row-item');
  const remindersToSave = [];
  for (const row of reminderRows) {
    const delaySelect = row.querySelector('.reminder-item-delay');
    const dateInput = row.querySelector('.reminder-item-date');
    const typeSelect = row.querySelector('.reminder-item-type');
    const notesInput = row.querySelector('.reminder-item-notes');
    
    const delayVal = delaySelect.value;
    const dateVal = dateInput.value;
    const typeVal = typeSelect.value;
    const notesVal = notesInput.value.trim();
    
    if (!dateVal) {
      showToast('Veuillez spécifier une date de rappel valide pour tous les rappels.', 'error');
      dateInput.focus();
      return; // Bloque la sauvegarde
    }
    
    remindersToSave.push({
      delay: delayVal,
      date_prevue: dateVal,
      type_rappel: typeVal,
      notes: notesVal
    });
  }

  const sId = document.getElementById('session-form-id').value;
  const animalId = Number(document.getElementById('session-form-animal').value);
  const dateStr = document.getElementById('session-form-date').value;
  const numSession = parseInt(document.getElementById('session-form-number').value) || 1;
  const motif = document.getElementById('session-form-objective').value.trim();
  const notesObs = document.getElementById('session-form-notes-obs').value.trim();
  const crPerso = document.getElementById('session-form-cr-practicienne').value.trim();
  let resume = document.getElementById('session-form-resume').value.trim();
  if (!resume) {
    resume = getCalculatedSummaryText();
  }

  const animal = await getById('animals', animalId);
  const clientId = animal ? animal.client_id : null;

  // Fusionner les Questionnaires
  const qAvant = collectQuestionnaireData('q-avant-seance-container');
  const q3Sem = collectQuestionnaireData('q-3-semaines-container');

  // Fusionner les protocoles
  const shiatsuChecked = document.getElementById('proto-shiatsu-enable').checked;
  const manuellesChecked = document.getElementById('proto-manuelles-enable').checked;
  const tensegriteChecked = document.getElementById('proto-tensegrite-enable').checked;
  const cranioChecked = document.getElementById('proto-cranio-enable').checked;
  const kinesioChecked = document.getElementById('proto-kinesiologie-enable').checked;
  const auraChecked = document.getElementById('proto-aura-enable').checked;

  const protocoles = {
    shiatsu: {
      checked: shiatsuChecked,
      yin: {
        reins: document.getElementById('meridian-reins').checked,
        foie: document.getElementById('meridian-foie').checked,
        coeur: document.getElementById('meridian-coeur').checked,
        maitre_coeur: document.getElementById('meridian-maitre-coeur').checked,
        rate: document.getElementById('meridian-rate').checked,
        poumon: document.getElementById('meridian-poumon').checked
      },
      yang: {
        vessie: document.getElementById('meridian-vessie').checked,
        vesicule: document.getElementById('meridian-vesicule').checked,
        grele: document.getElementById('meridian-grele').checked,
        triple: document.getElementById('meridian-triple-rechauffeur').checked,
        estomac: document.getElementById('meridian-estomac').checked,
        gros_intestin: document.getElementById('meridian-gros-intestin').checked
      },
      vaisseaux: {
        gouverneur: document.getElementById('mv-gouverneur').checked,
        conception: document.getElementById('mv-conception').checked
      },
      precisions: ''
    },
    manuelles: {
      checked: manuellesChecked,
      texte: document.getElementById('proto-manuelles-texte').value.trim()
    },
    tensegrite: {
      checked: tensegriteChecked,
      ftm: {
        override: document.getElementById('override-ftm').value,
        queue: document.querySelector('select[data-sub="queue"]').value,
        oeil_droit: document.querySelector('select[data-sub="oeil_droit"]').value,
        oeil_gauche: document.querySelector('select[data-sub="oeil_gauche"]').value,
        energetique: document.querySelector('select[data-sub="energetique"]').value
      },
      torsion: {
        override: document.getElementById('override-torsion').value,
        hanche_droite: document.querySelector('select[data-sub="hanche_droite"]').value,
        hanche_gauche: document.querySelector('select[data-sub="hanche_gauche"]').value,
        occiput: document.querySelector('select[data-sub="occiput"]').value
      },
      diaphragme: {
        override: document.getElementById('override-diaphragme').value,
        pelvien: document.querySelector('select[data-sub="pelvien"]').value,
        thoraco_lombaire: document.querySelector('select[data-sub="thoraco_lombaire"]').value,
        cervico_thoracique: document.querySelector('select[data-sub="cervico_thoracique"]').value,
        c0_c1: document.querySelector('select[data-sub="c0_c1"]').value
      },
      loge: {
        override: document.getElementById('override-loge').value,
        digestive: document.querySelector('select[data-sub="digestive"]').value,
        thoracique: document.querySelector('select[data-sub="thoracique"]').value,
        gorge: document.querySelector('select[data-sub="gorge"]').value,
        cervelet: document.querySelector('select[data-sub="cervelet"]').value
      },
      helices: document.getElementById('proto-tensegrite-helices').value.trim(),
      precisions: ''
    },
    cranio: {
      checked: cranioChecked,
      ambiance: document.getElementById('proto-cranio-ambiance').value.trim(),
      adaptatif: {
        sacro: document.getElementById('cranio-sacro').checked,
        rre: document.getElementById('cranio-rre').checked,
        occiput: document.getElementById('cranio-occiput').checked,
        couple: document.getElementById('cranio-couple').checked,
        strains: document.getElementById('cranio-strains').checked,
        grosse_art: document.getElementById('cranio-grosse-art').checked
      },
      somatique: {
        iliaque_ensemble: document.getElementById('cranio-iliaque-ensemble').checked,
        coccygienne: document.getElementById('cranio-coccygienne').checked,
        ixions: document.getElementById('cranio-ixions').checked,
        pubis: document.getElementById('cranio-pubis').checked,
        iliaque_indep: document.getElementById('cranio-iliaque-indep').checked,
        sacrum_liaison: document.getElementById('cranio-sacrum-liaison').checked,
        vertebres: document.getElementById('cranio-vertebres').checked,
        scapulaire: document.getElementById('cranio-scapulaire').checked,
        ant_complet: document.getElementById('cranio-ant-complet').checked,
        post_complet: document.getElementById('cranio-post-complet').checked,
        genoux: document.getElementById('cranio-genoux').checked,
        jarrets: document.getElementById('cranio-jarrets').checked,
        visceres: document.getElementById('cranio-visceres').checked,
        visceres_text: document.getElementById('cranio-visceres-text').value.trim()
      },
      precisions: ''
    },
    kinesiologie: {
      checked: kinesioChecked,
      type: document.getElementById('proto-kinesiologie-type').value,
      emot_reactives: document.getElementById('kinesio-reactives').value.trim(),
      emot_reactrice: document.getElementById('kinesio-reactrice').value.trim(),
      emot_liberee: document.getElementById('kinesio-liberee').value.trim(),
      precisions: '',
      problematique: document.getElementById('kinesio-problematique').value.trim(),
      syntho: document.getElementById('kinesio-syntho').value.trim(),
      objectif: document.getElementById('kinesio-objectif').value.trim(),
      cen_debut: parseInt(document.getElementById('kinesio-cen-debut').value),
      cen_fin: parseInt(document.getElementById('kinesio-cen-fin').value),
      ldt: document.getElementById('kinesio-ldt').value.trim()
    },
    aura: {
      checked: auraChecked,
      recentrage: document.getElementById('aura-recentrage').checked,
      liens: document.getElementById('aura-liens').checked,
      vidange: document.getElementById('aura-vidange').checked,
      fleches: document.getElementById('aura-fleches').checked,
      fleches_loc: document.getElementById('aura-fleches-loc').value.trim(),
      masses: document.getElementById('aura-masses').checked,
      masses_loc: document.getElementById('aura-masses-loc').value.trim(),
      recharge: document.getElementById('aura-recharge').checked,
      chakras: document.getElementById('aura-chakras').checked,
      circulation: document.getElementById('aura-circulation').checked,
      mouvement: document.getElementById('aura-mouvement').checked,
      repolarisation: document.getElementById('aura-repolarisation').checked,
      filet: document.getElementById('aura-filet').checked,
      filet_options: {
        energies: document.getElementById('filet-energies').checked,
        emotions: document.getElementById('filet-emotions').checked,
        parasites: document.getElementById('filet-parasites').checked,
        entites: document.getElementById('filet-entites').checked,
        sorts: document.getElementById('filet-sorts').checked,
        incorporations: document.getElementById('filet-incorporations').checked
      },
      local_filament: document.getElementById('aura-local-filament').checked,
      local_polarites: document.getElementById('aura-local-polarites').checked,
      local_recharge: document.getElementById('aura-local-recharge').checked,
      local_complement: document.getElementById('aura-local-complement').checked,
      local_complement_text: document.getElementById('aura-local-complement-text').value.trim(),
      precisions: ''
    }
  };

  // Canvas dessin : exporter le tracé transparent & le tracé fusionné
  const drawingDataUrl = canvasElement.toDataURL('image/png');
  const mergedDataUrl = await generateMergedCanvasDataUrl();

  const sessionData = {
    animal_id: animalId,
    client_id: clientId,
    date_seance: dateStr,
    motif: motif,
    notes_observations: notesObs,
    n_seance_annee: numSession,
    q_avant_seance: qAvant,
    q_3_semaines: q3Sem,
    protocoles_realises: protocoles,
    canvas_annotation_image_blob: mergedDataUrl, // fusionné pour le CR print
    canvas_drawing_data_url: drawingDataUrl, // transparent pour l'éditeur
    cr_personnel: crPerso,
    precisions: document.getElementById('session-form-precisions').value.trim(),
    delai_prochaine_seance: remindersToSave.length > 0 ? remindersToSave[0].delay : '2m',
    resume_client_genere: resume
  };

  let savedId = null;

  if (sId) {
    sessionData.id = Number(sId);
    await update('sessions', sessionData);
    savedId = sessionData.id;
    showToast('Séance modifiée avec succès.');
  } else {
    savedId = await add('sessions', sessionData);
    showToast('Séance enregistrée avec succès.');
  }

  // --- TRAITEMENT DES RAPPELS MULTIPLES ---
  // Si on éditait, supprimer les anciens rappels associés à cette séance
  if (sId) {
    const existingReminders = await getByIndex('reminders', 'session_id', Number(sId));
    for (const r of existingReminders) {
      await remove('reminders', r.id);
    }
  }

  // Enregistrer les nouveaux rappels
  for (const rData of remindersToSave) {
    const weekStr = getYearWeek(new Date(rData.date_prevue));
    await add('reminders', {
      animal_id: animalId,
      client_id: clientId,
      session_id: savedId,
      date_prevue: rData.date_prevue,
      semaine_prevue: weekStr,
      type_rappel: rData.type_rappel,
      statut: 'en_attente',
      notes: rData.notes,
      delay: rData.delay
    });
  }

  if (remindersToSave.length > 0) {
    showToast(`${remindersToSave.length} rappel(s) planifié(s).`);
  }

  window.location.hash = `sessions/${savedId}`;
}

// --- RENDU : DIRECTORY PROFESSIONALS ---
async function renderProfessionalsList() {
  const professionals = await getAll('professionals');
  const animals = await getAll('animals');
  const searchInput = document.getElementById('prof-search-input');
  if (searchInput && !searchInput.dataset.listener) {
    searchInput.dataset.listener = 'true';
    searchInput.addEventListener('input', renderProfessionalsList);
  }
  const filterVal = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const tbody = document.getElementById('professionals-table-body');
  tbody.innerHTML = '';

  const filtered = professionals.filter(p => {
    if (!filterVal) return true;
    return (p.nom && p.nom.toLowerCase().includes(filterVal)) ||
           (p.prenom && p.prenom.toLowerCase().includes(filterVal)) ||
           (p.specialite && p.specialite.toLowerCase().includes(filterVal)) ||
           (p.notes && p.notes.toLowerCase().includes(filterVal));
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Aucun professionnel enregistré.</td></tr>';
  } else {
    for (const p of filtered) {
      const associatedAnimals = animals.filter(an => {
        const pros = an.pros_associes_ids || [];
        return pros.includes(p.id);
      });

      let animalsHtml = '-';
      if (associatedAnimals.length > 0) {
        animalsHtml = associatedAnimals.map(an => {
          const emojiMap = {
            'cheval': '🐴',
            'chien': '🐕',
            'chat': '🐱'
          };
          const emoji = emojiMap[an.espece.toLowerCase()] || '🐾';
          return `<button class="btn-link-animal" data-id="${an.id}" style="background: none; border: none; color: var(--color-primary); cursor: pointer; text-decoration: underline; padding: 0; font-family: inherit; font-size: inherit; display: inline-flex; align-items: center; gap: 4px; margin-right: 8px; vertical-align: middle;">
            <span>${emoji}</span>
            <span>${an.nom}</span>
          </button>`;
        }).join(' ');
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${p.nom.toUpperCase()}</strong> ${p.prenom}</td>
        <td><span class="panel-badge" style="background:rgba(255,255,255,0.06); color:var(--text-main); font-weight:600;">${p.specialite}</span></td>
        <td>${p.telephone || '-'}</td>
        <td>${animalsHtml}</td>
        <td style="font-size:0.85rem; color:var(--text-muted); max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${p.notes || ''}">${p.notes || '-'}</td>
        <td class="actions-column">
          <button class="btn btn-secondary btn-small btn-edit-prof" data-id="${p.id}">Modifier</button>
        </td>
      `;

      tr.querySelector('.btn-edit-prof').addEventListener('click', (e) => {
        e.stopPropagation();
        openProfessionalDialog(p);
      });

      tr.querySelectorAll('.btn-link-animal').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const animId = Number(btn.dataset.id);
          window.location.hash = `animals/${animId}`;
        });
      });

      tbody.appendChild(tr);
    }
  }
}

// --- RENDU : SUIVI ET RAPPELS PAR SEMAINE ---
async function renderRemindersList() {
  const reminders = await getAll('reminders');
  const animals = await getAll('animals');
  const clients = await getAll('clients');

  const statusFilter = document.getElementById('reminder-status-filter');
  if (statusFilter && !statusFilter.dataset.listener) {
    statusFilter.dataset.listener = 'true';
    statusFilter.addEventListener('change', renderRemindersList);
  }
  const statusFilterVal = statusFilter ? statusFilter.value : 'pending';

  const searchInput = document.getElementById('reminder-search-input');
  if (searchInput && !searchInput.dataset.listener) {
    searchInput.dataset.listener = 'true';
    searchInput.addEventListener('input', renderRemindersList);
  }
  const filterVal = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const container = document.getElementById('reminders-grouped-container');
  container.innerHTML = '';

  const filtered = reminders.filter(r => {
    // Status Filter
    if (statusFilterVal === 'pending' && r.statut !== 'en_attente') return false;
    if (statusFilterVal === 'completed' && r.statut !== 'fait') return false;

    // Search Filter
    if (filterVal) {
      const q = normalizeText(filterVal);
      const animalId = r.animal_id || r.animalId;
      const animal = animalId ? (animals.find(an => an.id === animalId) || {}) : {};
      
      const clientId = r.client_id || r.clientId || animal.client_id || animal.clientId;
      const client = clientId ? (clients.find(cl => cl.id === clientId) || {}) : {};
      
      const taskValues = Object.values(r).filter(v => typeof v === 'string' || typeof v === 'number').join(' ');
      const animalName = animal.nom || animal.name || '';
      const clientLastName = client.nom || client.lastName || client.name || '';
      const clientFirstName = client.prenom || client.firstName || '';
      
      const searchCorpus = [
        taskValues,
        animalName,
        clientLastName,
        clientFirstName
      ].filter(Boolean).join(' ').toLowerCase();

      if (!normalizeText(searchCorpus).includes(q)) return false;
    }

    return true;
  });

  if (filterVal && filtered.length === 0) {
    container.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; color: var(--text-sub); font-style: italic; background: rgba(255, 255, 255, 0.02); border-radius: 8px; border: 1px dashed var(--glass-border); font-size: 0.95rem;">
        Aucune tâche ou rappel trouvé pour cette recherche
      </div>
    `;
    return;
  }

  // Get current week
  const currentWeek = getYearWeek(new Date());

  // Grouper par semaine prévue
  const grouped = {};
  if (!filterVal) {
    grouped[currentWeek] = []; // Always initialize current week ONLY when not searching
  }

  filtered.forEach(r => {
    // Calculer la semaine si manquante
    const w = r.semaine_prevue || getYearWeek(new Date(r.date_prevue));
    if (!grouped[w]) {
      grouped[w] = [];
    }
    grouped[w].push(r);
  });

  // Trier les semaines
  const weeks = Object.keys(grouped).sort((a,b) => {
    return a.localeCompare(b);
  });

  for (const w of weeks) {
    const isCurrent = (w === currentWeek);
    const hasUncompleted = grouped[w].some(r => r.statut === 'en_attente');
    const isPastOverdue = (w < currentWeek && hasUncompleted);

    const sec = document.createElement('div');
    sec.className = 'reminder-week-section';
    
    let headerClass = '';
    if (isCurrent) {
      headerClass = 'current-week';
    } else if (isPastOverdue) {
      headerClass = 'past-overdue';
    } else if (w > currentWeek) {
      headerClass = 'future-week';
    }

    sec.innerHTML = `
      <div class="reminder-week-header ${headerClass}">${formatWeekDisplay(w)}</div>
      <div class="reminder-list"></div>
    `;

    const list = sec.querySelector('.reminder-list');
    
    if (grouped[w].length === 0) {
      list.innerHTML = `
        <div class="reminder-item-empty" style="padding: 12px 15px; text-align: center; color: var(--text-sub); font-style: italic; background: rgba(255, 255, 255, 0.02); border-radius: 8px; border: 1px dashed var(--glass-border); font-size: 0.9rem;">
          Aucune tâche cette semaine
        </div>
      `;
    } else {
      // Trier les rappels dans la semaine par date
      grouped[w].sort((a,b) => new Date(a.date_prevue) - new Date(b.date_prevue));

      for (const r of grouped[w]) {
        const animal = animals.find(an => an.id === r.animal_id);
        const client = clients.find(cl => cl.id === r.client_id);
        
        const animalName = animal ? animal.nom : 'Animal inconnu';
        const ownerName = client ? `${client.prenom} ${client.nom}` : '-';

        const rItem = document.createElement('div');
        
        let statusClass = 'status-future';
        if (r.statut === 'fait') {
          statusClass = '';
        } else {
          const delayDays = Math.ceil((new Date(r.date_prevue) - new Date()) / (1000 * 60 * 60 * 24));
          if (delayDays < 0) statusClass = 'status-overdue';
          else if (delayDays === 0) statusClass = 'status-today';
        }

        rItem.className = `reminder-item ${statusClass}`;
        
        const displayName = r.type_rappel === 'prendre_des_nouvelles' ? 'Prendre des nouvelles' : (r.type_rappel === 'fixer_rdv' ? 'Fixer RDV' : r.type_rappel);
        
        rItem.innerHTML = `
          <div class="reminder-left" style="cursor: pointer; flex-grow: 1; margin-right: 15px;">
            <span class="reminder-date-tag">${formatDate(r.date_prevue)} ${r.statut === 'fait' ? '[Traité]' : ''}</span>
            <span class="reminder-title">${displayName} &bull; ${animalName}</span>
            <span class="reminder-meta">Propriétaire : ${ownerName} &bull; ${r.notes || 'Sans note'}</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
            <button class="btn btn-secondary btn-small btn-edit-reminder" style="background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); color: var(--text-main);">Modifier / Reporter</button>
            ${r.statut === 'en_attente' ? `<button class="btn btn-secondary btn-small btn-complete-reminder-list" data-id="${r.id}">Marquer Fait</button>` : ''}
          </div>
        `;

        rItem.querySelector('.reminder-left').addEventListener('click', () => {
          if (r.animal_id) {
            window.location.hash = `animals/${r.animal_id}`;
          }
        });

        const editBtn = rItem.querySelector('.btn-edit-reminder');
        if (editBtn) {
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openReminderDialog(r);
          });
        }

        const btn = rItem.querySelector('.btn-complete-reminder-list');
        if (btn) {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            r.statut = 'fait';
            await update('reminders', r);
            showToast('Rappel effectué.');
            await renderRemindersList();
          });
        }

        list.appendChild(rItem);
      }
    }

    container.appendChild(sec);
  }
}

// Event listener filtre rappel
const reminderStatusFilter = document.getElementById('reminder-status-filter');
if (reminderStatusFilter) {
  reminderStatusFilter.addEventListener('change', renderRemindersList);
}

// --- RENDU : SAUVEGARDES, EXPORTS & STATS ---
async function renderSettingsData() {
  const clients = await getAll('clients');
  const animals = await getAll('animals');
  const sessions = await getAll('sessions');
  const reminders = await getAll('reminders');

  // 1. Moyenne séances par animal
  const avg = animals.length > 0 ? (sessions.length / animals.length).toFixed(1) : '0.0';
  document.getElementById('stat-avg-sessions-animal').textContent = avg;

  // 2. Taux de rappels traités
  const completedR = reminders.filter(r => r.statut === 'fait').length;
  const pctR = reminders.length > 0 ? Math.round((completedR / reminders.length) * 100) : 0;
  document.getElementById('stat-reminders-done').textContent = `${pctR}%`;

  // 3. Espèce majoritaire
  const speciesCounts = {};
  animals.forEach(an => {
    const sp = an.espece || 'Autre';
    speciesCounts[sp] = (speciesCounts[sp] || 0) + 1;
  });
  
  let majSp = 'Aucune';
  let maxVal = 0;
  Object.entries(speciesCounts).forEach(([sp, val]) => {
    if (val > maxVal) {
      maxVal = val;
      majSp = sp;
    }
  });
  document.getElementById('stat-most-species').textContent = majSp !== 'Aucune' ? `${majSp} (${maxVal})` : 'Aucune';
}


// --- GESTIONNAIRES DE SAUVEGARDE & RESTAURATION ---
function setupBackupRestore() {
  // Export JSON complet
  document.getElementById('btn-export-backup').onclick = async () => {
    try {
      const data = await exportAllData();
      const str = JSON.stringify(data, null, 2);
      const blob = new Blob([str], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `sauvegarde_ekikare_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      showToast('Sauvegarde de la base exportée avec succès.');
    } catch (err) {
      console.error(err);
      showToast('Erreur lors de l\'exportation de la sauvegarde.', 'error');
    }
  };

  // Import JSON complet
  document.getElementById('import-backup-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (confirm('L\'importation écrasera l\'intégralité des données IndexedDB actuelles. Continuer ?')) {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const importData = JSON.parse(evt.target.result);
          await importAllData(importData);
          showToast('Sauvegarde restaurée avec succès.');
          // Recharger le tableau de bord
          window.location.hash = 'dashboard';
          handleRouting();
        } catch (err) {
          console.error(err);
          showToast('Fichier invalide ou corrompu.', 'error');
        }
      };
      reader.readAsText(file);
    }
    // clear input value to allow re-upload
    e.target.value = '';
  };

  // Export CSV Séances
  document.getElementById('btn-export-csv-sessions').onclick = async () => {
    const sessions = await getAll('sessions');
    const animals = await getAll('animals');
    
    let csv = '\uFEFF'; // BOM pour Excel UTF-8
    csv += 'ID Séance;Date;ID Animal;Nom Animal;Motif;N° Séance Année;Résumé Client\n';
    
    sessions.forEach(s => {
      const an = animals.find(a => a.id === s.animal_id);
      const anName = an ? an.nom : 'Inconnu';
      
      // Nettoyer le résumé pour le CSV
      const resumeClean = s.resume_client_genere ? s.resume_client_genere.replace(/[\n\r;]+/g, ' ') : '';
      
      csv += `${s.id};${s.date_seance};${s.animal_id};"${anName.replace(/"/g, '""')}";"${s.motif.replace(/"/g, '""')}";${s.n_seance_annee || 1};"${resumeClean.replace(/"/g, '""')}"\n`;
    });

    downloadCSV(csv, 'sessions_ekikare.csv');
  };

  // Export CSV Animaux
  document.getElementById('btn-export-csv-animals').onclick = async () => {
    const animals = await getAll('animals');
    const clients = await getAll('clients');

    let csv = '\uFEFF'; // BOM pour Excel UTF-8
    csv += 'ID Animal;Nom;Espèce;Race;Robe;Sexe;Naissance/Âge;Lieu de vie;Propriétaire\n';
animals.forEach(an => {
      const cl = clients.find(c => c.id === an.client_id);
      const clName = cl ? `${cl.prenom} ${cl.nom}` : 'Inconnu';

      csv += `${an.id};"${an.nom.replace(/"/g, '""')}";"${an.espece.replace(/"/g, '""')}";"${(an.race || '').replace(/"/g, '""')}";"${(an.robe || '').replace(/"/g, '""')}";"${an.sexe || ''}";"${an.date_naissance_ou_age || ''}";"${(an.lieu_de_vie || '').replace(/"/g, '""')}";"${clName.replace(/"/g, '""')}"\n`;
    });

    downloadCSV(csv, 'animaux_ekikare.csv');
  };
}

function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Fichier d\'analyse CSV exporté.');
}

// --- DIALOGS (MODALS) POPUPS LOGIC ---

// STATE VARIABLES FOR EXTERNAL SESSION FILES
let extSessionFileData = null;
let extSessionFileName = null;
let extSessionFileType = null;

// MODALE VISUALISATION DOCUMENT / COMPTE-RENDU JOINT
function openDocumentViewerModal(fileData, fileType, fileName, extraInfo = {}) {
  const dialog = document.getElementById('dialog-document-viewer');
  if (!dialog || !fileData) {
    showToast("Aucun document joint à afficher.", "error");
    return;
  }

  try {
    const base64Content = fileData.includes(',') ? fileData.split(',')[1] : fileData;
    const mime = fileType || (fileData.includes(',') ? fileData.split(',')[0].split(':')[1].split(';')[0] : 'application/octet-stream');
    
    const byteCharacters = atob(base64Content);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mime });
    const blobUrl = URL.createObjectURL(blob);

    const titleEl = document.getElementById('doc-viewer-title');
    const subtitleEl = document.getElementById('doc-viewer-subtitle');
    const iconEl = document.getElementById('doc-viewer-icon');
    const bodyEl = document.getElementById('doc-viewer-body');
    const downloadBtn = document.getElementById('btn-download-doc-viewer');
    const shareBtn = document.getElementById('btn-share-doc-viewer');

    const cleanFilename = fileName || (mime.includes('pdf') ? 'compte_rendu.pdf' : 'document.jpg');
    if (titleEl) titleEl.textContent = cleanFilename;
    if (subtitleEl) {
      subtitleEl.textContent = extraInfo.subtitle || `${mime} • ${(blob.size / 1024).toFixed(1)} Ko`;
    }

    const isImage = mime.startsWith('image/');
    const isPdf = mime === 'application/pdf' || mime.includes('pdf') || cleanFilename.toLowerCase().endsWith('.pdf');

    if (iconEl) {
      iconEl.textContent = isPdf ? '📄' : (isImage ? '🖼️' : '📎');
    }

    if (isImage) {
      bodyEl.innerHTML = `
        <div style="width: 100%; display: flex; justify-content: center; align-items: center; max-height: 75vh; overflow: auto; padding: 10px;">
          <img src="${blobUrl}" alt="${cleanFilename}" style="max-width: 100%; max-height: 75vh; object-fit: contain; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
        </div>
      `;
    } else if (isPdf) {
      bodyEl.innerHTML = `
        <div style="width: 100%; height: 75vh; position: relative;">
          <iframe src="${blobUrl}" style="width: 100%; height: 100%; border: none; border-radius: 8px; background: #fff;" title="${cleanFilename}"></iframe>
        </div>
      `;
    } else {
      bodyEl.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
          <div style="font-size: 3rem; margin-bottom: 12px;">📁</div>
          <h3 style="color: #fff; margin-bottom: 8px;">${cleanFilename}</h3>
          <p style="color: var(--text-sub); margin-bottom: 20px;">Type de fichier : ${mime}</p>
          <a href="${blobUrl}" download="${cleanFilename}" class="btn btn-primary">Télécharger le document</a>
        </div>
      `;
    }

    // Télécharger
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = cleanFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast(`Document téléchargé : ${cleanFilename}`);
      };
    }

    // Partager
    if (shareBtn) {
      shareBtn.onclick = async () => {
        try {
          const file = new File([blob], cleanFilename, { type: mime });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: cleanFilename,
              text: extraInfo.text || `Document ${cleanFilename}`
            });
            showToast("Document partagé avec succès !");
            return;
          }
        } catch (e) {
          if (e.name !== 'AbortError') console.warn('Share file error:', e);
        }
        
        // Fallback share text/url
        const shareData = {
          title: cleanFilename,
          text: extraInfo.text || `Document joint : ${cleanFilename}`,
          url: window.location.href
        };
        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
          try {
            await navigator.share(shareData);
            showToast("Lien partagé avec succès !");
            return;
          } catch (e) {
            if (e.name !== 'AbortError') console.warn('Share error:', e);
          }
        }

        // Fallback clipboard
        try {
          await navigator.clipboard.writeText(`${cleanFilename} - ${window.location.href}`);
          showToast("Lien copié dans le presse-papier !");
        } catch (e) {
          showToast("Partage non supporté sur cet appareil.", "error");
        }
      };
    }

    // Fermeture
    const closeBtns = dialog.querySelectorAll('.btn-close-dialog');
    closeBtns.forEach(btn => {
      btn.onclick = () => {
        dialog.close();
      };
    });

    dialog.onclick = (e) => {
      const rect = dialog.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        dialog.close();
      }
    };

    dialog.showModal();
  } catch (err) {
    console.error("Erreur lors de l'ouverture du document", err);
    showToast("Impossible d'ouvrir le document joint.", "error");
  }
}

// VIEW EXTERNAL SESSION ATTACHED FILE
function openAttachedFile(fileData, fileType, fileName, extraInfo = {}) {
  openDocumentViewerModal(fileData, fileType, fileName, extraInfo);
}

// SETUP STATIC LISTENERS FOR EXTERNAL SESSION DIALOG
function setupExternalSessionListeners() {
  const fileInput = document.getElementById('ext-session-file');
  const fileInfo = document.getElementById('ext-session-file-info');
  const fileNameSpan = document.getElementById('ext-session-file-name');
  const fileDeleteBtn = document.getElementById('btn-ext-session-file-delete');
  const professionSelect = document.getElementById('ext-session-profession');
  const otherGroup = document.getElementById('group-ext-session-profession-other');
  const otherInput = document.getElementById('ext-session-profession-other');

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          extSessionFileData = reader.result;
          extSessionFileName = file.name;
          extSessionFileType = file.type;
          if (fileNameSpan) fileNameSpan.textContent = file.name;
          if (fileInfo) fileInfo.style.display = 'block';
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (fileDeleteBtn) {
    fileDeleteBtn.addEventListener('click', () => {
      extSessionFileData = null;
      extSessionFileName = null;
      extSessionFileType = null;
      if (fileInput) fileInput.value = '';
      if (fileInfo) fileInfo.style.display = 'none';
    });
  }

  if (professionSelect) {
    professionSelect.addEventListener('change', () => {
      if (professionSelect.value === 'Autre') {
        if (otherGroup) otherGroup.style.display = 'block';
        if (otherInput) otherInput.setAttribute('required', 'required');
      } else {
        if (otherGroup) otherGroup.style.display = 'none';
        if (otherInput) {
          otherInput.removeAttribute('required');
          otherInput.value = '';
        }
      }
    });
  }
}

// OPEN EXTERNAL SESSION DIALOG
function openExternalSessionDialog(session = null, animalId = null) {
  const dialog = document.getElementById('dialog-external-session');
  const form = document.getElementById('dialog-external-session-form');
  
  if (!dialog || !form) return;

  // Title
  document.getElementById('dialog-external-session-title').textContent = session 
    ? 'Modifier la séance' 
    : 'Ajouter une séance';
    
  // IDs
  document.getElementById('dialog-external-session-id').value = session ? session.id : '';
  document.getElementById('dialog-external-session-animal-id').value = session ? session.animal_id : (animalId || '');
  
  // Fields
  document.getElementById('ext-session-date').value = session ? session.date_seance : new Date().toISOString().split('T')[0];
  
  const professionSelect = document.getElementById('ext-session-profession');
  const otherGroup = document.getElementById('group-ext-session-profession-other');
  const otherInput = document.getElementById('ext-session-profession-other');
  
  if (session) {
    const isStandard = ['Ostéopathe', 'Masseur', 'Maréchal', 'Podologue', 'Dentiste', 'Nutritionniste', 'Naturopathe', 'Nutri + Naturo', 'Vétérinaire', 'Coach', 'Comportementaliste', 'Saddle Fitter'].includes(session.profession);
    if (isStandard) {
      professionSelect.value = session.profession;
      otherGroup.style.display = 'none';
      otherInput.removeAttribute('required');
      otherInput.value = '';
    } else {
      professionSelect.value = 'Autre';
      otherGroup.style.display = 'block';
      otherInput.setAttribute('required', 'required');
      otherInput.value = session.profession;
    }
    
    document.getElementById('ext-session-practitioner').value = session.practitionerName || '';
    document.getElementById('ext-session-motif').value = session.motif || '';
    document.getElementById('ext-session-summary').value = session.summary || '';
    
    extSessionFileData = session.fileData || null;
    extSessionFileName = session.fileName || null;
    extSessionFileType = session.fileType || null;
  } else {
    professionSelect.value = '';
    otherGroup.style.display = 'none';
    otherInput.removeAttribute('required');
    otherInput.value = '';
    
    document.getElementById('ext-session-practitioner').value = '';
    document.getElementById('ext-session-motif').value = '';
    document.getElementById('ext-session-summary').value = '';
    
    extSessionFileData = null;
    extSessionFileName = null;
    extSessionFileType = null;
  }
  
  document.getElementById('ext-session-file').value = '';
  const fileInfo = document.getElementById('ext-session-file-info');
  const fileNameSpan = document.getElementById('ext-session-file-name');
  if (extSessionFileData) {
    fileNameSpan.textContent = extSessionFileName || 'Fichier joint';
    fileInfo.style.display = 'block';
  } else {
    fileInfo.style.display = 'none';
  }
  
  // Cancel buttons
  const cancelBtns = dialog.querySelectorAll('.btn-cancel-dialog, .btn-close-dialog');
  cancelBtns.forEach(btn => {
    btn.onclick = () => dialog.close();
  });
  
  // Submit handler
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('dialog-external-session-id').value;
    const finalAnimalId = Number(document.getElementById('dialog-external-session-animal-id').value);
    const dateVal = document.getElementById('ext-session-date').value;
    let profession = professionSelect.value;
    if (profession === 'Autre') {
      profession = otherInput.value.trim();
    }
    
    const practitionerName = document.getElementById('ext-session-practitioner').value.trim();
    const motif = document.getElementById('ext-session-motif').value.trim();
    const summary = document.getElementById('ext-session-summary').value.trim();
    
    if (!dateVal || !profession) {
      showToast("Veuillez renseigner la date et la spécialité.", "error");
      return;
    }
    
    const animal = await getById('animals', finalAnimalId);
    
    const sessionObj = {
      isExternal: true,
      animal_id: finalAnimalId,
      client_id: animal ? (animal.client_id || animal.clientId || null) : null,
      date_seance: dateVal,
      practitionerName: practitionerName,
      profession: profession,
      motif: motif,
      summary: summary,
      fileData: extSessionFileData,
      fileName: extSessionFileName,
      fileType: extSessionFileType
    };
    
    if (id) {
      sessionObj.id = Number(id);
      await update('sessions', sessionObj);
      showToast("Séance modifiée avec succès.");
    } else {
      await add('sessions', sessionObj);
      showToast("Séance ajoutée avec succès.");
    }
    
    dialog.close();
    await renderAnimalDetails(finalAnimalId);
  };

  dialog.showModal();
}

// 1. DIALOG CLIENT (AJOUTER / MODIFIER)
function openClientDialog(client = null) {
  const dialog = document.getElementById('dialog-client');
  const form = document.getElementById('dialog-client-form');
  form.reset();

  const titleEl = document.getElementById('dialog-client-title');
  const idInput = document.getElementById('dialog-client-id');

  if (client) {
    titleEl.textContent = 'Modifier le Client';
    idInput.value = client.id;
    document.getElementById('client-form-lastname').value = client.nom;
    document.getElementById('client-form-firstname').value = client.prenom;
    document.getElementById('client-form-phone').value = client.telephone;
    document.getElementById('client-form-email').value = client.email || '';
    document.getElementById('client-form-address').value = client.adresse || '';
    document.getElementById('client-form-stable').value = client.ecurie || '';
    document.getElementById('client-form-notes').value = client.notes ? String(client.notes).replace(/\[portal_token:[^\]]+\]/g, '').trim() : '';
  } else {
    titleEl.textContent = 'Nouveau Client';
    idInput.value = '';
    document.getElementById('client-form-stable').value = '';
  }

  // Cancel buttons
  const cancelBtns = dialog.querySelectorAll('.btn-cancel-dialog, .btn-close-dialog');
  cancelBtns.forEach(btn => {
    btn.onclick = () => dialog.close();
  });

  // Submit form
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    const clientData = {
      nom: document.getElementById('client-form-lastname').value.trim(),
      prenom: document.getElementById('client-form-firstname').value.trim(),
      telephone: document.getElementById('client-form-phone').value.trim(),
      email: document.getElementById('client-form-email').value.trim(),
      adresse: document.getElementById('client-form-address').value.trim(),
      ecurie: document.getElementById('client-form-stable').value.trim(),
      notes: document.getElementById('client-form-notes').value.trim()
    };

    if (idInput.value) {
      clientData.id = Number(idInput.value);
      if (client) {
        clientData.uuid = client.uuid || generateUUID();
      }
      await update('clients', clientData);
      showToast('Client modifié.');
    } else {
      clientData.uuid = generateUUID();
      await add('clients', clientData);
      showToast('Client créé.');
    }

    dialog.close();
    
    // Recharger la vue clients active
    if (currentPortalClientId) {
      await renderPortalDetails(currentPortalClientId);
    } else if (window.location.hash.startsWith('#clients/')) {
      await renderClientDetails(currentClientId);
    } else {
      await renderClientsList();
    }
    
    // Recharger dashboard au cas où
    await renderDashboard();
  };

  dialog.showModal();
}

let currentMedicalEvents = [];

function renderFormMedicalEventsList() {
  const container = document.getElementById('animal-form-med-events-list');
  if (!container) return;
  container.innerHTML = '';
  
  // Sort chronologically ascending
  currentMedicalEvents.sort((a, b) => {
    const yearA = parseInt(a.year) || 0;
    const yearB = parseInt(b.year) || 0;
    if (yearA !== yearB) return yearA - yearB;
    return 0;
  });

  currentMedicalEvents.forEach((ev, idx) => {
    const item = document.createElement('div');
    item.className = 'med-event-item';
    item.innerHTML = `
      <span class="med-event-item-text">
        <strong>${ev.year}</strong> ${ev.month ? `- ${ev.month}` : ''} : ${ev.event}
      </span>
      <button type="button" class="btn-delete-med-event" data-index="${idx}">&times;</button>
    `;
    item.querySelector('.btn-delete-med-event').onclick = () => {
      currentMedicalEvents.splice(idx, 1);
      renderFormMedicalEventsList();
    };
    container.appendChild(item);
  });
}

// 2. DIALOG ANIMAL (AJOUTER / MODIFIER)
async function openAnimalDialog(animal = null, preselectedClientId = null) {
  const dialog = document.getElementById('dialog-animal');
  const form = document.getElementById('dialog-animal-form');
  form.reset();

  const atHomeCheckbox = document.getElementById('animal-form-stable-at-home');
  const locGrid1 = document.getElementById('animal-form-location-grid-1');
  const locGrid2 = document.getElementById('animal-form-location-grid-2');
  const toggleLocationFields = () => {
    const isAtHome = atHomeCheckbox.checked;
    locGrid1.style.display = isAtHome ? 'none' : 'grid';
    locGrid2.style.display = isAtHome ? 'none' : 'grid';
  };
  if (atHomeCheckbox) {
    atHomeCheckbox.onchange = toggleLocationFields;
  }

  const titleEl = document.getElementById('dialog-animal-title');
  const idInput = document.getElementById('dialog-animal-id');
  const ownerSelect = document.getElementById('animal-form-owner');

  // Charger la liste des clients pour le select propriétaire
  ownerSelect.innerHTML = '';
  const clients = await getAll('clients');
  clients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.prenom} ${c.nom}`;
    ownerSelect.appendChild(opt);
  });

  // Charger la liste des écuries connues pour l'auto-complétion
  const allAnimals = await getAll('animals');
  const knownStables = [];
  allAnimals.forEach(an => {
    if (an.stable_name && an.stable_name.trim()) {
      const name = an.stable_name.trim();
      const existing = knownStables.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (!existing) {
        knownStables.push({
          name: name,
          address: (an.stable_address || '').trim(),
          zip: (an.stable_zip || '').trim(),
          city: (an.stable_city || '').trim(),
          distance: an.stable_distance || 0
        });
      } else {
        if (!existing.address && an.stable_address) existing.address = an.stable_address.trim();
        if (!existing.zip && an.stable_zip) existing.zip = an.stable_zip.trim();
        if (!existing.city && an.stable_city) existing.city = an.stable_city.trim();
        if (!existing.distance && an.stable_distance) existing.distance = an.stable_distance;
      }
    } else if (an.lieu_de_vie && an.lieu_de_vie.trim()) {
      const oldLieu = an.lieu_de_vie.trim();
      if (oldLieu !== 'Non spécifié') {
        const parsed = parseAddress(oldLieu);
        const name = oldLieu;
        const existing = knownStables.find(s => s.name.toLowerCase() === name.toLowerCase());
        if (!existing) {
          knownStables.push({
            name: name,
            address: parsed.address,
            zip: parsed.zip,
            city: parsed.city,
            distance: an.stable_distance || 0
          });
        }
      }
    }
  });

  const datalist = document.getElementById('stable-names-datalist');
  if (datalist) {
    datalist.innerHTML = '';
    knownStables.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.name;
      datalist.appendChild(opt);
    });
  }

  const nameInput = document.getElementById('animal-form-stable-name');
  if (nameInput) {
    nameInput.oninput = () => {
      const val = nameInput.value.trim().toLowerCase();
      const match = knownStables.find(s => s.name.toLowerCase() === val);
      if (match) {
        const addrInput = document.getElementById('animal-form-stable-address');
        const zipInput = document.getElementById('animal-form-stable-zip');
        const cityInput = document.getElementById('animal-form-stable-city');
        const distInput = document.getElementById('animal-form-stable-distance');
        
        if (addrInput) addrInput.value = match.address || '';
        if (zipInput) zipInput.value = match.zip || '';
        if (cityInput) cityInput.value = match.city || '';
        if (distInput) distInput.value = match.distance || '';
      }
    };
  }

  // Setup photo elements
  const fileInput = document.getElementById('animal-form-photo-file');
  const previewImg = document.getElementById('animal-form-photo-preview');
  const placeholder = document.getElementById('animal-form-photo-placeholder');
  const photoDataInput = document.getElementById('animal-form-photo-data');
  
  if (fileInput && !fileInput.dataset.listener) {
    fileInput.dataset.listener = 'true';
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target.result;
          if (photoDataInput) photoDataInput.value = base64;
          if (previewImg) {
            previewImg.src = base64;
            previewImg.style.display = 'block';
          }
          if (placeholder) placeholder.style.display = 'none';
        };
        reader.readAsDataURL(file);
      }
    };
  }

  // Setup conditional select options
  const speciesSelect = document.getElementById('animal-form-species');
  const speciesOther = document.getElementById('animal-form-species-other');
  
  const groupHousing = document.getElementById('group-housing-type');
  const groupSocial = document.getElementById('group-social-type');
  const groupWork = document.getElementById('group-work-objective');
  const groupLifestyle = document.getElementById('group-lifestyle-details');

  const updateSpeciesFields = () => {
    const isHorse = speciesSelect.value === 'Cheval';
    if (groupHousing) groupHousing.style.display = isHorse ? 'block' : 'none';
    if (groupSocial) groupSocial.style.display = isHorse ? 'block' : 'none';
    if (groupWork) groupWork.style.display = isHorse ? 'block' : 'none';
    if (groupLifestyle) groupLifestyle.style.display = isHorse ? 'none' : 'block';
  };

  if (speciesSelect) {
    speciesSelect.onchange = () => {
      speciesOther.style.display = speciesSelect.value === 'Autre' ? 'block' : 'none';
      updateSpeciesFields();
    };
  }

  const housingTypeSelect = document.getElementById('animal-form-housing-type');
  const housingTypeOther = document.getElementById('animal-form-housing-type-other');
  if (housingTypeSelect) {
    housingTypeSelect.onchange = () => {
      housingTypeOther.style.display = housingTypeSelect.value === 'Autre' ? 'block' : 'none';
    };
  }

  const trackingSelect = document.getElementById('animal-form-tracking-mode');
  const trackingOther = document.getElementById('animal-form-tracking-mode-other');
  if (trackingSelect) {
    trackingSelect.onchange = () => {
      trackingOther.style.display = trackingSelect.value === 'Autre' ? 'block' : 'none';
    };
  }

  // Setup dynamic medical events builder
  const addEventBtn = document.getElementById('btn-add-med-event');
  if (addEventBtn && !addEventBtn.dataset.listener) {
    addEventBtn.dataset.listener = 'true';
    addEventBtn.onclick = () => {
      const yearInput = document.getElementById('animal-form-med-year');
      const monthInput = document.getElementById('animal-form-med-month');
      const eventInput = document.getElementById('animal-form-med-event');
      
      const year = yearInput.value.trim();
      const month = monthInput.value.trim();
      const event = eventInput.value.trim();
      
      if (!year || !event) {
        showToast('L\'année et la description de l\'événement sont obligatoires.', 'warning');
        return;
      }
      
      currentMedicalEvents.push({ year, month, event });
      monthInput.value = '';
      eventInput.value = '';
      yearInput.value = '';
      renderFormMedicalEventsList();
    };
  }

  if (animal) {
    titleEl.textContent = 'Modifier l\'Animal';
    idInput.value = animal.id;
    document.getElementById('animal-form-name').value = animal.nom;
    ownerSelect.value = animal.client_id;
    const speciesSelect = document.getElementById('animal-form-species');
    const speciesOther = document.getElementById('animal-form-species-other');
    const speciesVal = animal.espece || 'Cheval';
    if (['Cheval', 'Chien', 'Chat'].includes(speciesVal)) {
      speciesSelect.value = speciesVal;
      speciesOther.style.display = 'none';
      speciesOther.value = '';
    } else {
      speciesSelect.value = 'Autre';
      speciesOther.style.display = 'block';
      speciesOther.value = speciesVal;
    }
    document.getElementById('animal-form-breed').value = animal.race || '';
    document.getElementById('animal-form-robe').value = animal.robe || '';
    let sexValue = animal.sexe || 'Inconnu';
    if (sexValue === 'Mâle castré') sexValue = 'Mâle castré (Hongre)';
    if (sexValue === 'Femelle') sexValue = 'Femelle (Jument)';
    if (sexValue === 'Mâle') sexValue = 'Mâle entier';
    document.getElementById('animal-form-sex').value = sexValue;
    let birthdateVal = '';
    let ageEstVal = '';
    if (animal.date_naissance_ou_age) {
      const birthDate = new Date(animal.date_naissance_ou_age);
      if (!isNaN(birthDate.getTime())) {
        birthdateVal = animal.date_naissance_ou_age;
        const today = new Date();
        const years = today.getFullYear() - birthDate.getFullYear();
        ageEstVal = years >= 0 ? years : '';
      } else {
        const match = animal.date_naissance_ou_age.match(/\b\d+\b/);
        if (match) {
          ageEstVal = parseInt(match[0], 10);
          const currentYear = new Date().getFullYear();
          birthdateVal = `${currentYear - ageEstVal}-01-01`;
        }
      }
    }
    document.getElementById('animal-form-birthdate').value = birthdateVal;
    document.getElementById('animal-form-age-estimation').value = ageEstVal;
    
    // Photo load
    if (animal.photo_data_url) {
      photoDataInput.value = animal.photo_data_url;
      previewImg.src = animal.photo_data_url;
      previewImg.style.display = 'block';
      placeholder.style.display = 'none';
    } else {
      photoDataInput.value = '';
      previewImg.src = '';
      previewImg.style.display = 'none';
      placeholder.style.display = 'block';
    }

    // New location fields
    let stableName = animal.stable_name || '';
    let stableAddress = animal.stable_address || '';
    let stableZip = animal.stable_zip || '';
    let stableCity = animal.stable_city || '';
    let stableDistance = animal.stable_distance || '';

    // Fallback: if stable_address has content but zip and city are empty, try parsing
    if (stableAddress && !stableZip && !stableCity) {
      const parsed = parseAddress(stableAddress);
      stableAddress = parsed.address;
      stableZip = parsed.zip;
      stableCity = parsed.city;
    }
    // Fallback: if stableName is empty but lieu_de_vie is set, use it as fallback
    if (!stableName && animal.lieu_de_vie && animal.lieu_de_vie !== 'Non spécifié') {
      stableName = animal.lieu_de_vie;
      const parsed = parseAddress(animal.lieu_de_vie);
      if (!stableAddress) stableAddress = parsed.address;
      if (!stableZip) stableZip = parsed.zip;
      if (!stableCity) stableCity = parsed.city;
    }

    const atHome = !!animal.stable_at_home || stableName === 'Domicile';
    document.getElementById('animal-form-stable-at-home').checked = atHome;
    toggleLocationFields();

    document.getElementById('animal-form-stable-name').value = stableName;
    document.getElementById('animal-form-stable-address').value = stableAddress;
    document.getElementById('animal-form-stable-zip').value = stableZip;
    document.getElementById('animal-form-stable-city').value = stableCity;
    document.getElementById('animal-form-stable-distance').value = stableDistance;

    // Housing & tracking
    const hType = animal.housing_type || animal.housing_mode || 'Pré';
    document.getElementById('animal-form-housing-type').value = hType;
    const hTypeOther = document.getElementById('animal-form-housing-type-other');
    hTypeOther.value = animal.housing_type_other || animal.housing_mode_other || '';
    hTypeOther.style.display = hType === 'Autre' ? 'block' : 'none';

    document.getElementById('animal-form-social-type').value = animal.social_type || 'Individuel';
    
    trackingSelect.value = animal.tracking_mode || 'À la demande';
    trackingOther.value = animal.tracking_mode_other || '';
    trackingOther.style.display = animal.tracking_mode === 'Autre' ? 'block' : 'none';

    // Nutrition
    document.getElementById('animal-form-nutritionist').checked = !!animal.nutritionist;
    document.getElementById('animal-form-nutrition-details').value = animal.nutrition_details || '';

    // Work & problems
    document.getElementById('animal-form-work-objective').value = animal.work_objective || '';
    document.getElementById('animal-form-lifestyle-details').value = animal.lifestyle_details || '';
    document.getElementById('animal-form-main-problems').value = animal.main_problems || '';
    updateSpeciesFields();

    // Medical events
    currentMedicalEvents = animal.medical_events ? [...animal.medical_events] : [];
    renderFormMedicalEventsList();
  } else {
    titleEl.textContent = 'Nouvel Animal';
    idInput.value = '';
    
    // Reset photo
    photoDataInput.value = '';
    previewImg.src = '';
    previewImg.style.display = 'none';
    placeholder.style.display = 'block';

    // Reset location fields
    document.getElementById('animal-form-stable-at-home').checked = false;
    toggleLocationFields();
    document.getElementById('animal-form-stable-name').value = '';
    document.getElementById('animal-form-stable-address').value = '';
    document.getElementById('animal-form-stable-zip').value = '';
    document.getElementById('animal-form-stable-city').value = '';
    document.getElementById('animal-form-stable-distance').value = '';

    // Reset date fields
    document.getElementById('animal-form-birthdate').value = '';
    document.getElementById('animal-form-age-estimation').value = '';

    // Reset selects
    document.getElementById('animal-form-species').value = 'Cheval';
    document.getElementById('animal-form-species-other').value = '';
    document.getElementById('animal-form-species-other').style.display = 'none';

    document.getElementById('animal-form-housing-type').value = 'Pré';
    const hTypeOther = document.getElementById('animal-form-housing-type-other');
    hTypeOther.value = '';
    hTypeOther.style.display = 'none';

    document.getElementById('animal-form-social-type').value = 'Individuel';
    
    trackingSelect.value = 'À la demande';
    trackingOther.value = '';
    trackingOther.style.display = 'none';

    // Reset nutrition
    document.getElementById('animal-form-nutritionist').checked = false;
    document.getElementById('animal-form-nutrition-details').value = '';

    // Reset work & problems
    document.getElementById('animal-form-work-objective').value = '';
    document.getElementById('animal-form-lifestyle-details').value = '';
    document.getElementById('animal-form-main-problems').value = '';
    updateSpeciesFields();

    // Reset medical events
    currentMedicalEvents = [];
    renderFormMedicalEventsList();

    if (preselectedClientId) {
      ownerSelect.value = preselectedClientId;
    }
  }

  // Cancel buttons
  const cancelBtns = dialog.querySelectorAll('.btn-cancel-dialog, .btn-close-dialog');
  cancelBtns.forEach(btn => {
    btn.onclick = () => dialog.close();
  });

  // Submit form
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    const ownerId = Number(ownerSelect.value) || (animal && animal.client_id ? Number(animal.client_id) : (preselectedClientId ? Number(preselectedClientId) : (currentPortalClientId ? Number(currentPortalClientId) : null)));
    
    // Déterminer la date de naissance (avec calcul automatique si âge estimé est fourni)
    let birthdateStr = document.getElementById('animal-form-birthdate').value;
    const estAgeVal = document.getElementById('animal-form-age-estimation').value.trim();
    
    if (!birthdateStr && estAgeVal) {
      const ageX = parseInt(estAgeVal, 10);
      if (!isNaN(ageX)) {
        const currentYear = new Date().getFullYear();
        const birthYear = currentYear - ageX;
        birthdateStr = `${birthYear}-01-01`;
      }
    }

    let stableName = '';
    let stableAddress = '';
    let stableZip = '';
    let stableCity = '';
    let stableDistance = 0;
    const stableAtHome = document.getElementById('animal-form-stable-at-home').checked;

    if (stableAtHome) {
      stableName = 'Domicile';
      stableDistance = 0;
      const ownerObj = clients.find(c => c.id === ownerId);
      if (ownerObj && ownerObj.adresse) {
        const parsed = parseAddress(ownerObj.adresse);
        stableAddress = parsed.address;
        stableZip = parsed.zip;
        stableCity = parsed.city;
      }
    } else {
      stableName = document.getElementById('animal-form-stable-name').value.trim();
      stableAddress = document.getElementById('animal-form-stable-address').value.trim();
      stableZip = document.getElementById('animal-form-stable-zip').value.trim();
      stableCity = document.getElementById('animal-form-stable-city').value.trim();
      stableDistance = parseFloat(document.getElementById('animal-form-stable-distance').value) || 0;

      // À l'inverse, si une adresse déjà associée à une écurie connue est saisie, associer/remplir automatiquement le nom de l'écurie
      if (!stableName && stableAddress && stableZip && stableCity) {
        const match = knownStables.find(s => 
          s.address.toLowerCase() === stableAddress.toLowerCase() &&
          s.zip.toLowerCase() === stableZip.toLowerCase() &&
          s.city.toLowerCase() === stableCity.toLowerCase()
        );
        if (match) {
          stableName = match.name;
          document.getElementById('animal-form-stable-name').value = stableName;
          if (!stableDistance && match.distance) {
            stableDistance = match.distance;
            document.getElementById('animal-form-stable-distance').value = stableDistance;
          }
        }
      }
    }

    const animalData = {
      ...(animal || {}),
      client_id: ownerId,
      nom: document.getElementById('animal-form-name').value.trim(),
      espece: (() => {
        const val = document.getElementById('animal-form-species').value;
        if (val === 'Autre') {
          return document.getElementById('animal-form-species-other').value.trim() || 'Autre';
        }
        return val;
      })(),
      race: document.getElementById('animal-form-breed').value.trim(),
      robe: document.getElementById('animal-form-robe').value.trim(),
      sexe: document.getElementById('animal-form-sex').value,
      date_naissance_ou_age: birthdateStr,
      
      // New pension/location fields
      stable_name: stableName,
      stable_address: stableAddress,
      stable_zip: stableZip,
      stable_city: stableCity,
      stable_distance: stableDistance,
      stable_at_home: stableAtHome,
      
      // Housing & tracking
      housing_type: document.getElementById('animal-form-housing-type').value,
      housing_type_other: document.getElementById('animal-form-housing-type-other').value.trim(),
      social_type: document.getElementById('animal-form-social-type').value,
      tracking_mode: document.getElementById('animal-form-tracking-mode').value,
      tracking_mode_other: document.getElementById('animal-form-tracking-mode-other').value.trim(),
      
      // Fallback fields for backwards compatibility
      housing_mode: document.getElementById('animal-form-housing-type').value,
      housing_mode_other: document.getElementById('animal-form-housing-type-other').value.trim(),
      
      // Nutrition
      nutritionist: document.getElementById('animal-form-nutritionist').checked,
      nutrition_details: document.getElementById('animal-form-nutrition-details').value.trim(),
      
      // Work & problems
      work_objective: document.getElementById('animal-form-work-objective').value.trim(),
      lifestyle_details: document.getElementById('animal-form-lifestyle-details').value.trim(),
      main_problems: document.getElementById('animal-form-main-problems').value.trim(),
      
      // Medical events & Photo
      medical_events: currentMedicalEvents,
      photo_data_url: document.getElementById('animal-form-photo-data').value || (animal ? animal.photo_data_url : ''),
      photo_blob: document.getElementById('animal-form-photo-data').value || (animal ? animal.photo_blob : null),
      
      // Fallback fields for backwards compatibility
      lieu_de_vie: stableName || 'Non spécifié',
      antecedents: currentMedicalEvents.map(ev => `${ev.year}${ev.month ? ' - ' + ev.month : ''} : ${ev.event}`).join(', '),
      
      pros_associes_ids: animal ? (animal.pros_associes_ids || []) : []
    };

    if (idInput.value) {
      animalData.id = Number(idInput.value);
      await update('animals', animalData);
      showToast('Animal modifié.');
    } else {
      await add('animals', animalData);
      showToast('Animal enregistré.');
    }

    dialog.close();

    // Recharger les vues appropriées
    if (window.location.hash.startsWith('#animals/') || window.location.hash.includes('/animals/')) {
      await renderAnimalDetails(currentAnimalId || animalData.id);
    } else if (currentPortalClientId) {
      await renderPortalDetails(currentPortalClientToken || currentPortalClientId);
    } else if (window.location.hash.startsWith('#clients/')) {
      await renderClientDetails(currentClientId || ownerId);
    } else {
      await renderAnimalsList();
    }
    
    await renderDashboard();
  };

  dialog.showModal();
}

async function openProfessionalDialog(prof = null) {
  const dialog = document.getElementById('dialog-professional');
  const form = document.getElementById('dialog-professional-form');
  form.reset();
  populateSpecialtyDropdown();

  const titleEl = document.getElementById('dialog-professional-title');
  const idInput = document.getElementById('dialog-professional-id');
  const specialtySelect = document.getElementById('prof-form-specialty');
  const specialtyOther = document.getElementById('prof-form-specialty-other');
  
  const toggleSpecialtyOther = () => {
    specialtyOther.style.display = specialtySelect.value === 'Autre' ? 'block' : 'none';
  };
  
  if (specialtySelect) {
    specialtySelect.onchange = toggleSpecialtyOther;
  }

  // Fetch all animals and determine currently associated ones
  const animals = await getAll('animals');
  const currentlyAssocAnimals = prof ? animals.filter(an => (an.pros_associes_ids || []).includes(prof.id)).map(an => an.id) : [];
  let checkedAnimalIds = [...currentlyAssocAnimals];

  const animalSearchInput = document.getElementById('prof-form-animal-search');
  const animalsListContainer = document.getElementById('prof-form-animals-list');

  if (animalSearchInput) {
    animalSearchInput.value = '';
  }

  const renderFormAnimals = () => {
    const checkboxes = animalsListContainer.querySelectorAll('.prof-animal-checkbox');
    checkboxes.forEach(cb => {
      const id = Number(cb.value);
      if (cb.checked) {
        if (!checkedAnimalIds.includes(id)) checkedAnimalIds.push(id);
      } else {
        checkedAnimalIds = checkedAnimalIds.filter(x => x !== id);
      }
    });

    animalsListContainer.innerHTML = '';
    const filter = animalSearchInput ? animalSearchInput.value.toLowerCase().trim() : '';

    const filteredAnimals = animals.filter(an => {
      if (!filter) return true;
      const term = normalizeText(filter);
      return normalizeText(an.nom).includes(term) || normalizeText(an.espece).includes(term);
    });

    if (filteredAnimals.length === 0) {
      animalsListContainer.innerHTML = '<p class="empty-state" style="margin: 5px 0;">Aucun animal correspondant.</p>';
    } else {
      filteredAnimals.forEach(an => {
        const isChecked = checkedAnimalIds.includes(an.id);
        const row = document.createElement('div');
        row.className = 'checkbox-item';
        row.style.margin = '4px 0';
        
        const emojiMap = {
          'cheval': '🐴',
          'chien': '🐕',
          'chat': '🐱'
        };
        const emoji = emojiMap[an.espece.toLowerCase()] || '🐾';

        row.innerHTML = `
          <label style="cursor:pointer; display:flex; align-items:center; gap:10px;">
            <input type="checkbox" class="prof-animal-checkbox" value="${an.id}" ${isChecked ? 'checked' : ''}>
            <span>${emoji} <strong>${an.nom}</strong> (${an.espece})</span>
          </label>
        `;
        animalsListContainer.appendChild(row);
      });
    }
  };

  if (animalSearchInput) {
    animalSearchInput.oninput = renderFormAnimals;
  }

  renderFormAnimals();

  if (prof) {
    titleEl.textContent = 'Modifier le Professionnel';
    idInput.value = prof.id;
    document.getElementById('prof-form-lastname').value = prof.nom;
    document.getElementById('prof-form-firstname').value = prof.prenom;
    
    const specVal = prof.specialite || 'Ostéopathe';
    const standardSpecs = getAllSpecialties();
    if (standardSpecs.includes(specVal)) {
      specialtySelect.value = specVal;
      specialtyOther.value = '';
      specialtyOther.style.display = 'none';
    } else {
      specialtySelect.value = 'Autre';
      specialtyOther.value = specVal;
      specialtyOther.style.display = 'block';
    }

    document.getElementById('prof-form-phone').value = prof.telephone || '';
    document.getElementById('prof-form-notes').value = prof.notes || '';
  } else {
    titleEl.textContent = 'Nouveau Professionnel';
    idInput.value = '';
    if (specialtySelect) {
      specialtySelect.value = 'Ostéopathe';
    }
    if (specialtyOther) {
      specialtyOther.value = '';
      specialtyOther.style.display = 'none';
    }
  }

  // Cancel buttons
  const cancelBtns = dialog.querySelectorAll('.btn-cancel-dialog, .btn-close-dialog');
  cancelBtns.forEach(btn => {
    btn.onclick = () => dialog.close();
  });

  // Submit form
  form.onsubmit = async (e) => {
    e.preventDefault();
    
    const spec = (() => {
      const val = specialtySelect.value;
      if (val === 'Autre') {
        return specialtyOther.value.trim() || 'Autre';
      }
      return val;
    })();

    if (specialtySelect.value === 'Autre') {
      saveCustomSpecialty(spec);
      populateSpecialtyDropdown();
    }

    const profData = {
      nom: document.getElementById('prof-form-lastname').value.trim(),
      prenom: document.getElementById('prof-form-firstname').value.trim(),
      specialite: spec,
      telephone: document.getElementById('prof-form-phone').value.trim(),
      notes: document.getElementById('prof-form-notes').value.trim()
    };

    let profId;
    if (idInput.value) {
      profId = Number(idInput.value);
      profData.id = profId;
      await update('professionals', profData);
      showToast('Professionnel modifié.');
    } else {
      profId = await add('professionals', profData);
      showToast('Professionnel enregistré.');
    }

    // Sync animal selections once more before saving
    const checkboxes = animalsListContainer.querySelectorAll('.prof-animal-checkbox');
    checkboxes.forEach(cb => {
      const id = Number(cb.value);
      if (cb.checked) {
        if (!checkedAnimalIds.includes(id)) checkedAnimalIds.push(id);
      } else {
        checkedAnimalIds = checkedAnimalIds.filter(x => x !== id);
      }
    });

    // Update animals table in IndexedDB
    for (const an of animals) {
      let pros = an.pros_associes_ids || [];
      const hasProf = pros.includes(profId);
      const shouldHaveProf = checkedAnimalIds.includes(an.id);

      if (shouldHaveProf && !hasProf) {
        pros.push(profId);
        an.pros_associes_ids = pros;
        await update('animals', an);
      } else if (!shouldHaveProf && hasProf) {
        pros = pros.filter(id => id !== profId);
        an.pros_associes_ids = pros;
        await update('animals', an);
      }
    }

    dialog.close();
    await renderProfessionalsList();
  };

  dialog.showModal();
}

// 3B. DIALOG RAPPEL / TÂCHE (AJOUTER / MODIFIER)
async function openReminderDialog(reminder = null, preselectedAnimalId = null) {
  const dialog = document.getElementById('dialog-reminder');
  const form = document.getElementById('dialog-reminder-form');
  form.reset();

  const titleEl = document.getElementById('dialog-reminder-title');
  const idInput = document.getElementById('dialog-reminder-id');
  const animalSelect = document.getElementById('reminder-form-animal');
  const clientSelect = document.getElementById('reminder-form-client');

  // Populate animal select
  const animals = await getAll('animals');
  animalSelect.innerHTML = '<option value="">-- Aucun animal --</option>';
  animals.forEach(an => {
    const opt = document.createElement('option');
    opt.value = an.id;
    opt.textContent = an.nom;
    animalSelect.appendChild(opt);
  });

  // Populate client select
  const clients = await getAll('clients');
  clientSelect.innerHTML = '<option value="">-- Aucun client --</option>';
  clients.forEach(cl => {
    const opt = document.createElement('option');
    opt.value = cl.id;
    opt.textContent = `${cl.prenom} ${cl.nom.toUpperCase()}`;
    clientSelect.appendChild(opt);
  });

  // Link client select to animal select choice
  animalSelect.onchange = () => {
    const animId = Number(animalSelect.value);
    if (animId) {
      const anim = animals.find(a => a.id === animId);
      if (anim && anim.client_id) {
        clientSelect.value = anim.client_id;
      }
    }
  };

  // Pre-fill fields if editing
  if (reminder) {
    titleEl.textContent = 'Modifier / Reporter la tâche';
    idInput.value = reminder.id;
    document.getElementById('reminder-form-title').value = reminder.type_rappel || '';
    if (reminder.animal_id) {
      animalSelect.value = reminder.animal_id;
    }
    if (reminder.client_id) {
      clientSelect.value = reminder.client_id;
    }
    document.getElementById('reminder-form-date').value = reminder.date_prevue || '';
    document.getElementById('reminder-form-notes').value = reminder.notes || '';
    
    animalSelect.disabled = false;
    clientSelect.disabled = false;
  } else {
    titleEl.textContent = 'Nouveau rappel / tâche';
    idInput.value = '';
    
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('reminder-form-date').value = today;

    if (preselectedAnimalId) {
      animalSelect.value = preselectedAnimalId;
      animalSelect.disabled = true;
      const anim = animals.find(a => a.id === preselectedAnimalId);
      if (anim && anim.client_id) {
        clientSelect.value = anim.client_id;
        clientSelect.disabled = true;
      }
    } else {
      animalSelect.disabled = false;
      clientSelect.disabled = false;
    }
  }

  // Cancel buttons
  const cancelBtns = dialog.querySelectorAll('.btn-cancel-dialog, .btn-close-dialog');
  cancelBtns.forEach(btn => {
    btn.onclick = () => dialog.close();
  });

  // Submit form
  form.onsubmit = async (e) => {
    e.preventDefault();

    const titleVal = document.getElementById('reminder-form-title').value.trim();
    const animalId = animalSelect.value ? Number(animalSelect.value) : null;
    const clientId = clientSelect.value ? Number(clientSelect.value) : null;
    const dateVal = document.getElementById('reminder-form-date').value;
    const notesVal = document.getElementById('reminder-form-notes').value.trim();
    const weekStr = getYearWeek(new Date(dateVal));

    const reminderData = {
      type_rappel: titleVal,
      animal_id: animalId,
      client_id: clientId,
      date_prevue: dateVal,
      semaine_prevue: weekStr,
      notes: notesVal,
      statut: reminder ? (reminder.statut || 'en_attente') : 'en_attente'
    };

    if (idInput.value) {
      reminderData.id = Number(idInput.value);
      await update('reminders', reminderData);
      showToast('Rappel modifié.');
    } else {
      await add('reminders', reminderData);
      showToast('Rappel enregistré.');
    }

    dialog.close();
    await renderRemindersList();

    const hash = window.location.hash;
    if (hash.includes('animals/')) {
      const parts = hash.split('/');
      const currentAnimalId = Number(parts[parts.length - 1]);
      if (currentAnimalId) {
        await renderAnimalDetails(currentAnimalId);
      }
    }
  };

  dialog.showModal();
}

// 4. DIALOG ASSOCIER PROFESSIONNELS A UN ANIMAL
async function openAssociateProfsDialog(animal) {
  const dialog = document.getElementById('dialog-associate-professionals');
  const listContainer = document.getElementById('associate-profs-list-container');
  const searchInput = document.getElementById('associate-profs-search');
  
  if (searchInput) {
    searchInput.value = '';
  }

  listContainer.innerHTML = '';

  let professionals = await getAll('professionals');
  const currentlyAssoc = animal.pros_associes_ids || [];
  let checkedIds = [...currentlyAssoc];

  const renderList = () => {
    // Sync current checkboxes before rebuilding the list
    const checkboxes = listContainer.querySelectorAll('.prof-assoc-checkbox');
    checkboxes.forEach(cb => {
      const id = Number(cb.value);
      if (cb.checked) {
        if (!checkedIds.includes(id)) checkedIds.push(id);
      } else {
        checkedIds = checkedIds.filter(x => x !== id);
      }
    });

    listContainer.innerHTML = '';
    const filter = searchInput ? searchInput.value.toLowerCase().trim() : '';

    const filteredProfs = professionals.filter(p => {
      if (!filter) return true;
      const term = normalizeText(filter);
      return normalizeText(p.nom).includes(term) ||
             normalizeText(p.prenom).includes(term) ||
             normalizeText(p.specialite).includes(term);
    });

    if (filteredProfs.length === 0) {
      listContainer.innerHTML = '<p class="empty-state" style="margin: 10px 0;">Aucun professionnel correspondant.</p>';
    } else {
      filteredProfs.forEach(p => {
        const isChecked = checkedIds.includes(p.id);
        const row = document.createElement('div');
        row.className = 'checkbox-item';
        row.style.margin = '10px 0';
        row.innerHTML = `
          <label style="cursor:pointer; display:flex; align-items:center; gap:10px;">
            <input type="checkbox" class="prof-assoc-checkbox" value="${p.id}" ${isChecked ? 'checked' : ''}>
            <span><strong>${p.prenom} ${p.nom}</strong> (${p.specialite})</span>
          </label>
        `;
        listContainer.appendChild(row);
      });
    }
  };

  if (searchInput) {
    searchInput.oninput = renderList;
  }

  // Quick professional creation dialog hook
  const createProfBtn = document.getElementById('btn-create-prof-quick');
  if (createProfBtn) {
    createProfBtn.onclick = () => {
      openProfessionalDialog();
      const profForm = document.getElementById('dialog-professional-form');
      if (profForm) {
        const originalSubmit = profForm.onsubmit;
        profForm.onsubmit = async (e) => {
          if (originalSubmit) {
            await originalSubmit(e);
          }
          professionals = await getAll('professionals');
          
          if (professionals.length > 0) {
            const lastPro = professionals.reduce((max, p) => p.id > max.id ? p : max, professionals[0]);
            if (lastPro && lastPro.id) {
              if (!checkedIds.includes(lastPro.id)) {
                checkedIds.push(lastPro.id);
              }
            }
          }
          
          renderList();
        };
      }
    };
  }

  renderList();

  // Cancel buttons
  const cancelBtns = dialog.querySelectorAll('.btn-cancel-dialog, .btn-close-dialog');
  cancelBtns.forEach(btn => {
    btn.onclick = () => dialog.close();
  });

  // Action enregistrer
  document.getElementById('btn-save-associations').onclick = async () => {
    const checkboxes = listContainer.querySelectorAll('.prof-assoc-checkbox');
    checkboxes.forEach(cb => {
      const id = Number(cb.value);
      if (cb.checked) {
        if (!checkedIds.includes(id)) checkedIds.push(id);
      } else {
        checkedIds = checkedIds.filter(x => x !== id);
      }
    });

    animal.pros_associes_ids = checkedIds;
    await update('animals', animal);
    showToast('Professionnels associés mis à jour.');
    dialog.close();

    // Recharger la fiche animal
    await renderAnimalDetails(animal.id);
  };

  dialog.showModal();
}

// 5. DIALOG AJOUTER UN EVÉNEMENT MÉDICAL DIRECT
function openMedicalEventDialog(animal) {
  const dialog = document.getElementById('dialog-medical-event');
  const form = document.getElementById('dialog-medical-event-form');
  form.reset();

  const yearInput = document.getElementById('med-event-form-year');
  const monthSelect = document.getElementById('med-event-form-month');
  const textInput = document.getElementById('med-event-form-text');

  // Default year to current year
  const currentYear = new Date().getFullYear();
  yearInput.value = currentYear;

  // Cancel buttons
  const cancelBtns = dialog.querySelectorAll('.btn-cancel-dialog, .btn-close-dialog');
  cancelBtns.forEach(btn => {
    btn.onclick = () => dialog.close();
  });

  // Submit form
  form.onsubmit = async (e) => {
    e.preventDefault();

    const yearVal = yearInput.value.trim();
    const monthVal = monthSelect.value;
    const textVal = textInput.value.trim();

    if (!yearVal || !textVal) {
      showToast('L\'année et la pathologie sont requises.');
      return;
    }

    const newEvent = {
      year: yearVal,
      month: monthVal || '',
      event: textVal
    };

    if (!animal.medical_events) {
      animal.medical_events = [];
    }
    animal.medical_events.push(newEvent);

    await update('animals', animal);
    showToast('Événement médical enregistré.');
    dialog.close();

    await renderAnimalDetails(animal.id);
  };

  dialog.showModal();
}

// Clics boutons rapides du Dashboard
const quickClientBtn = document.getElementById('btn-quick-new-client');
if (quickClientBtn) quickClientBtn.onclick = () => openClientDialog();

const quickAnimalBtn = document.getElementById('btn-quick-new-animal');
if (quickAnimalBtn) quickAnimalBtn.onclick = () => openAnimalDialog();

const quickSessionBtn = document.getElementById('btn-quick-new-session');
if (quickSessionBtn) {
  quickSessionBtn.onclick = () => { window.location.hash = 'session-editor'; };
}

// Clics boutons d'ajouts de listes globales
const addClientBtn = document.getElementById('btn-add-client');
if (addClientBtn) addClientBtn.onclick = () => openClientDialog();

const addAnimalBtn = document.getElementById('btn-add-animal');
if (addAnimalBtn) addAnimalBtn.onclick = () => openAnimalDialog();

const addSessionBtn = document.getElementById('btn-add-session');
if (addSessionBtn) {
  addSessionBtn.onclick = () => { window.location.hash = 'session-editor'; };
}

const addProfBtn = document.getElementById('btn-add-professional');
if (addProfBtn) addProfBtn.onclick = () => openProfessionalDialog();

const addReminderBtn = document.getElementById('btn-add-reminder');
if (addReminderBtn) addReminderBtn.onclick = () => openReminderDialog();

// --- UTILITAIRES DE LOCALISATION ---
const DEPARTEMENTS = {
  "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes",
  "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube",
  "11": "Aude", "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal",
  "16": "Charente", "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud",
  "2B": "Haute-Corse", "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne",
  "25": "Doubs", "26": "Drôme", "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère",
  "30": "Gard", "31": "Haute-Garonne", "32": "Gers", "33": "Gironde", "34": "Hérault",
  "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire", "38": "Isère", "39": "Jura",
  "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire", "44": "Loire-Atlantique",
  "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère", "49": "Maine-et-Loire",
  "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle",
  "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord",
  "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques",
  "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône",
  "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie",
  "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres",
  "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse",
  "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne",
  "90": "Territoire de Belfort", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne",
  "95": "Val-d'Oise", "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte"
};

// --- UTILS PROFESSIONNELS : SPÉCIALITÉS ---
const DEFAULT_SPECIALTIES = [
  "Ostéopathe", "Masseur", "Maréchal", "Podologue", "Dentiste",
  "Nutritionniste", "Naturopathe", "Nutri + Naturo", "Vétérinaire",
  "Coach", "Comportementaliste", "Saddle Fitter"
];

function getCustomSpecialties() {
  try {
    const list = localStorage.getItem('custom_specialties');
    return list ? JSON.parse(list) : [];
  } catch (e) {
    return [];
  }
}

function saveCustomSpecialty(spec) {
  if (!spec) return;
  const normalized = spec.trim();
  if (!normalized) return;
  if (DEFAULT_SPECIALTIES.includes(normalized)) return;
  
  const customs = getCustomSpecialties();
  if (!customs.includes(normalized)) {
    customs.push(normalized);
    localStorage.setItem('custom_specialties', JSON.stringify(customs));
  }
}

function getAllSpecialties() {
  const customs = getCustomSpecialties();
  return [...DEFAULT_SPECIALTIES, ...customs];
}

function populateSpecialtyDropdown() {
  const select = document.getElementById('prof-form-specialty');
  if (!select) return;
  
  const currentVal = select.value;
  select.innerHTML = '';
  
  const allSpecs = getAllSpecialties();
  allSpecs.forEach(spec => {
    const opt = document.createElement('option');
    opt.value = spec;
    opt.textContent = spec;
    select.appendChild(opt);
  });
  
  const optOther = document.createElement('option');
  optOther.value = 'Autre';
  optOther.textContent = 'Autre';
  select.appendChild(optOther);
  
  if (currentVal && (allSpecs.includes(currentVal) || currentVal === 'Autre')) {
    select.value = currentVal;
  }
}

function normalizeText(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getAnimalLocationSummary(an) {
  if (!an) return 'Lieu non spécifié';
  const name = (an.stableName || an.structure || an.ecurie || an.pension || an.stable_name || '').trim();
  const zip = (an.stableZip || an.codePostal || an.stable_zip || '').trim();
  const city = (an.stableCity || an.ville || an.stable_city || '').trim();
  const isAtHome = !!(an.isAtOwnerHome || an.atDomicile || an.stable_at_home);
  
  const cpVille = `${zip} ${city}`.trim();
  if (name) {
    return cpVille ? `${name} - ${cpVille}` : name;
  } else if (isAtHome) {
    return cpVille ? `Domicile - ${cpVille}` : 'Domicile';
  } else {
    return cpVille || 'Lieu non spécifié';
  }
}

function parseAddress(fullAddress) {
  if (!fullAddress) return { address: '', zip: '', city: '' };
  const zipMatch = fullAddress.match(/\b\d{5}\b/);
  if (zipMatch) {
    const zip = zipMatch[0];
    const zipIndex = fullAddress.indexOf(zip);
    const address = fullAddress.substring(0, zipIndex).replace(/,\s*$/, '').trim();
    const city = fullAddress.substring(zipIndex + 5).replace(/^\s*,\s*/, '').trim();
    return { address, zip, city };
  }
  return { address: fullAddress, zip: '', city: '' };
}

function getDepartmentDisplay(zipCode) {
  if (!zipCode) return "Département non spécifié";
  const cleanZip = zipCode.trim().replace(/\s/g, '');
  if (/^\d{5}$/.test(cleanZip) || /^\d{2}\s*\d{3}$/.test(cleanZip) || /^\d{2,3}/.test(cleanZip)) {
    const first3 = cleanZip.substring(0, 3);
    if (DEPARTEMENTS[first3]) {
      return `${first3} - ${DEPARTEMENTS[first3]}`;
    }
    const first2 = cleanZip.substring(0, 2);
    if (DEPARTEMENTS[first2]) {
      return `${first2} - ${DEPARTEMENTS[first2]}`;
    }
  }
  return "Département non spécifié";
}

// --- LOGIQUE DE SYNCHRONISATION HYBRIDE (OFFLINE-FIRST) ---
let isSyncing = false;

function updateSyncStatusUI(status) {
  const container = document.getElementById('sync-status-container');
  if (!container) return;
  
  let html = '';
  switch (status) {
    case 'online':
      html = `
        <div class="sync-status-badge status-online" title="Données synchronisées avec Supabase">
          <span class="sync-dot"></span>
          <span>En ligne / Synchronisé</span>
        </div>
      `;
      break;
    case 'offline':
      html = `
        <div class="sync-status-badge status-offline" title="Mode hors-ligne. Modifications stockées localement.">
          <span class="sync-dot"></span>
          <span>Hors-ligne - Données locales</span>
        </div>
      `;
      break;
    case 'syncing':
      html = `
        <div class="sync-status-badge status-syncing" title="Synchronisation avec Supabase en cours...">
          <span class="sync-icon-spin"></span>
          <span>Synchronisation...</span>
        </div>
      `;
      break;
  }
  container.innerHTML = html;
}

async function refreshCurrentView() {
  const hash = window.location.hash.substring(1) || 'dashboard';
  let routeBase = hash;
  let routeParam = null;
  if (hash.includes('/')) {
    const parts = hash.split('/');
    routeBase = parts[0];
    routeParam = parts[1];
  }
  await loadViewData(routeBase, routeParam);
}

async function syncData() {
  if (isSyncing) return;
  if (!navigator.onLine) {
    updateSyncStatusUI('offline');
    return;
  }
  if (!isPractitionerUnlocked() && !currentPortalClientId) {
    // Bloquer la synchronisation globale tant que l'espace praticien est verrouillé
    return;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    updateSyncStatusUI('offline');
    return;
  }

  isSyncing = true;
  updateSyncStatusUI('syncing');

  try {
    // 0. RECONCILE CLIENT UUIDS WITH SUPABASE
    await reconcileClientUUIDsFromSupabase();

    // 1. PUSH PENDING DELETIONS
    const deletions = await getTrackedDeletions();
    for (const del of deletions) {
      const table = del.storeName === 'reminders' ? 'tasks' : del.storeName;
      try {
        const { error } = await supabase.from(table).delete().eq('id', String(del.recordId));
        if (!error) {
          await clearTrackedDeletion(del.id);
        } else {
          console.error("Erreur sync:", table, error.message || error);
        }
      } catch (err) {
        console.error("Erreur sync:", table, err.message || err);
      }
    }

    // 2. PUSH UNSYNCED LOCAL MODIFICATIONS
    for (const storeName of SYNCED_STORES) {
      const table = storeName === 'reminders' ? 'tasks' : storeName;
      const localRecords = await getAll(storeName);
      const unsynced = localRecords.filter(r => r.synced === 0);
      for (const record of unsynced) {
        try {
          const mapped = mapLocalToSupabase(storeName, record);
          const { error } = await supabase.from(table).upsert(mapped);
          if (!error) {
            record.synced = 1;
            await updateLocal(storeName, record);
          } else {
            console.error("Erreur sync:", table, error.message || error);
          }
        } catch (err) {
          console.error("Erreur sync:", table, err.message || err);
        }
      }
    }

    // 3. PULL REMOTE MODIFICATIONS
    for (const storeName of SYNCED_STORES) {
      const table = storeName === 'reminders' ? 'tasks' : storeName;
      try {
        const { data: remoteRecords, error } = await supabase.from(table).select('*');
        if (error) {
          console.error("Erreur sync:", table, error.message || error);
          continue;
        }

        if (remoteRecords) {
          const mappedRemoteRecords = remoteRecords.map(r => mapSupabaseToLocal(storeName, r));
          const remoteIds = new Set(mappedRemoteRecords.map(r => r.id));

          // A. Mettre à jour ou insérer les enregistrements distants localement
          for (const remoteRec of mappedRemoteRecords) {
            const localRec = await getById(storeName, remoteRec.id);
            if (!localRec) {
              remoteRec.synced = 1;
              await updateLocal(storeName, remoteRec);
            } else {
              const localTime = new Date(localRec.last_modified || 0).getTime();
              const remoteTime = new Date(remoteRec.last_modified || 0).getTime();
              if (remoteTime > localTime) {
                remoteRec.synced = 1;
                await updateLocal(storeName, remoteRec);
              } else if (localRec.synced === 0) {
                try {
                  const mappedLocal = mapLocalToSupabase(storeName, localRec);
                  const { error: upsertErr } = await supabase.from(table).upsert(mappedLocal);
                  if (!upsertErr) {
                    localRec.synced = 1;
                    await updateLocal(storeName, localRec);
                  } else {
                    console.error("Erreur sync:", table, upsertErr.message || upsertErr);
                  }
                } catch (err) {
                  console.error("Erreur sync:", table, err.message || err);
                }
              }
            }
          }

          // B. Supprimer localement ce qui a été supprimé à distance
          const localRecords = await getAll(storeName);
          for (const localRec of localRecords) {
            if (localRec.synced === 1 && !remoteIds.has(localRec.id)) {
              await removeLocal(storeName, localRec.id);
            }
          }
        }
      } catch (err) {
        console.error("Erreur sync:", table, err.message || err);
      }
    }

    updateSyncStatusUI('online');
    await refreshCurrentView();

  } catch (err) {
    console.error("Erreur sync:", "global", err.message || err);
    updateSyncStatusUI(navigator.onLine ? 'online' : 'offline');
  } finally {
    isSyncing = false;
  }
}

// --- MOCK DATA ---
async function checkAndInjectMockData() {
  const clients = await getAll('clients');
  if (clients.length === 0) {
    showToast('Base vide. Injection de données de test...', 'warning');

    // 1. Professionnels
    const p1Id = await add('professionals', {
      nom: 'Dubois', prenom: 'Pierre', telephone: '06 12 34 56 78', specialite: 'Vétérinaire',
      notes: 'Clinique vétérinaire du Val. Disponible urgences.'
    });
    const p2Id = await add('professionals', {
      nom: 'Leroy', prenom: 'Sophie', telephone: '07 98 76 54 32', specialite: 'Maréchal',
      notes: 'Spécialiste du parage naturel physiologique équin.'
    });

    // 2. Clients
    const cl1Id = await add('clients', {
      nom: 'Laurent', prenom: 'Marie', telephone: '06 11 22 33 44', email: 'marie.laurent@gmail.com',
      adresse: 'Ferme des Rêves, 78120 Rambouillet',
      notes: 'Propriétaire très attentive. Préfère les relances par SMS.'
    });
    const cl2Id = await add('clients', {
      nom: 'Martin', prenom: 'Jean', telephone: '06 55 44 33 22', email: 'jean.martin@outlook.fr',
      adresse: '15 rue des Prés, 78610 Le Perray',
      notes: 'Possède plusieurs chiens de chasse.'
    });

    // 3. Animaux
    const an1Id = await add('animals', {
      client_id: cl1Id, nom: 'Spirit', espece: 'Cheval', race: 'Selle Français', robe: 'Bai brun',
      sexe: 'Mâle castré (Hongre)', date_naissance_ou_age: '2016-04-12', photo_blob: null,
      stable_name: 'Écurie des Genêts', stable_address: 'Route de la Butte',
      stable_zip: '78120', stable_city: 'Rambouillet', stable_distance: 15,
      lieu_de_vie: 'Écurie des Genêts, Rambouillet', antecedents: 'Légère arthrose jarret gauche en hiver.',
      housing_type: 'Pré + Box (Pré = grande surface)', social_type: 'À plusieurs (Non mixte)',
      housing_mode: 'Pré + Box (Pré = grande surface)',
      pros_associes_ids: [p1Id, p2Id]
    });
    const an2Id = await add('animals', {
      client_id: cl1Id, nom: 'Luna', espece: 'Chien', race: 'Golden Retriever', robe: 'Fauve clair',
      sexe: 'Femelle stérilisée', date_naissance_ou_age: '2021-08-20', photo_blob: null,
      stable_name: 'Domicile', stable_address: 'Ferme des Rêves, 78120 Rambouillet',
      stable_zip: '78120', stable_city: 'Rambouillet', stable_distance: 0, stable_at_home: true,
      lieu_de_vie: 'Domicile', antecedents: 'Antécédents d\'otites allergiques.',
      housing_type: 'Box + Paddock (Paddock = petite surface)', social_type: 'En duo',
      housing_mode: 'Box + Paddock (Paddock = petite surface)',
      pros_associes_ids: [p1Id]
    });
    const an3Id = await add('animals', {
      client_id: cl2Id, nom: 'Oscar', espece: 'Chien', race: 'Setter Anglais', robe: 'Tricolore',
      sexe: 'Mâle castré (Hongre)', date_naissance_ou_age: '2018-05-15', photo_blob: null,
      stable_name: 'Paddock de la Forêt', stable_address: 'Route Forestière',
      stable_zip: '78610', stable_city: 'Le Perray', stable_distance: 10,
      lieu_de_vie: 'Paddock de la Forêt', antecedents: 'Rupture ligament croisé opéré en 2024.',
      housing_type: 'Pré', social_type: 'À plusieurs (Mixte)',
      housing_mode: 'Pré',
      pros_associes_ids: [p1Id]
    });

    // 4. Séances
    // Une séance il y a 10 jours pour Spirit
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);
    const pastDateStr = pastDate.toISOString().split('T')[0];

    const qAvantMock = {};
    const q3Mock = {};
    QUESTIONNAIRE_CRITERES.forEach(cr => {
      qAvantMock[cr] = { note: 8, precisions: '' };
      q3Mock[cr] = { note: 9, precisions: '' };
    });
    qAvantMock["Locomotion (Souplesse art./musc.)"] = { note: 5, precisions: 'Rigidité hanche droite.' };
    qAvantMock["Autre"] = { note: 10, precisions: 'Tout va bien' };
    
    q3Mock["Locomotion (Souplesse art./musc.)"] = { note: 8, precisions: 'Nette amélioration.' };
    q3Mock["Autre"] = { note: 10, precisions: 'Suivi' };

    const s1Id = await add('sessions', {
      animal_id: an1Id,
      client_id: cl1Id,
      date_seance: pastDateStr,
      motif: 'Rigidité arrière-main et bassin bloqué',
      n_seance_annee: 1,
      q_avant_seance: qAvantMock,
      q_3_semaines: q3Mock,
      protocoles_realises: {
        shiatsu: {
          checked: true,
          yin: { reins: true, foie: false, coeur: false, maitre_coeur: false, rate: false, poumon: false },
          yang: { vessie: true, vesicule: false, grele: false, triple: false, estomac: false, gros_intestin: false },
          vaisseaux: { gouverneur: true, conception: false },
          precisions: 'Méridien Reins et Vessie stimulés pour libérer l\'énergie Eau bloquée.'
        },
        manuelles: { checked: false, texte: '' },
        tensegrite: { checked: false },
        cranio: { checked: false },
        kinesiologie: { checked: false },
        aura: { checked: false }
      },
      canvas_annotation_image_blob: '',
      canvas_drawing_data_url: '',
      cr_personnel: 'Cheval calme et attentif. Tensions résolues rapidement.',
      delai_prochaine_seance: '2m',
      resume_client_genere: '**Protocole Shiatsu**\nMéridiens et Merveilleux Vaisseaux travaillés : Reins (Yin), Vessie (Yang), Vaisseau Gouverneur'
    });

    // 5. Rappels
    // Un rappel actif (dans 4 jours)
    const activeDate = new Date();
    activeDate.setDate(activeDate.getDate() + 4);
    const activeDateStr = activeDate.toISOString().split('T')[0];
    
    await add('reminders', {
      animal_id: an1Id,
      client_id: cl1Id,
      session_id: s1Id,
      date_prevue: activeDateStr,
      semaine_prevue: getYearWeek(new Date(activeDateStr)),
      type_rappel: 'prendre_des_nouvelles',
      statut: 'en_attente',
      notes: 'Prendre des nouvelles de la hanche de Spirit (15j après).'
    });

    // Un rappel futur hors 2 semaines (dans 30 jours)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const futureDateStr = futureDate.toISOString().split('T')[0];
    
    await add('reminders', {
      animal_id: an2Id,
      client_id: cl1Id,
      session_id: null,
      date_prevue: futureDateStr,
      semaine_prevue: getYearWeek(new Date(futureDateStr)),
      type_rappel: 'prendre_rdv',
      statut: 'en_attente',
      notes: 'Relance pour le bilan d\'été de Luna.'
    });

    showToast('Données de test injectées.');
  }
}

// --- MODALE COMPTE-RENDU DE SÉANCE PORTAIL ---
async function openPortalSessionModal(sessionOrId, animal = null) {
  let session = null;
  if (typeof sessionOrId === 'object' && sessionOrId !== null) {
    session = sessionOrId;
  } else {
    session = await getById('sessions', Number(sessionOrId));
  }

  if (!session) {
    showToast('Compte-rendu introuvable.', 'error');
    return;
  }

  // Si l'animal n'a pas été passé, le récupérer
  if (!animal && session.animal_id) {
    animal = await getById('animals', session.animal_id);
  }

  // Vérification de sécurité stricte : correspondance séance <-> animal
  if (!animal || Number(session.animal_id) !== Number(animal.id)) {
    showToast('Accès refusé à ce compte-rendu.', 'error');
    return;
  }

  // Vérification de sécurité contextuelle (portail client)
  if (currentPortalClientId && Number(animal.client_id) !== Number(currentPortalClientId)) {
    showToast('Accès refusé : cet animal n\'appartient pas à votre espace.', 'error');
    return;
  }

  // Récupérer les données du propriétaire
  const client = await getById('clients', session.client_id || animal.client_id);

  const dialog = document.getElementById('dialog-portal-session-cr');
  if (!dialog) return;

  const subtitleEl = document.getElementById('portal-cr-dialog-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `Séance du ${formatDate(session.date_seance)} • ${animal.nom} (${animal.espece})`;
  }

  // Logo officiel Base64
  const logoEl = dialog.querySelector('.print-logo');
  if (logoEl) {
    logoEl.src = getEkikareLogoDataUrl();
  }

  // 1. En-tête date
  const dateEl = document.getElementById('portal-cr-session-date');
  if (dateEl) dateEl.textContent = `Séance du : ${formatDate(session.date_seance)}`;

  // 2. Bloc Propriétaire (Client)
  const clientNameEl = document.getElementById('portal-cr-client-name');
  if (clientNameEl) {
    clientNameEl.textContent = client ? `${client.prenom} ${client.nom.toUpperCase()}` : 'Propriétaire';
  }
  const clientContactEl = document.getElementById('portal-cr-client-contact');
  if (clientContactEl) {
    if (client) {
      clientContactEl.innerHTML = `Tél : ${client.telephone || '-'} &bull; E-mail : ${client.email || '-'}`;
    } else {
      clientContactEl.textContent = '-';
    }
  }

  // 3. Bloc Animal
  const animalNameEl = document.getElementById('portal-cr-animal-name');
  if (animalNameEl) animalNameEl.textContent = animal.nom;

  const animalIdentityEl = document.getElementById('portal-cr-animal-identity');
  if (animalIdentityEl) {
    const breedText = animal.race || 'Race inconnue';
    const robeText = animal.robe ? ` (${animal.robe})` : '';
    animalIdentityEl.textContent = `${animal.espece} • ${breedText}${robeText}`;
  }

  const animalDetailsEl = document.getElementById('portal-cr-animal-details');
  if (animalDetailsEl) {
    const sexText = animal.sexe || 'Non précisé';
    const ageText = calculateAge(animal.date_naissance_ou_age, animal.date_naissance_ou_age);
    animalDetailsEl.textContent = `Sexe : ${sexText} • Âge : ${ageText}`;
  }

  const animalLivingEl = document.getElementById('portal-cr-animal-living');
  if (animalLivingEl) {
    const stableName = animal.stable_name || animal.lieu_de_vie || '-';
    animalLivingEl.textContent = `Lieu de vie : ${stableName}`;
  }

  // 4. Motif de consultation
  const motifEl = document.getElementById('portal-cr-session-objective');
  if (motifEl) {
    if (session.isExternal) {
      motifEl.innerHTML = `<strong>${session.profession || 'Intervention externe'} - <em>${session.practitionerName || 'Praticien tiers'}</em></strong><br>${session.motif || 'Séance de suivi'}`;
    } else {
      motifEl.textContent = session.motif || 'Séance de suivi';
    }
  }

  // 5. Résumé de la séance
  const resumeContentEl = document.getElementById('portal-cr-session-resume-content');
  const rawResume = session.resume_client_genere || session.summary || '';
  if (resumeContentEl) {
    resumeContentEl.innerHTML = rawResume ? interpretMarkdownToHtml(rawResume) : '<em>Aucun résumé rédigé pour cette séance.</em>';
  }

  // 6. Schéma d'annotations
  const canvasSection = document.getElementById('portal-cr-section-canvas');
  const canvasImg = document.getElementById('portal-cr-session-canvas-img');
  if (canvasSection && canvasImg) {
    if (session.canvas_annotation_image_blob) {
      canvasImg.src = session.canvas_annotation_image_blob;
      canvasSection.style.display = 'block';
    } else {
      canvasSection.style.display = 'none';
    }
  }

  // 7. Précisions générales
  const precisionsSection = document.getElementById('portal-cr-section-precisions');
  const precisionsContentEl = document.getElementById('portal-cr-session-precisions-content');
  if (precisionsSection && precisionsContentEl) {
    if (session.precisions && session.precisions.trim()) {
      precisionsContentEl.innerHTML = interpretMarkdownToHtml(session.precisions);
      precisionsSection.style.display = 'block';
    } else {
      precisionsSection.style.display = 'none';
    }
  }

  // 8. Document joint (séances externes)
  const attachSection = document.getElementById('portal-cr-section-attachment');
  const attachContent = document.getElementById('portal-cr-session-attachment-content');
  if (attachSection && attachContent) {
    if (session.fileData) {
      attachContent.innerHTML = `
        <button type="button" class="btn btn-secondary btn-small btn-view-modal-ext-file" style="display: inline-flex; align-items: center; gap: 6px;">
          📎 Consulter le document joint (${session.fileName || 'Fichier'})
        </button>
      `;
      attachContent.querySelector('.btn-view-modal-ext-file').onclick = () => {
        openDocumentViewerModal(session.fileData, session.fileType, session.fileName, {
          subtitle: `Séance du ${formatDate(session.date_seance)} • ${session.profession || 'Externe'}`,
          text: `Document joint séance pour ${animal.nom}`
        });
      };
      attachSection.style.display = 'block';
    } else {
      attachSection.style.display = 'none';
    }
  }

  // 9. Date de génération
  const genDateEl = document.getElementById('portal-cr-generation-date');
  if (genDateEl) {
    genDateEl.textContent = new Date().toLocaleDateString('fr-FR');
  }

  // Listener pour le bouton Télécharger PDF direct
  const downloadBtn = document.getElementById('btn-download-portal-cr');
  if (downloadBtn) {
    downloadBtn.onclick = async () => {
      const sheetElement = document.getElementById('portal-cr-sheet');
      if (!sheetElement) return;

      const cleanAnimalName = (animal?.nom || 'Animal').trim().replace(/[\s/\\?%*:|"<>]+/g, '_');
      let cleanDate = '';
      if (session.date_seance) {
        cleanDate = String(session.date_seance).split('T')[0].replace(/[\s/\\?%*:|"<>]+/g, '-');
      } else {
        cleanDate = new Date().toISOString().split('T')[0];
      }
      const filename = `CR_eKiKare_${cleanAnimalName}_${cleanDate}.pdf`;

      const originalHtml = downloadBtn.innerHTML;
      const originalDisabled = downloadBtn.disabled;
      downloadBtn.disabled = true;
      downloadBtn.innerHTML = `
        <div class="sync-icon-spin" style="width: 14px; height: 14px; border-width: 2px; display: inline-block;"></div>
        Génération PDF...
      `;

      try {
        if (typeof html2pdf === 'undefined') {
          throw new Error("Bibliothèque html2pdf non disponible");
        }

        const opt = {
          margin: [10, 10, 10, 10],
          filename: filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            scrollX: 0,
            scrollY: 0,
            onclone: (clonedDoc) => {
              // Réinitialiser les transforms/offsets sur le document cloné en mémoire par html2canvas
              const target = clonedDoc.querySelector('#portal-cr-sheet') || clonedDoc.querySelector('.cr-document');
              if (target) {
                target.style.margin = '0 auto';
                target.style.transform = 'none';
                target.style.position = 'static';
                target.style.width = '794px';
                target.style.maxWidth = '794px';
                target.style.boxSizing = 'border-box';
              }
            }
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
        };

        await html2pdf().set(opt).from(sheetElement).save();
        showToast(`Compte-rendu téléchargé : ${filename}`);
      } catch (err) {
        console.error('Erreur export PDF:', err);
        showToast("Erreur lors de la génération du PDF.", "error");
      } finally {
        downloadBtn.disabled = originalDisabled;
        downloadBtn.innerHTML = originalHtml;
      }
    };
  }

  // Listener pour le bouton Partager / Imprimer
  const shareBtn = document.getElementById('btn-share-portal-cr');
  if (shareBtn) {
    shareBtn.onclick = async () => {
      const shareData = {
        title: `Compte-Rendu de séance - ${animal?.nom || 'Animal'}`,
        text: `Compte-rendu de séance eKiKare pour ${animal?.nom || 'Animal'} (séance du ${formatDate(session.date_seance)}) :\nMotif : ${session.motif || '-'}\n\n${rawResume}`,
        url: window.location.href
      };

      if (navigator.share && navigator.canShare && navigator.canShare(shareData) && !window.matchMedia('(min-width: 1024px)').matches) {
        try {
          await navigator.share(shareData);
          showToast('Compte-rendu partagé avec succès !');
          return;
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.warn('Erreur partage:', err);
          }
        }
      }

      // Impression directe de la feuille A4
      document.body.classList.add('printing-portal-cr');
      window.print();
      setTimeout(() => {
        document.body.classList.remove('printing-portal-cr');
      }, 1000);
    };
  }

  // Fermeture du dialog
  const closeBtns = dialog.querySelectorAll('.btn-close-dialog');
  closeBtns.forEach(btn => {
    btn.onclick = () => dialog.close();
  });

  // Fermeture au clic en dehors (backdrop)
  dialog.onclick = (e) => {
    const rect = dialog.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      dialog.close();
    }
  };

  dialog.showModal();
}

// --- MODALE ET EXPORT PDF : FICHE DE LIAISON / DOSSIER DE SANTE ANIMAL ---
async function openExportAnimalDossierModal(animalOrId) {
  let animal = null;
  if (typeof animalOrId === 'object' && animalOrId !== null) {
    animal = animalOrId;
  } else {
    animal = await getById('animals', Number(animalOrId));
  }

  if (!animal) {
    showToast("Animal introuvable pour l'export.", "error");
    return;
  }

  const dialog = document.getElementById('dialog-export-animal-dossier');
  if (!dialog) return;

  const subtitleEl = document.getElementById('export-dossier-animal-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `Dossier de suivi de ${animal.nom} (${animal.espece})`;
  }

  // Reset checkboxes to default (all checked)
  const optIdentity = document.getElementById('export-opt-identity');
  const optMedical = document.getElementById('export-opt-medical');
  const optSessions = document.getElementById('export-opt-sessions');
  const periodContainer = document.getElementById('export-sessions-period-container');
  const period12mRadio = document.getElementById('export-period-12m');

  if (optIdentity) optIdentity.checked = true;
  if (optMedical) optMedical.checked = true;
  if (optSessions) optSessions.checked = true;
  if (period12mRadio) period12mRadio.checked = true;
  if (periodContainer) periodContainer.style.display = 'flex';

  // Dynamic toggle of period container when sessions checkbox changes
  if (optSessions && periodContainer) {
    optSessions.onchange = () => {
      periodContainer.style.display = optSessions.checked ? 'flex' : 'none';
    };
  }

  // Confirm download button
  const confirmBtn = document.getElementById('btn-confirm-export-dossier');
  if (confirmBtn) {
    confirmBtn.onclick = async () => {
      const includeIdentity = optIdentity ? optIdentity.checked : true;
      const includeMedical = optMedical ? optMedical.checked : true;
      const includeSessions = optSessions ? optSessions.checked : true;
      
      const selectedPeriodEl = document.querySelector('input[name="export-sessions-period"]:checked');
      const sessionPeriod = selectedPeriodEl ? selectedPeriodEl.value : '12months';

      if (!includeIdentity && !includeMedical && !includeSessions) {
        showToast("Veuillez sélectionner au moins une section à exporter.", "warning");
        return;
      }

      await exportAnimalDossierPDF(animal, {
        includeIdentity,
        includeMedical,
        includeSessions,
        sessionPeriod
      });

      dialog.close();
    };
  }

  // Cancel & close buttons
  const cancelBtns = dialog.querySelectorAll('.btn-cancel-dialog, .btn-close-dialog');
  cancelBtns.forEach(btn => {
    btn.onclick = () => dialog.close();
  });

  // Backdrop click to close
  dialog.onclick = (e) => {
    const rect = dialog.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      dialog.close();
    }
  };

  dialog.showModal();
}

// Logo officiel eKiKare en Base64 Data URL (neutralise tout probleme reseau / CORS / 404 sur GitHub Pages et PDF)
const EKIKARE_LOGO_B64 = "data:image/png;base64,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";

function getEkikareLogoDataUrl() {
  try {
    const existingImgs = document.querySelectorAll('img[src*="logo-ekikare"], .print-logo, img[alt*="eKiKare"]');
    for (const img of existingImgs) {
      if (img.complete && img.naturalWidth > 0) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl && dataUrl.length > 100) return dataUrl;
      }
    }
  } catch (e) {
    console.warn("Could not extract logo from DOM canvas:", e);
  }
  return EKIKARE_LOGO_B64;
}

async function exportAnimalDossierPDF(animal, options) {
  const confirmBtn = document.getElementById('btn-confirm-export-dossier');
  const originalHtml = confirmBtn ? confirmBtn.innerHTML : '';
  const originalDisabled = confirmBtn ? confirmBtn.disabled : false;

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `
      <div class="sync-icon-spin" style="width: 14px; height: 14px; border-width: 2px; display: inline-block;"></div>
      <span>Génération du dossier PDF...</span>
    `;
  }

  let printContainer = null;

  try {
    if (typeof html2pdf === 'undefined') {
      throw new Error("Bibliothèque html2pdf non disponible");
    }

    // Récupérer le client
    const client = await getById('clients', animal.client_id);
    const ownerName = client ? `${client.prenom} ${client.nom.toUpperCase()}` : 'Propriétaire inconnu';

    // Récupérer et filtrer les séances
    let filteredSessions = [];
    let periodLabel = '';
    if (options.includeSessions) {
      const allSessions = await getAll('sessions');
      const animalSessions = allSessions.filter(s => Number(s.animal_id) === Number(animal.id));
      animalSessions.sort((a, b) => new Date(b.date_seance) - new Date(a.date_seance));

      if (options.sessionPeriod === '12months') {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        filteredSessions = animalSessions.filter(s => new Date(s.date_seance) >= oneYearAgo);
        periodLabel = "12 derniers mois";
      } else {
        filteredSessions = animalSessions;
        periodLabel = "Toutes les séances";
      }
    }

    // Construire les informations d'identité
    const birthdateStr = animal.date_naissance_ou_age || '';
    const ageDisplay = calculateAge(birthdateStr, birthdateStr);
    const birthDisplay = birthdateStr ? `${formatDate(birthdateStr)} (${ageDisplay})` : ageDisplay;

    const stableName = animal.stable_name || animal.lieu_de_vie || 'Non précisé';
    let fullAddress = '-';
    const stableAddress = animal.stable_address || '';
    const stableZip = animal.stable_zip || '';
    const stableCity = animal.stable_city || '';
    const fullAddressParts = [];
    if (stableAddress) fullAddressParts.push(stableAddress);
    if (stableZip || stableCity) fullAddressParts.push(`${stableZip} ${stableCity}`.trim());
    if (fullAddressParts.length > 0) fullAddress = fullAddressParts.join(', ');

    let hType = animal.housing_type || animal.housing_mode || '-';
    if (hType === 'Autre') hType = animal.housing_type_other || animal.housing_mode_other || 'Autre hébergement';
    let sType = animal.social_type || '';
    if (sType === 'Autre') sType = 'Autre vie sociale';
    let combinedHousing = hType;
    if (sType) combinedHousing += ` • ${sType}`;

    const idNumber = animal.sire || animal.numero_sire || animal.puce || animal.transpondeur || animal.identification || 'Non renseigné';

    // 1. Créer le conteneur DOM visible pour la capture
    printContainer = document.createElement('div');
    printContainer.id = 'dossier-pdf-render-target';
    printContainer.className = 'print-container official-a4-sheet cr-document';
    printContainer.style.cssText = "position: fixed; top: 0; left: 0; width: 800px; z-index: -9999; background: #ffffff; color: #1e293b; padding: 30px 40px; box-sizing: border-box; font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;";

    const logoSrc = getEkikareLogoDataUrl();

    let html = `
      <!-- EN-TETE OFFICIEL (TABLEAU COMPATIBLE HTML2CANVAS) -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; page-break-inside: avoid; break-inside: avoid;">
        <tr>
          <td style="vertical-align: top; padding: 0 0 16px 0;">
            <h1 style="font-size: 1.4rem; font-weight: 700; color: #0f172a; margin: 0 0 4px 0;">
              <span style="color: #D96B27;">eKiKare</span> • Fiche de Liaison & Dossier de Santé
            </h1>
            <p style="font-size: 0.85rem; color: #64748b; margin: 0 0 8px 0;">Dossier de suivi bien-être et de liaison interprofessionnelle</p>
            <div style="display: inline-block; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #D96B27; padding: 8px 14px; border-radius: 6px; font-size: 0.95rem; font-weight: 600; color: #0f172a;">
              <span>🐾 <strong>${animal.nom}</strong> (${animal.espece}${animal.race ? ' - ' + animal.race : ''})</span>
              <span style="color: #94a3b8; font-weight: normal; margin-left: 6px;">• Édité le ${new Date().toLocaleDateString('fr-FR')}</span>
            </div>
          </td>
          <td style="text-align: right; vertical-align: top; width: 230px; padding: 0 0 16px 0;">
            <img src="${logoSrc}" alt="eKiKare" style="max-height: 48px; width: auto; object-fit: contain; display: block; margin-left: auto; margin-bottom: 4px;">
            <span style="font-size: 0.76rem; color: #64748b; font-weight: 500; letter-spacing: 0.3px; display: block;">Techniques manuelles et énergétiques</span>
          </td>
        </tr>
      </table>
    `;

    // SECTION 1: FICHE D'IDENTITE (TABLEAU 2 COLONNES 100% COMPATIBLE)
    if (options.includeIdentity) {
      html += `
        <div style="margin-bottom: 24px; page-break-inside: avoid; break-inside: avoid;">
          <div style="font-size: 1.05rem; font-weight: 700; color: #0f172a; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1.5px solid #e2e8f0;">
            <span style="color: #D96B27;">1.</span> Signalement & Fiche d'Identité
          </div>
          <table style="width: 100%; border-collapse: separate; border-spacing: 16px 0; margin-left: -8px; margin-right: -8px;">
            <tr>
              <!-- Colonne Animal -->
              <td style="width: 50%; vertical-align: top; padding: 0;">
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; font-size: 0.85rem; color: #1e293b;">
                  <h4 style="font-size: 0.88rem; font-weight: 700; color: #334155; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 4px;">Signalement & Mode de vie</h4>
                  <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Nom :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${animal.nom}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Espèce / Race :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${animal.espece} • ${animal.race || 'Non précisée'}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Robe / Sexe :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${animal.robe || '-'} • ${animal.sexe || 'Non précisé'}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Âge / Naissance :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${birthDisplay}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">SIRE / Puce :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${idNumber}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Mode de vie :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${combinedHousing}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Alimentation :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${animal.nutrition_details || '-'}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Travail / Objectif :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${animal.work_objective || animal.lifestyle_details || '-'}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Problématiques :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${animal.main_problems || '-'}</td></tr>
                  </table>
                </div>
              </td>
              <!-- Colonne Propriétaire & Lieu -->
              <td style="width: 50%; vertical-align: top; padding: 0;">
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; font-size: 0.85rem; color: #1e293b;">
                  <h4 style="font-size: 0.88rem; font-weight: 700; color: #334155; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 4px;">Propriétaire & Hébergement</h4>
                  <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Propriétaire :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${ownerName}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Téléphone :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${client?.telephone || '-'}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">E-mail :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${client?.email || '-'}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Adresse :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${client?.adresse || '-'}</td></tr>
                    <tr><td colspan="2" style="border-top: 1px dashed #cbd5e1; padding: 4px 0 2px 0;"></td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Pension / Lieu :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${stableName}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Adresse pension :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${fullAddress}</td></tr>
                    <tr><td style="width: 130px; padding: 3px 0; color: #64748b; font-weight: 500; vertical-align: top;">Suivi nutrition :</td><td style="padding: 3px 0; color: #0f172a; font-weight: 600; vertical-align: top;">${animal.nutritionist ? 'Oui' : 'Non'}</td></tr>
                  </table>
                </div>
              </td>
            </tr>
          </table>
        </div>
      `;
    }

    // SECTION 2: HISTORIQUE MEDICAL & ANTECEDENTS
    if (options.includeMedical) {
      const medEvents = animal.medical_events || [];
      const MONTHS_ORDER = {
        "Janvier": 1, "Février": 2, "Mars": 3, "Avril": 4, "Mai": 5, "Juin": 6,
        "Juillet": 7, "Août": 8, "Septembre": 9, "Octobre": 10, "Novembre": 11, "Décembre": 12
      };

      medEvents.sort((a, b) => {
        const yearA = parseInt(a.year) || 0;
        const yearB = parseInt(b.year) || 0;
        if (yearA !== yearB) return yearB - yearA;
        const monthA = MONTHS_ORDER[a.month] || 0;
        const monthB = MONTHS_ORDER[b.month] || 0;
        return monthB - monthA;
      });

      html += `
        <div style="margin-bottom: 24px; page-break-inside: avoid; break-inside: avoid;">
          <div style="font-size: 1.05rem; font-weight: 700; color: #0f172a; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1.5px solid #e2e8f0;">
            <span style="color: #D96B27;">2.</span> Historique Médical & Pathologies
          </div>
      `;

      if (medEvents.length > 0) {
        html += `
          <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 6px;">
            <thead>
              <tr style="background: #f1f5f9; color: #475569; font-weight: 600; text-align: left;">
                <th style="padding: 8px 12px; border: 1px solid #e2e8f0; width: 140px;">Période</th>
                <th style="padding: 8px 12px; border: 1px solid #e2e8f0;">Événement / Pathologie / Antécédent</th>
              </tr>
            </thead>
            <tbody>
        `;
        medEvents.forEach(ev => {
          html += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 700; color: #D96B27; white-space: nowrap;">${ev.year}${ev.month ? ' - ' + ev.month : ''}</td>
              <td style="padding: 8px 12px; border: 1px solid #e2e8f0; color: #1e293b;">${ev.event}</td>
            </tr>
          `;
        });
        html += `
            </tbody>
          </table>
        `;
      } else if (animal.antecedents) {
        html += `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; font-size: 0.85rem;">
            <p style="margin: 0; white-space: pre-line; color: #1e293b;">${animal.antecedents}</p>
          </div>
        `;
      } else {
        html += `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; font-size: 0.85rem; text-align: center; color: #64748b; font-style: italic;">
            Aucun antécédent médical ou pathologie particulier consigné.
          </div>
        `;
      }

      html += `</div>`;
    }

    // SECTION 3: HISTORIQUE DES SEANCES DE SOINS / BIEN-ETRE
    if (options.includeSessions) {
      html += `
        <div style="margin-bottom: 24px; page-break-inside: avoid; break-inside: avoid;">
          <div style="font-size: 1.05rem; font-weight: 700; color: #0f172a; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1.5px solid #e2e8f0;">
            <span style="color: #D96B27;">3.</span> Historique & Synthèse des Séances (${periodLabel})
          </div>
      `;

      if (filteredSessions.length === 0) {
        html += `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; font-size: 0.85rem; text-align: center; color: #64748b; font-style: italic;">
            Aucune séance enregistrée sur la période sélectionnée (${periodLabel}).
          </div>
        `;
      } else {
        filteredSessions.forEach(s => {
          let cardTitle = '';
          let rawSummary = '';

          if (s.isExternal) {
            cardTitle = `${s.profession || 'Intervention'}${s.practitionerName ? ' - ' + s.practitionerName : ''}`;
            rawSummary = s.summary || '-';
          } else {
            const protos = s.protocoles_realises || {};
            const activeProtocols = [];
            if (protos.shiatsu && protos.shiatsu.checked) activeProtocols.push('Shiatsu');
            if (protos.manuelles && protos.manuelles.checked) activeProtocols.push('Techniques manuelles');
            if (protos.tensegrite && protos.tensegrite.checked) activeProtocols.push('Tenségrité');
            if (protos.cranio && protos.cranio.checked) activeProtocols.push('Cranio-Sacrée');
            if (protos.kinesiologie && protos.kinesiologie.checked) activeProtocols.push('Kinésiologie');
            if (protos.aura && protos.aura.checked) activeProtocols.push('Aura');

            cardTitle = activeProtocols.length > 0 ? activeProtocols.join(' + ') : (s.motif || `Séance du ${formatDate(s.date_seance)}`);
            rawSummary = s.resume_client_genere || 'Aucun résumé client rédigé.';
          }

          const cleanSummaryHtml = interpretMarkdownToHtml(rawSummary);

          html += `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; page-break-inside: avoid; break-inside: avoid;">
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 4px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
                <tr>
                  <td style="text-align: left; font-weight: 700; color: #0f172a; font-size: 0.88rem; padding: 0 0 4px 0;">${cardTitle}</td>
                  <td style="text-align: right; font-size: 0.8rem; font-weight: 600; color: #D96B27; white-space: nowrap; padding: 0 0 4px 0;">${formatDate(s.date_seance)}</td>
                </tr>
              </table>
              ${s.motif ? `<div style="font-size: 0.82rem; color: #475569; margin-bottom: 4px; line-height: 1.35;"><strong>Motif :</strong> ${s.motif}</div>` : ''}
              <div style="font-size: 0.82rem; color: #334155; line-height: 1.4; margin: 0; word-break: break-word;">
                <strong style="color: #0f172a;">Résumé :</strong> <span>${cleanSummaryHtml}</span>
              </div>
            </div>
          `;
        });
      }

      html += `</div>`;
    }

    // PIED DE PAGE ET DECHARGE LEGALE
    html += `
      <div style="margin-top: 30px; border-top: 1px solid #cbd5e1; padding-top: 14px; page-break-inside: avoid; break-inside: avoid;">
        <p style="font-size: 0.76rem; font-style: italic; line-height: 1.4; color: #64748b; text-align: justify; margin: 0 0 10px 0;">
          « Ces notes sont purement personnelles et les informations qu’elles contiennent sont transmises à titre indicatif et dans le cadre d’un partage. Les indications anatomiques sont là uniquement comme repères pour localiser le travail énergétique effectué. Elles ne peuvent en aucun cas engager ma responsabilité, ni se substituer à un diagnostic, un avis et un suivi vétérinaire, ostéopathique ou éducatif. »
        </p>
        <p style="font-size: 0.74rem; color: #94a3b8; text-align: center; margin: 0;">
          Fiche de liaison générée via l'application Suivi eKiKare le ${new Date().toLocaleDateString('fr-FR')} • Page générée automatiquement
        </p>
      </div>
    `;

    printContainer.innerHTML = html;
    document.body.appendChild(printContainer);

    console.log("PDF Export HTML generated. Length:", printContainer.innerHTML.length);
    console.log("PDF Export HTML content:\n", printContainer.innerHTML);

    // Sécurité préchargement des images : timeout de 1 seconde max et masquage si échec
    const images = Array.from(printContainer.querySelectorAll('img'));
    await Promise.all(images.map(img => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(res => {
        const timer = setTimeout(() => {
          console.warn("Image preloading timed out, continuing export:", img.src ? img.src.substring(0, 60) : '');
          res();
        }, 1000);
        img.onload = () => { clearTimeout(timer); res(); };
        img.onerror = () => {
          console.warn("Image failed to load (404/CORS), removing to avoid canvas crash:", img.src ? img.src.substring(0, 60) : '');
          clearTimeout(timer);
          img.style.display = 'none';
          res();
        };
      });
    }));
    await new Promise(res => setTimeout(res, 150));

    const cleanAnimalName = (animal?.nom || 'Animal').trim().replace(/[\s/\\?%*:|"<>]+/g, '_');
    const todayIso = new Date().toISOString().split('T')[0];
    const filename = `Dossier_Liaison_eKiKare_${cleanAnimalName}_${todayIso}.pdf`;

    // Options exactement calquées sur les comptes-rendus de séances éprouvés
    const opt = {
      margin: [10, 10, 10, 10],
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        scrollX: 0,
        scrollY: 0,
        onclone: (clonedDoc) => {
          const target = clonedDoc.querySelector('#dossier-pdf-render-target') || clonedDoc.querySelector('.official-a4-sheet');
          if (target) {
            target.style.position = 'static';
            target.style.margin = '0 auto';
            target.style.zIndex = '1';
            target.style.display = 'block';
            target.style.visibility = 'visible';
            target.style.opacity = '1';
            target.style.width = '794px';
            target.style.maxWidth = '794px';
            target.style.boxSizing = 'border-box';
            target.style.backgroundColor = '#ffffff';
          }
        }
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    await html2pdf().set(opt).from(printContainer).save();
    showToast(`Dossier de liaison téléchargé : ${filename}`);

  } catch (err) {
    console.error("Erreur lors de l'export du dossier animal:", err);
    showToast("Erreur lors de la génération du PDF du dossier.", "error");
  } finally {
    // Nettoyer l'élément temporaire UNIQUEMENT après la fin du save
    if (printContainer && printContainer.parentNode) {
      printContainer.parentNode.removeChild(printContainer);
    }
    if (confirmBtn) {
      confirmBtn.disabled = originalDisabled;
      confirmBtn.innerHTML = originalHtml;
    }
  }
}

// --- PORTAIL CLIENT ---
async function renderPortalDetails(tokenOrId) {
  hidePractitionerLockOverlay();

  const portalAnimalsContainer = document.getElementById('portal-client-animals');
  const ownerTitle = document.getElementById('portal-owner-title');

  // 1. Indicateur de chargement immédiat
  if (ownerTitle) ownerTitle.textContent = "Chargement de votre espace de suivi...";
  if (portalAnimalsContainer) {
    portalAnimalsContainer.innerHTML = `
      <div class="portal-loading-card glass-card" style="text-align: center; padding: 48px 24px; margin: 16px 0; border-radius: 16px;">
        <div class="sync-icon-spin" style="width: 32px; height: 32px; border-width: 3px; color: var(--color-primary, #10b981); margin: 0 auto 16px;"></div>
        <h3 style="font-size: 1.15rem; font-weight: 600; color: #fff; margin-bottom: 6px;">Récupération de votre dossier...</h3>
        <p style="font-size: 0.88rem; color: var(--text-sub, #94a3b8); max-width: 380px; margin: 0 auto;">Connexion sécurisée en cours avec la base de données eKiKare.</p>
      </div>
    `;
  }

  // 2. Recherche locale puis Supabase
  let client = await fetchClientPortalData(tokenOrId);
  if (!client && !isNaN(Number(tokenOrId))) {
    client = await getById('clients', Number(tokenOrId));
  }

  // 3. Cas non trouvé
  if (!client) {
    if (portalAnimalsContainer) {
      portalAnimalsContainer.innerHTML = `
        <div class="empty-state glass-card" style="text-align: center; padding: 48px 24px; margin: 16px 0; border-radius: 16px;">
          <div style="font-size: 2.2rem; margin-bottom: 12px;">🔍</div>
          <h3 style="font-size: 1.15rem; font-weight: 600; color: #fff; margin-bottom: 6px;">Espace client introuvable</h3>
          <p style="font-size: 0.88rem; color: var(--text-sub, #94a3b8); max-width: 420px; margin: 0 auto; line-height: 1.5;">
            Ce lien de suivi est introuvable ou a été désactivé.<br>
            Veuillez contacter votre praticienne pour obtenir un nouveau lien personnalisé.
          </p>
        </div>
      `;
    }
    if (ownerTitle) ownerTitle.textContent = "Espace Suivi eKiKare";
    document.getElementById('portal-client-phone').textContent = "-";
    document.getElementById('portal-client-email').textContent = "-";
    document.getElementById('portal-client-address').textContent = "-";
    document.getElementById('portal-client-stable').textContent = "-";
    return;
  }

  currentPortalClientId = client.id;
  currentPortalClientToken = client.uuid || String(client.id);
  sessionStorage.setItem('portalClientId', currentPortalClientId);
  sessionStorage.setItem('portalClientToken', currentPortalClientToken);

  // 4. Mettre à jour l'en-tête et les infos de contact
  if (ownerTitle) ownerTitle.textContent = `Espace Suivi de ${client.prenom} ${client.nom.toUpperCase()}`;
  document.getElementById('portal-client-phone').textContent = client.telephone || '-';
  document.getElementById('portal-client-email').textContent = client.email || '-';
  document.getElementById('portal-client-address').textContent = client.adresse || '-';
  document.getElementById('portal-client-stable').textContent = client.ecurie || '-';

  // Configurer le bouton de modification des coordonnées
  document.getElementById('btn-portal-edit-contact').onclick = () => {
    openClientDialog(client);
  };

  // Configurer le bouton d'ajout d'un animal
  document.getElementById('btn-portal-add-animal').onclick = () => {
    openAnimalDialog(null, client.id);
  };

  // Récupérer et afficher les animaux associés à ce client
  const animals = await getByIndex('animals', 'client_id', client.id);
  portalAnimalsContainer.innerHTML = '';

  if (animals.length === 0) {
    portalAnimalsContainer.innerHTML = '<p class="empty-state">Aucun animal enregistré sur votre compte.</p>';
  } else {
    for (const an of animals) {
      const portalToken = currentPortalClientToken || client.uuid || client.id;
      const card = document.createElement('a');
      card.className = 'animal-mini-card';
      card.href = `#portal/${portalToken}/animals/${an.id}`;
      
      const avatarText = an.nom.substring(0, 2).toUpperCase();
      const ageDisplay = calculateAge(an.date_naissance_ou_age, an.date_naissance_ou_age);
      const locText = getAnimalLocationSummary(an);

      card.innerHTML = `
        <div class="animal-mini-info">
          <div class="animal-avatar-mini">${avatarText}</div>
          <div>
            <span class="animal-mini-name">${an.nom}</span>
            <div class="animal-mini-details">${an.espece} &bull; ${an.race || 'Race inconnue'} &bull; ${ageDisplay}</div>
            <div class="animal-mini-location" style="font-size:0.85rem; color:var(--text-sub); margin-top:2px;">📍 ${locText}</div>
          </div>
        </div>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      `;

      portalAnimalsContainer.appendChild(card);
    }
  }
}
