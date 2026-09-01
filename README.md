# Suivi eKiKare - Gestionnaire de soins équins et canins

**Suivi eKiKare** est une application web monopage (SPA) conçue pour les praticiennes en thérapie manuelle et soins énergétiques. Elle fonctionne à 100% Hors-Ligne (Offline-First) en stockant l'ensemble des données dans la base de données locale du navigateur (**IndexedDB**), garantissant une accessibilité totale sur le terrain.

---

## 🚀 Fonctionnalités Clés

### 1. Gestion CRM (Partie Métier)
* **Tableau de Bord Interactif** : Affiche les indicateurs d'activité sous forme de cartes statistiques cliquables (redirigeant vers leurs sections respectives). Il intègre un double compteur pour les séances (séances réalisées ce mois-ci et séances totales) et un bouton d'ajout rapide d'animal placé dans les actions rapides.
* **Clients** : Annuaire des propriétaires avec nom, coordonnées, adresse de facturation, et tableau interactif triable. Comprend une recherche dynamique multi-critères temps réel insensible aux accents et à la casse qui filtre sur les propriétaires, leurs animaux associés (prénoms) et les lieux de vie de ces derniers. L'affichage du lieu de vie respecte une règle de formatage à 3 niveaux (Écurie - Ville CP, Domicile - Ville CP, ou Ville CP seul).
* **Animaux** : Fiche d'identité complète (espèce, race, robe, sexe, âge calculé dynamiquement, antécédents, professionnels associés) et historique chronologique des soins. Le calcul de l'âge est basé sur l'année de naissance. En cas d'âge estimé saisi à la création sans date de naissance, celle-ci est automatiquement calculée au format ISO "AAAA-01-01" (Année actuelle - Âge estimé). Dans l'historique des séances, la carte met en valeur l'ensemble des protocoles cochés/utilisés en gras comme titre principal, séparés par " + " (ex: "Shiatsu + Tenségrité"). Si aucun protocole n'est actif, le motif ou "Séance du [Date]" est affiché en titre de secours, le motif (si présent) et le résumé restant affichés juste en dessous.
* **Professionnels** : Répertoire des vétérinaires, maréchaux, ostéopathes, nutritionnistes ou praticiens. Le tableau des professionnels affiche la liste des animaux suivis avec liens interactifs et emojis d'espèces (en remplacement de la colonne E-mail). La liste des spécialités est dynamique et persistée en local. Le formulaire de création/édition d'un professionnel intègre désormais une section "Animaux suivis par ce professionnel" avec recherche en temps réel et cases à cocher, synchronisant automatiquement les liaisons sur les fiches des animaux dans IndexedDB.
* **Annuaire Interactif des Animaux** : Tableau réorganisé affichant les espèces sous forme de pictogrammes discrets (🐴, 🐕, 🐱, 🐾), et affichant de nouvelles colonnes ("Problématique(s) principale(s)" et "Mode de suivi"). Les en-têtes sont interactifs et permettent de trier les lignes dans l'ordre croissant ou décroissant (Nom, Race, Propriétaire, Lieu de vie, Âge, Suivi) avec indicateurs visuels (▲ / ▼).
* **Espèce Personnalisable** : Le champ Espèce du formulaire propose "Cheval", "Chien", "Chat" ou "Autre". La sélection de "Autre" affiche un champ texte conditionnel pour préciser l'espèce.
* **Regroupement par Lieu de vie (Tournées) & Carte Interactive** : Organisation géographique automatique des animaux structurée en arborescence : Département (extrait du code postal ou de l'adresse, sinon "Département non spécifié") > Ville (sinon "Ville non spécifiée") > Écurie/Pension (ou "Domicile / Pré privé" avec adresse de rue et distance en km si aucun nom d'écurie n'est spécifié). Intègre un filtre de recherche standard en temps réel (filtrant sur l'animal, le propriétaire, l'écurie, la ville, le CP, ou le département) et une carte interactive Leaflet (#tours-map) avec géocodage prioritaire via l'API Adresse officielle française (et repli Nominatim) en cascade, masquée par défaut et mise à jour en temps réel. Les coordonnées résolues sont persistées dans `localStorage` pour un fonctionnement 100% Offline-First.
* **Découpage & Auto-complétion intelligente** : Les lieux de vie des animaux sont scindés en champs distincts (Nom de l'écurie, Adresse/Rue, Code Postal, Ville, Distance). La saisie est facilitée par une auto-complétion bidirectionnelle intelligente : la sélection d'une écurie pré-remplit l'adresse complète et les km, et à l'inverse, si une adresse connue est saisie, le nom de l'écurie est automatiquement assigné à l'enregistrement. Un parseur intelligent d'adresse assure la rétrocompatibilité des anciennes fiches.
* **Évolution du Mode de vie** : Les options d'hébergement ont été scindées en deux sélecteurs distincts : le Type d'hébergement (Pré, Pré+Box, Box, Box+Paddock, Autre) et la Vie sociale / Cohabitation (Individuel, En duo, À plusieurs mixte/non mixte, Autre), s'affichant de manière combinée et lisible sur la fiche détaillée (ex: "Pré • À plusieurs (Mixte)").
* **Ergonomie & Responsive Design** : Uniformisation des en-têtes de pages avec un conteneur statique `.page-header` alignant le titre et le bouton d'action principale sur la même ligne (flexbox), et un champ de recherche pleine largeur `.search-input` indépendant en dessous. Sur les pages comportant un filtre associé, l'input et le select sont alignés en ligne flex avec une hauteur identique de 44px, empêchant tout saut de ligne, débordement ou rétrécissement des boutons.


### 2. Questionnaires Dynamiques (Avant séance & Suivi)
* **Évaluation sur 11 critères réorganisés** (1. Moral, 2. Gestion émotionnelle, 3. Energie/Vitalité, 4. Locomotion, 5. Gestion de l'effort, 6. Système respiratoire, 7. Qualité yeux/peau/poils/sabots, 8. Système digestif, 9. Système immunitaire, 10. Système hormonal, 11. Autre) notés de 1 à 10.
* **Disposition en grille** : Les critères sont disposés sur 2 colonnes (50% de largeur), sauf le critère "Autre" qui prend toute la largeur.
* **Champs de précisions intelligents** : S'affichent automatiquement si la note d'un critère est inférieure à 7, ou de manière systématique pour la catégorie "Autre".
* **Comparaison Visuelle Dynamique** : Lors du remplissage du questionnaire de suivi (à 3 semaines), les scores et notes saisis dans le questionnaire d'avant séance sont affichés en violet en dessous des sliders en temps réel.
* **Sélection d'Animal & Pré-remplissage** : Par défaut, aucun animal n'est sélectionné à l'ouverture du formulaire de création de séance (option neutre '-- Choisir un animal... --' requise). Ouvrir le formulaire depuis la fiche d'un animal pré-sélectionne ce dernier automatiquement. Si l'animal a été traité il y a moins de 2 mois, l'application propose de pré-remplir l'état initial avec les scores de suivi de la séance précédente.

### 3. Les 6 Protocoles de Soin Métier (Réalisés)
* **Shiatsu** : Organisé sous forme de grille compacte Yin / Yang alignée verticalement par éléments (Bois : vert, Feu : rouge, Feu Ministre : rose, Terre : orange, Métal : gris, Eau : bleu) n'affichant que l'abréviation et l'indice exact (F², MC², C³, Rte¹, P¹, Rein³, VB², TR², IG¹, E³, GI³, V¹).
* **Techniques manuelles** : Zone de texte libre pour le travail structurel, fascial et tissulaire.
* **Tenségrité** : Évaluation d'intensités (Faible, Moyen, Élevé) pour 4 catégories (FTM, Torsion Physiologique, Diaphragmes, Loges) avec calcul automatique de la moyenne globale, s'affichant avec une lisibilité de police contrastée. Le format de compte-rendu privé praticien conserve le détail complet de tous les sous-éléments d'intensité Moyenne et Élevée pour toutes les catégories. La version synthétique (sans sous-éléments pour FTM et Torsion Physiologique, ex: "FTM (Moyen)") est réservée uniquement au Résumé Client.
* **Réflexologie Cranio-Sacrée** (précédemment Thérapie Cranio-Sacrée) : Ambiance émotionnelle de départ, cases à cocher disposées en colonne (avec renommages adaptatifs : *Os du crâne* et *sphénoïde*), section Viscéral en contraste blanc haute lisibilité, et précisions.
* **Kinésiologie** : Sélection du type (Classique, Couple, Émotions réactives, Émotion d'urgence, Autre) avec des champs multilignes (`textarea`) pour "Syntonisation", "Problématique" et "LDT" réorganisés verticalement.
* **Aura** : Liste de contrôle disposée en colonnes. "Technique du filet" figure dans les étapes globales et déploie ses sous-options si cochée. "Repolarisation du corps" est placée dans les soins spécifiques.
* **Séances Externes (Praticiens tiers)** : Formulaire dédié accessible sur la fiche animal permettant de saisir les comptes-rendus d'autres praticiens (Ostéopathe, Maréchal, Vétérinaire, etc.). Gère la date, le motif, le résumé libre, et l'import de documents joints (images ou PDF) encodés en base64. S'intercale chronologiquement dans l'historique de l'animal sous forme de carte à badge bleu distinctif.

### 4. Schéma d'Annotations (2 Vues Anatomiques)
* Calque de dessin transparent `<canvas>` superposé à l'image anatomique à 2 vues du cheval (vue gauche et vue droite) pour une annotation extrêmement précise.
* Outils de dessin avec palette de couleurs (rétablissant la taille du pinceau courante lors du clic), retour arrière (Undo), effacement total (incluant la purge de l'historique), et curseur de pinceau réglé à **2px par défaut** pour toutes les couleurs.
* **Transparence intelligente** : Application d'une légère transparence de 30% (70% d'alpha) sur les tracés de toutes les couleurs pour laisser voir les structures osseuses et musculaires en dessous.
* **Mode Gomme intelligent** : Augmente automatiquement la taille du curseur à **20px** lorsqu'il est activé, et le ramène à la valeur du pinceau active quand l'utilisateur repasse en mode couleur (avec opacité réglée à 100% pour effacer proprement).

### 5. Consultation de Séance & Espace Praticienne
* **Fiche d'identité** : Affiche l'âge dynamique (ex: "8 ans") au lieu de la date de naissance, mentionne le "Mode de vie" au lieu du "Lieu de vie", et affiche clairement le "Mode de suivi". Dispose de boutons de retour doubles (permanent et contextuel — incluant la redirection vers les professionnels s'il provient de l'annuaire des pros), d'un raccourci d'ajout de rappel direct (avec pré-remplissage et verrouillage), de cartes de rappels harmonisées par couleur d'état (vert/bleu/rouge) et cliquables pour une édition/report instantané avec rafraîchissement réactif de la vue. Permet également d'ajouter directement un événement médical dans l'historique de l'animal via un bouton dédié, avec classement chronologique décroissant automatique (année et mois) et rafraîchissement instantané.
* **Visualisation du schéma d'annotation** : L'affichage du dessin d'annotation fusionné conserve ses proportions d'origine 3:2 (`aspect-ratio: 600 / 400` et `object-fit: contain`) pour éviter toute déformation ou compression à l'écran comme sur l'impression.
* **Espace Praticienne (Privé)** : Le bloc classique du Résumé de séance client est retiré de l'écran pour afficher directement le **CR Métier Détaillé** à l'ouverture d'une séance. Il respecte strictement l'ordre d'affichage suivant : (1) Notes d'observation de début de séance, (2) Protocoles réalisés avec leurs détails techniques (abréviations Shiatsu, Tenségrité complet, Cranio, Kinésio, Aura) et le schéma anatomique annoté intégré directement, (3) Notes cliniques privées / observations, et (4) Précisions générales de la séance. Un bouton permet de remplir le questionnaire de suivi à 3 semaines dans un modal dialog.
* **Impression Propre / PDF (Fichier autonome)** : Le bouton **"📄 Voir le CR"** sur la carte de séance ou sur la page de consultation ouvre la page propre du CR imprimable dans un **nouvel onglet** (`_blank`), agissant comme une pièce jointe de synthèse. Cette page `#sessions/:id/print` est mise en forme sous forme de document autonome épuré (style feuille A4 blanche centrée sur fond sombre neutre, sans sidebar de navigation, sans menu CRM, sans bouton d'interface, et sans le bloc Historique des séances). L'impression système n'est pas forcée. Les éléments du document sont ordonnés ainsi : En-tête "Compte-Rendu de Séance - eKiKare", Infos Client/Animal/Date, Motif, Résumé de séance, Schéma d'annotations anatomique (masqué si vide), Précisions générales de la séance (si renseignées), et la Mention légale en pied de page.

### 6. Relances et Rappels Multiples & Gestion des Tâches
* **Multiples rappels par séance** : Permet de planifier dynamiquement **0, 1, 2 ou plus** rappels de suivi indépendants (ex: un rappel pour prendre des nouvelles + un rappel pour fixer un RDV) grâce à un bouton "+ Ajouter un autre rappel".
* **Gestion complète des Rappels / Tâches & Recherche Élargie** : Bouton d'ajout manuel sur l'onglet Rappels. Intègre un filtre de recherche standard en temps réel qui recherche simultanément (insensible à la casse et aux accents) sur le titre, le motif, les notes, la description, le nom de l'animal et le nom/prénom du propriétaire. Un formulaire modal permet de renseigner l'intitulé (libre ou prédéfini), l'animal et le propriétaire associés, la date d'échéance et des notes. Chaque tâche possède également un bouton "Modifier / Reporter" qui ouvre ce même formulaire pour en ajuster la date d'échéance ou les notes.
* **Formatage temporel** : Les rappels sont regroupés par semaine d'échéance. La semaine actuelle est toujours affichée en émeraude ("Cette semaine") même s'il est vide, tandis que les semaines passées avec tâches en attente s'affichent en rouge d'alerte ("En retard") et les semaines futures en bleu.

### 7. Résumé Client Intelligent
* **Génération de résumé client** : Filtre automatiquement uniquement les protocoles cochés pour composer la note client.
* **Génération automatique à la sauvegarde** : Si l'éditeur de résumé est laissé vide, le résumé est auto-généré à l'enregistrement sans écraser les modifications manuelles saisies par l'utilisateur.

### 8. Améliorations de Lisibilité & Contrastes
* **Menus déroulants (<select>)** : Tous les menus déroulants et leurs choix d'options sont stylisés avec un fond sombre (#1e1e2f) et une couleur de police blanche pour assurer une lisibilité et un contraste parfaits sur tous les navigateurs et systèmes d'exploitation.
* **Ergonomie des Dialogues** : Les fenêtres modales (.app-dialog) intègrent une limitation de hauteur (max-height: 90vh) avec défilement vertical et interdiction de défilement horizontal. Les grilles de formulaires internes se réorganisent automatiquement en colonnes fluides sur petits écrans ou modales étroites.

### 9. Portail / Espace Client Sécurisé (Lot 3)
* **Partage Sécurisé** : Un bouton **"🔗 Lien Espace Client"** sur les fiches praticien permet de copier une URL personnalisée (format `/#portal/:clientId`) pour le propriétaire.
* **Interface Épurée & Confidentialité** : La sidebar globale, le dashboard CRM, l'annuaire des professionnels, et les relances de rappels/tâches sont entièrement masqués. Les champs techniques comme le "Mode de suivi", la "Distance", les "Notes internes" et les "Notes cliniques privées" sont cachés. Le client ne peut voir que les résumés client des séances et les documents d'annotations via le bouton **"📄 Voir le CR"**.
* **Anti-scintillement (FOUC)** : Un script d'interception inline dans la balise `<head>` applique immédiatement la classe `portal-mode` si l'URL contient `#portal`, masquant la sidebar et ré-organisant la disposition dès le parsing HTML/CSS avant même le démarrage de JavaScript.
* **Droits Client** : Le client peut modifier ses coordonnées (Téléphone, E-mail, Adresse, Écurie principale), ajouter un nouvel animal via le bouton **"+ Ajouter un animal"** (avec propriétaire automatiquement verrouillé sur son ID et champs praticiens masqués), et mettre à jour les fiches de ses animaux (Alimentation, Hébergement/Mode de vie, Objectifs). Il dispose également du droit d'ajouter, modifier et supprimer ses séances externes (vétérinaire, ostéopathe, maréchal, etc.) pour compléter son carnet de suivi.

---

## 📂 Structure de la Base IndexedDB (`eKiKareDB`)

L'application utilise 5 magasins d'objets (tables) :

1. **`clients`** :
   * `id` (Clé primaire auto-incrémentée)
   * `nom`, `prenom`, `telephone`, `email`, `adresse`, `ecurie`, `notes`
2. **`professionals`** :
   * `id` (Clé primaire auto-incrémentée)
   * `nom`, `prenom`, `telephone`, `specialite`, `notes`
3. **`animals`** :
   * `id` (Clé primaire auto-incrémentée)
   * `client_id` (Indexé pour lier le propriétaire)
   * `nom`, `espece`, `race`, `sexe`, `robe`, `date_naissance_ou_age`, `photo_blob`, `stable_name`, `stable_address`, `stable_zip`, `stable_city`, `stable_distance`, `stable_at_home`, `lieu_de_vie` (conservé pour rétrocompatibilité), `housing_type`, `housing_type_other`, `social_type`, `housing_mode` (conservé pour rétrocompatibilité), `lifestyle_details` (précisions de mode de vie pour les non-équidés), `antecedents`, `pros_associes_ids` (tableau d'identifiants de professionnels)
4. **`sessions`** :
   * `id` (Clé primaire auto-incrémentée)
   * `animal_id` (Indexé), `client_id` (Indexé)
   * `date_seance`, `motif`, `notes_observations`, `n_seance_annee`, `q_avant_seance` (objet), `q_3_semaines` (objet), `protocoles_realises` (objet), `canvas_annotation_image_blob` (DataURL fusionné), `canvas_drawing_data_url` (tracé transparent), `cr_personnel`, `delai_prochaine_seance`, `resume_client_genere`
   * Pour les séances externes (`isExternal: true`) : `practitionerName` (nom du praticien), `profession` (spécialité), `summary` (observations/prescriptions), `fileData` (fichier joint en base64), `fileName` (nom du fichier), `fileType` (type de fichier)
5. **`reminders`** :
   * `id` (Clé primaire auto-incrémentée)
   * `animal_id` (Indexé), `client_id`, `session_id`
   * `date_prevue` (Indexée), `semaine_prevue`, `type_rappel` (`prendre_des_nouvelles` | `prendre_rdv`), `statut` (`en_attente` | `fait`), `notes`, `delay`
6. **`deleted_records`** :
   * `id` (Clé primaire auto-incrémentée)
   * `storeName` (Nom de la table de l'enregistrement supprimé)
   * `recordId` (ID numérique de l'enregistrement supprimé)
   * *Utilisée pour synchroniser les suppressions de données effectuées hors-ligne lors du retour de la connexion.*

---

## 🔄 Synchronisation Hybride (Supabase)

L'application utilise une architecture **Offline-First** optimisée :
* **IndexedDB** demeure la source locale immédiate de vérité. Toutes les écritures et suppressions s'y effectuent instantanément, garantissant un usage 100% opérationnel hors-ligne.
* Chaque enregistrement des tables synchronisées possède deux attributs techniques : `last_modified` (horodatage du dernier changement) et `synced` (état de synchronisation, `0` ou `1`).
* **Envoi Temps Réel (Push)** : Lorsque l'appareil est connecté (`navigator.onLine`), chaque modification locale est immédiatement envoyée à Supabase via `upsert`. Si l'upsert réussit, le champ local `synced` passe à `1`.
* **Suppressions en attente** : Les suppressions d'éléments effectuées hors-ligne sont enregistrées dans la table `deleted_records`. Dès le retour en ligne, l'application exécute ces suppressions sur Supabase et vide la file d'attente.
* **Récupération & Résolution des Conflits (Pull)** : Au chargement initial de l'application ou lors d'une reconnexion (événement `online`), l'application télécharge les données de Supabase et les fusionne. Si un conflit survient, l'horodatage `last_modified` détermine la version gagnante (la plus récente l'emporte).
* **Indicateur d'État** : Un badge interactif glassmorphism dans l'en-tête indique l'état réseau et de synchronisation :
  * 🟢 **En ligne / Synchronisé** : Connecté au serveur et données à jour.
  * 🔵 **Synchronisation...** : Processus d'échange de données en cours.
  * 🟠 **Hors-ligne - Données locales** : Fonctionnement autonome sur base locale.

---

## 🛠️ Installation et Exécution Locale

Pour lancer l'application en mode local :

1. Ouvrez une console PowerShell dans le dossier du projet : `C:\Users\karel\.gemini\antigravity-ide\scratch\suivi-ekikare`
2. Exécutez le script serveur fourni :
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\serve.ps1
   ```
3. Ouvrez votre navigateur internet et naviguez vers l'adresse : [http://localhost:8000](http://localhost:8000)

*(Note : Toutes les données saisies restent stockées localement dans votre propre navigateur. Aucun transfert externe n'est effectué pour respecter la confidentialité de votre clientèle.)*
