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
              ${s.profession || 'Intervention'}${s.practitionerName ? ` - <em style="font-weight:normal; font-style:italic; color:#cbd5e1;">${s.practitionerName}</em>` : ''}
            </div>
            <span class="badge-external" style="font-size:0.72rem; padding: 2px 8px; margin:0;">${formatDate(s.date_seance)}</span>
          </div>
          ${s.motif ? `<div class="timeline-motif" style="font-size:0.82rem; margin-bottom:2px; line-height:1.35; color:#cbd5e1;"><strong>Motif :</strong> ${s.motif}</div>` : ''}
          <div class="timeline-preview" style="-webkit-line-clamp:unset; max-height:none; overflow:visible; font-size:0.82rem; line-height:1.35; margin:0; word-break:break-word; color:#cbd5e1;">
            <strong>Résumé / Prescriptions :</strong> <span style="white-space:pre-wrap;">${cleanSummary}</span>
          </div>
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
              <span class="timeline-date" style="font-size:0.75rem; color:#94a3b8;">${formatDate(s.date_seance)}</span>
              <span class="timeline-n-session" style="font-size:0.72rem; padding:1px 6px;">Séance ${s.n_seance_annee || 1}</span>
            </div>
          </div>
          ${s.motif ? `<div class="timeline-motif" style="font-size:0.82rem; color:#cbd5e1; margin-bottom:2px; line-height:1.35;"><strong>Motif :</strong> ${s.motif}</div>` : ''}
          <div class="timeline-preview" style="-webkit-line-clamp:unset; max-height:none; overflow:visible; font-size:0.82rem; line-height:1.35; margin:0; word-break:break-word; color:#cbd5e1;">
            <strong>Résumé :</strong> <span style="white-space:pre-wrap;">${cleanSummary}</span>
          </div>
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

  // Imprimer la séance
  document.getElementById('btn-print-session').onclick = () => {
    window.open(`#sessions/${session.id}/print`, '_blank');
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

  // Listener pour le bouton Partager
  const shareBtn = document.getElementById('btn-share-portal-cr');
  if (shareBtn) {
    shareBtn.onclick = async () => {
      const shareData = {
        title: `Compte-Rendu de séance - ${animal.nom}`,
        text: `Compte-rendu de séance eKiKare pour ${animal.nom} (séance du ${formatDate(session.date_seance)}) :\nMotif : ${session.motif || '-'}\n\n${rawResume}`,
        url: window.location.href
      };

      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        try {
          await navigator.share(shareData);
          showToast('Compte-rendu partagé avec succès !');
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.warn('Erreur partage:', err);
          }
        }
      } else {
        // Fallback: copier dans le presse-papier
        try {
          await navigator.clipboard.writeText(`${shareData.title}\n\n${shareData.text}\n\nLien: ${shareData.url}`);
          showToast('Résumé du compte-rendu copié dans le presse-papier !');
        } catch (e) {
          showToast('Impossible de copier le résumé.', 'error');
        }
      }
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
        <div class="sync-icon-spin" style="width: 32px; height: 32px; border-width: 3px; color: var(--color-primary, #6366f1); margin: 0 auto 16px;"></div>
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
