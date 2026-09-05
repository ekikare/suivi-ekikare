# Suivi du chantier : Archivage dynamique & Suppression sur fiches (Clients et Animaux)

- [x] 1. Schéma & Synchronisation (`db.js`) <!-- id: 1 -->
  - [x] Support `archived_at` et `archive_reason` dans le mapping Local / Supabase <!-- id: 1.1 -->
  - [x] Fonctions de suppression définitive en cascade `deleteClientCascade` et `deleteAnimalCascade` <!-- id: 1.2 -->
- [x] 2. Motifs d'archivage dynamiques (`app.js`) <!-- id: 2 -->
  - [x] Initialisation des motifs par défaut (Clients / Animaux) <!-- id: 2.1 -->
  - [x] Persistance et enrichissement automatique via `localStorage` lors de l'utilisation de "Autre..." <!-- id: 2.2 -->
- [x] 3. Filtrage des annuaires (`index.html`, `style.css`, `app.js`) <!-- id: 3 -->
  - [x] Onglets de filtrage Actifs / Archives avec compteur sur `#view-clients` <!-- id: 3.1 -->
  - [x] Onglets de filtrage Actifs / Archives avec compteur sur `#view-animals` <!-- id: 3.2 -->
- [x] 4. Actions & Bandeau sur fiches détaillées (`index.html`, `style.css`, `app.js`) <!-- id: 4 -->
  - [x] Bouton d'archivage compact (icône `Archive`) sur fiches actives <!-- id: 4.1 -->
  - [x] Bandeau d'information discret sur fiches archivées <!-- id: 4.2 -->
  - [x] Boutons Restaurer (`RotateCcw`) et Supprimer définitivement (`Trash2`) sur fiches archivées <!-- id: 4.3 -->
- [x] 5. Modales d'action (`index.html`, `app.js`) <!-- id: 5 -->
  - [x] Modale d'archivage `#dialog-archive-record` avec motifs dynamiques + saisie libre <!-- id: 5.1 -->
  - [x] Modale de suppression définitive `#dialog-confirm-delete-permanent` avec saisie obligatoire de "SUPPRIMER" <!-- id: 5.2 -->
- [x] 6. Tests, validation & déploiement <!-- id: 6 -->
  - [x] Tests de navigation et vérification de la cascade et des compteurs <!-- id: 6.1 -->
  - [x] Commit et push sur `origin main` <!-- id: 6.2 -->

