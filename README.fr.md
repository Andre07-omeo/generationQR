# GNVA Sticker Studio

Application de bureau Electron pour composer des autocollants personnalisés depuis une maquette et un fichier CSV. Toute la génération se déroule sur votre ordinateur.

## Compiler l’application

Le ZIP source est organisé pour que `package.json` soit directement dans le dossier extrait. Installez Node.js 22.12 ou plus récent, ouvrez PowerShell dans ce dossier et exécutez :

```powershell
npm install
npm run build:win
```

L’installateur Windows sera créé dans `release/`. Le fichier `COMPILER-WINDOWS.bat` dans le projet peut aussi lancer ces deux commandes.

Pour lancer l’application sans créer l’installateur, utilisez `npm start`. Pour les autres systèmes, lancez la compilation sur le système correspondant :

```bash
npm run build:mac
npm run build:linux
```

La compilation Windows doit normalement être lancée sur Windows et la compilation macOS sur macOS.

## Utilisation

1. Choisissez une maquette en PNG, JPG, TIFF, WebP, SVG ou PDF. Pour un PDF, la première page est importée. Exportez au préalable une maquette InDesign en PDF.
2. Choisissez le CSV GNVA. Les seules colonnes utilisées sont `numeroAffiche` pour le texte imprimé et `urlPublique` pour le QR. Toutes les autres colonnes, y compris `numero`, sont ignorées. Le séparateur virgule, point-virgule ou tabulation est reconnu.
3. Choisissez un dossier de sortie, positionnez le QR et le numéro sur l’aperçu, puis sélectionnez vos formats. Le coin supérieur gauche du QR et le centre du numéro sont exportés exactement aux coordonnées affichées. La maquette importée est normalisée selon son orientation, puis copiée en PNG dans un instantané local sans redimensionnement ; ses dimensions en pixels et son DPI sont conservés pendant la génération.
4. Lancez la génération. Le nouveau dossier `GNVA-*` contient un sous-dossier par format, découpé en tranches de 1 000 autocollants, ainsi qu’un rapport JSON et un fichier CSV des erreurs.

Les lignes doivent avoir une valeur `numeroAffiche` et une URL `http://` ou `https://`. Les URL vers `localhost` ou un réseau privé sont signalées et nécessitent une confirmation avant un lot de test. Remplacez-les par le domaine accessible au public avant d’imprimer et de distribuer les autocollants.

Les fichiers portent le numéro de ligne du CSV afin que deux lignes ayant le même numéro ne s’écrasent pas.

## Capacité et qualité

Les QR utilisent une bibliothèque vectorielle dédiée, une zone blanche de silence conforme, une correction d’erreur renforcée et le logo GNVA au centre. L’application affiche un QR de prévisualisation et bloque le lot si sa taille ne permet pas une lecture fiable pour la première URL. Les URL des autres lignes sont vérifiées pendant le traitement ; les lignes impossibles à encoder à la taille choisie sont signalées dans `erreurs.csv`.

La lecture du CSV et la génération sont en flux continu ; l’application ne garde pas les 100 000 lignes ou images en mémoire. Le nombre de travaux simultanés est réglable entre 1 et 8 et est réduit automatiquement pour les maquettes très grandes afin de limiter l’usage mémoire. Pour plusieurs formats, commencez bas et augmentez seulement si la mémoire et le processeur le permettent.

Le délai dépend du processeur, du disque, des dimensions de la maquette, du nombre de formats et des réglages d’impression. Un délai de quelques minutes ne peut pas être garanti sans mesurer ces conditions. L’indication d’espace disque de l’interface est approximative. Les réglages DPI décrivent la taille d’impression ; ils ne recréent pas les détails absents d’une petite image source. La limite d’entrée est de 180 mégapixels.

## Formats

- JPG : qualité réglable, fond blanc.
- PNG : sans perte.
- TIFF : compression LZW.
- WebP : format compressé pour le web.
- PDF : un autocollant par fichier PDF, image intégrée en haute qualité.
- GIF : image statique, palette limitée à 256 couleurs.
- AVIF : format web compact de haute qualité.

## Sécurité des lots

- Les fichiers sont écrits dans un nouveau dossier d’exécution, sans remplacer les lots précédents.
- Les erreurs de lignes sont consignées dans `erreurs.csv`; les 12 premières apparaissent également dans l’application.
- L’arrêt interrompt les nouveaux autocollants. Les fichiers déjà terminés restent dans le dossier du lot.
- Fermer l’application pendant un lot peut laisser un lot partiel ; consultez son rapport avant de le supprimer.

## Tests

```bash
npm test
```
