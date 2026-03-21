# 🐜 Marabunta Front — 24h du Code 2026

Interface Angular pour le jeu de bataille spatiale de la HAUM.

## Installation

```powershell
# 1. Installer Node.js LTS depuis https://nodejs.org
# 2. Installer Angular CLI
npm install -g @angular/cli

# 3. Installer les dépendances
npm install

# 4. Lancer
ng serve
# → http://localhost:4200
```

## Structure du projet

```
src/app/
├── models/
│   └── protocol.models.ts          ← tous les types du protocole WebSocket
├── services/
│   ├── websocket.service.ts        ← connexion WS principale (flotte)
│   └── vessel.service.ts           ← une connexion WS par vaisseau
└── components/
    ├── setup/                      ← configuration équipe + vaisseaux
    │   ├── setup.component.ts
    │   ├── setup.component.html
    │   └── setup.component.scss
    ├── grid/                       ← grille de jeu + contrôles
    │   ├── grid.component.ts
    │   ├── grid.component.html
    │   └── grid.component.scss
    ├── fleet-panel/                ← état de la flotte
    │   ├── fleet-panel.component.ts
    │   ├── fleet-panel.component.html
    │   └── fleet-panel.component.scss
    └── event-log/                  ← journal des événements
        ├── event-log.component.ts
        ├── event-log.component.html
        └── event-log.component.scss
```

## Protocole

- **1 connexion WS principale** : enregistrement de la flotte (`start`)
- **1 connexion WS par vaisseau** : commandes et événements (`connect`)
- La grille affiche les positions **relatives** au vaisseau sélectionné
- L'énergie se régénère de 4/s localement (estimation)

## Commandes disponibles

| Bouton | Action | Coût |
|--------|--------|------|
| D-pad / clic cellule | move | 5 ⚡ |
| 📡 | scan_radar | 5 ⚡ |
| 🔥 Torpille | fire_torpedo | 10 ⚡ |
| ⚡ Laser | fire_laser | 50 ⚡ |
| 🧊 IEM | fire_iem | 30 ⚡ |
| 💣 Mine | drop_mine | 10 ⚡ |
| 💥 Autodestruction | autodestruction | — |
| 🏓 Ping | ping | — |
