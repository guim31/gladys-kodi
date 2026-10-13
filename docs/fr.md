# Kodi

Suivez et pilotez [Kodi](https://kodi.tv), le media center libre (LibreELEC, OSMC, CoreELEC,
Kodi sur PC, sur une box Android TV ou une NVIDIA Shield), depuis Gladys : ce qui est en lecture,
sa progression, le volume, les boutons de lecture, et des scènes qui réagissent quand un film
démarre, se met en pause ou s'arrête.

Tout reste sur votre réseau local : l'intégration parle directement à Kodi, par son interface
JSON-RPC.

Testée avec Kodi 20 et 21 dans Docker, pas encore sur LibreELEC, OSMC, CoreELEC ou une box
Android : vos retours sont les bienvenus sur le forum de Gladys.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Kodi 19 ou plus récent (testé sur 20 et 21), sur le même réseau local que Gladys.
- Dans Kodi, **Paramètres → Services → Contrôle** :
  - **Autoriser le contrôle à distance via HTTP** : activé. Notez le port (8080 par défaut), le
    nom d'utilisateur (`kodi` par défaut) et le mot de passe, si vous en avez mis un.
  - **Autoriser le contrôle à distance depuis des applications sur d'autres systèmes** : activé.
    Cela ouvre le port 9090, par lequel Kodi signale à Gladys en temps réel ce qui se passe. Sans
    lui, l'intégration fonctionne quand même mais lit Kodi toutes les 10 secondes.
