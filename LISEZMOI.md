# Site de l'île Wuhu — ce qu'il reste à faire

Le site fonctionne **sans bot** : à la connexion, chaque membre autorise le site à lire ses rôles
sur le serveur (écran d'autorisation Discord, une seule fois).

## Déjà fait
- Base de données (tables `wuhu_…`) et sécurité dans ton projet Supabase principal.
- Fonction `wuhu-sync-discord` (lit les rôles au moment de la connexion).
- Serveur `998328199488471060` et rôle admin `998346777482768384` enregistrés.
- `config.js` rempli.

## À faire (environ 10 min)

### 1. Créer l'application de connexion Discord (ce n'est pas un bot)
1. https://discord.com/developers/applications → **New Application** → nom « Île Wuhu ».
2. Onglet **OAuth2** :
   - copie le **Client ID** et le **Client Secret** (« Reset Secret ») ;
   - dans **Redirects**, ajoute `https://zpxkizajcgyshtqzahrq.supabase.co/auth/v1/callback` et enregistre.
   Tu n'as rien à faire dans l'onglet Bot.

### 2. Activer Discord dans Supabase
https://supabase.com/dashboard/project/zpxkizajcgyshtqzahrq/auth/providers
→ **Discord** : active-le, colle le Client ID et le Client Secret, enregistre.

### 3. Autoriser l'adresse du site
https://supabase.com/dashboard/project/zpxkizajcgyshtqzahrq/auth/url-configuration
→ **Redirect URLs** : ajoute l'adresse de ton site GitHub Pages (ex. `https://ton-pseudo.github.io/ile-wuhu/`).
⚠️ Ne change pas le « Site URL » : il sert à ton autre site.

### 4. Mettre en ligne
Envoie les fichiers sur un dépôt GitHub (sans le dossier `supabase`), puis
**Settings > Pages > Deploy from a branch > main**.

### 5. Nommer les rôles
Connecte-toi, puis va dans l'onglet **Rôles** (visible par les admins). Chaque rôle apparaît
avec la liste des membres qui l'ont : donne-lui un nom et une couleur, puis clique sur **Enregistrer**.
Un rôle apparaît dès qu'un membre qui le possède s'est connecté au site.

---

## Bon à savoir
- Les rôles d'un membre sont mis à jour à chaque connexion. Sur son profil, le bouton
  **« Actualiser mes rôles »** permet de le faire tout de suite.
- Pour ajouter un autre rôle admin, demande-moi : il suffit d'ajouter son identifiant dans le réglage `admin_role_ids`.
- **Admins** : créer un tournoi, **Lancer le tournoi**, cliquer sur un match pour entrer le score.
  L'arbre avance tout seul et se met à jour en direct chez tout le monde.
- Seuls les membres du serveur voient le contenu du site.