- Pour être trouvé automatiquement : **Paramètres → Services → Général → Annoncer les services
  aux autres systèmes** activé (c'est le réglage par défaut).
- Donnez une adresse IP fixe à l'appareil qui fait tourner Kodi (réservation DHCP dans votre box).

## Configuration

1. Installez l'intégration depuis le store de Gladys, puis ouvrez son onglet **Configuration**.
2. Cliquez sur **Chercher Kodi sur le réseau** : chaque Kodi trouvé prend un emplacement libre
   (trois au plus). Rechargez la page pour voir leurs adresses. Ou saisissez l'adresse vous-même,
   par exemple `192.168.1.40`, ou `192.168.1.40:8081` si le serveur web de Kodi n'utilise pas le
   port 8080.
3. Si Kodi demande un mot de passe, renseignez le **Nom d'utilisateur** (vide veut dire `kodi`) et
   le **Mot de passe** de l'emplacement, puis enregistrez.
4. **Tester la connexion** : une ligne par Kodi, avec son nom, sa version et ce qu'il fait.
5. Dans l'onglet **Découverte**, ajoutez chaque Kodi à Gladys.

L'option **Langue** choisit la langue des noms de fonctionnalités et des textes créés par
l'intégration (français par défaut). Les noms des fonctionnalités sont fixés à l'ajout de
l'appareil.

Au premier démarrage sans aucune adresse, l'intégration cherche une fois d'elle-même sur le
réseau. Un scan depuis l'onglet Découverte cherche à nouveau.

## L'appareil Kodi

Un appareil par Kodi, nommé comme Kodi se nomme lui-même (Paramètres → Services → Général → Nom
de l'appareil). Le numéro d'emplacement est son identité : un Kodi qui change d'adresse garde son
appareil et son historique.

| Fonctionnalité     | Type          | Contenu                                                     |
| ------------------ | ------------- | ----------------------------------------------------------- |
| Lecture            | texte         | En lecture, En pause, Arrêté, Éteint ou injoignable         |
| En cours           | texte         | `Film (2024)`, `Série S01E02 – Titre`, `Artiste – Chanson`… |
| Type de média      | texte         | Film, Épisode, Musique, Chaîne TV, Vidéo, Aucun             |
| Progression        | pourcentage   | Position dans le média, 0 pour un direct                    |
| Temps restant      | minutes       | Jusqu'à la fin du média, 0 pour un direct                   |
| Volume             | curseur 0–100 | Le volume de Kodi, suit la télécommande                     |
| Lire, Pause        | boutons       | Reprendre, mettre en pause                                  |
| Stop               | bouton        | Arrête la lecture                                           |
| Précédent, Suivant | boutons       | Élément précédent ou suivant de la liste de lecture         |
| Sourdine           | bouton        | Coupe ou rétablit le son                                    |

« Vidéo » désigne ce que Kodi lit hors de sa bibliothèque : un fichier ouvert depuis un dossier,
un flux, une extension. Les films et épisodes de la bibliothèque sont « Film » et « Épisode ».

Kodi signale ses changements en temps réel (port 9090) ; pendant une lecture, la progression est
lue toutes les 10 secondes. Port 9090 fermé, tout est lu toutes les 10 secondes en HTTP.

## Widget du tableau de bord

Le widget **Kodi** (choisissez le Kodi dans ses réglages) affiche la pochette de ce qui est lu
(quand elle vient de la bibliothèque), le titre, le type de média, l'état, la position, l'heure de
fin et le volume. Ses boutons suivent le média : lecture/pause, puis stop (vidéo) ou suivant
(musique), et volume moins / plus par pas de 5 %.

Sans pochette, une jauge de progression prend sa place une fois l'appareil ajouté à Gladys.

## Déclencheurs de scène

| Déclencheur      | Quand                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| Lecture démarrée | Kodi lance un média alors que rien n'était lu, ou le suivant d'une liste |
| Lecture en pause | Kodi se met en pause                                                     |
| Lecture reprise  | Kodi reprend après une pause                                             |
| Lecture arrêtée  | La lecture s'arrête ou arrive à sa fin, et rien ne suit                  |

Chaque déclencheur peut se limiter à un Kodi et à certains types de média (film, épisode,
musique, chaîne TV, autre vidéo). Variables pour les étapes suivantes : **Titre**, **Type de
média**, **Nom du Kodi**, et pour un arrêt, **Arrivé à la fin**.

Entre deux épisodes d'une liste de lecture, Kodi s'arrête puis redémarre en un dixième de
seconde : l'intégration attend 1,5 seconde avant de dire « arrêtée », si bien que l'épisode
suivant est une « lecture démarrée » et que les lumières ne clignotent pas.

Les déclencheurs suivent ce que Kodi fait vraiment, quelle qu'en soit l'origine : la
télécommande, le widget ou une action de scène. Rien ne part pour ce qui était déjà en lecture
au démarrage de l'intégration, ni quand Kodi est éteint.

## Actions de scène

| Action                             | Ce qu'elle fait                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Piloter la lecture                 | Lire, pause, lecture/pause, arrêter, suivant, précédent                              |
| Régler le volume                   | Volume de 0 à 100                                                                    |
| Couper ou rétablir le son          | Couper, rétablir ou inverser                                                         |
| Afficher une notification sur Kodi | Un message avec un titre dans le coin de l'écran                                     |
| Lire un média                      | Un fichier, un dossier ou un flux, par son chemin ou son URL tel que Kodi le connaît |
| Mettre à jour la bibliothèque      | Kodi cherche les nouveaux médias dans ses sources vidéo ou musique                   |
| Lire l'état de Kodi                | État, titre, type de média, progression, minutes restantes, volume                   |

« Piloter la lecture » renvoie **Appliqué** : faux quand rien n'était en lecture, sans faire
échouer la scène. « Lire l'état de Kodi » donne aux étapes suivantes de quoi poser une condition
« continuer seulement si » : état (`off`, `stopped`, `playing`, `paused`), type de média
(`movie`, `episode`, `music`, `tv`, `video`)…

## Exemples de scènes

- **Soirée film** : déclencheur « Lecture démarrée » sur le Kodi du salon, types de média Film et
  Autre vidéo → tamiser les lumières du salon à 10 %. Déclencheur « Lecture en pause » → lumières
  à 50 %. Déclencheur « Lecture reprise » → retour à 10 %. Déclencheur « Lecture arrêtée » →
  lumières à 100 %.
- **Sonnette** : quand on sonne → « Afficher une notification sur Kodi » (« Quelqu'un à la
  porte ») et « Piloter la lecture : pause ».
- **Au lit** : à 23 h 30 → « Lire l'état de Kodi », continuer seulement si l'état vaut `stopped`
  → éteindre la prise de la télévision.
- **Nouveaux téléchargements** : quand votre box de téléchargement signale la fin → « Mettre à
  jour la bibliothèque » (vidéos).

Ne lancez pas de lecture depuis une scène déclenchée par « Lecture démarrée » : elle se
relancerait sans fin.

## Dépannage

- **« pas de réponse (éteint, ou contrôle à distance désactivé) »** : Kodi est éteint, ou
  « Autoriser le contrôle à distance via HTTP » est désactivé, ou l'adresse ou le port est faux.
  Ouvrez `http://<adresse>:8080` dans un navigateur : l'interface web de Kodi (ou sa demande de
  connexion) doit apparaître.
- **« nom d'utilisateur ou mot de passe refusé »** : vérifiez le nom d'utilisateur et le mot de
  passe de Paramètres → Services → Contrôle. Un nom d'utilisateur vide veut dire `kodi`.
- **« mot de passe refusé par le serveur web, pas de pochettes »** : tout fonctionne par le port
  9090, mais les pochettes passent par le serveur web : corrigez le mot de passe.
- **« Tester la connexion » parle de « pas de suivi en direct »** : activez « Autoriser le
  contrôle à distance depuis des applications sur d'autres systèmes ». Le port 9090 de Kodi ne
  se change pas depuis ses menus.
- **Rien trouvé sur le réseau** : activez « Annoncer les services aux autres systèmes », ou
  saisissez l'adresse. La recherche demande que Gladys soit sur le même réseau que Kodi (Docker
  en mode réseau hôte, l'installation habituelle).
- **Pas de pochette dans le widget** : Kodi ne sert que les pochettes de sa bibliothèque ; un
  fichier ouvert depuis un dossier n'en a pas. Une image de plus de 300 Ko n'est pas affichée non
  plus.
- **« Mettre à jour la bibliothèque » ne fait rien** : Kodi ne parcourt que les sources dont le
  type de contenu est défini (Vidéos → Fichiers → la source → Définir le contenu).

## Limites

- Trois Kodi au plus.
- Le port WebSocket est 9090 (celui de Kodi par défaut, modifiable seulement dans
  `advancedsettings.xml`).
- Pas d'allumage ni d'extinction : Kodi ne se réveille pas par son interface. Un Kodi éteint
  affiche « Éteint ou injoignable » et ne déclenche rien.
- Les images (diaporamas) sont ignorées ; quand de la musique joue derrière une vidéo, la vidéo
  l'emporte.
- La pochette s'affiche quand Kodi la sert en moins de 300 Ko (Kodi met en cache les affiches en
  720 px).
- Sans lien avec la Kodi Foundation (XBMC Foundation), propriétaire de la marque Kodi.
