import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import { VesselService, VesselConnection } from './vessel.service';
import { ScannedObject, VesselRole } from '../models/protocol.models';
import { SmartNavigation, Point2D } from './smart-navigation';

const TICK_MS = 1500;

@Injectable({ providedIn: 'root' })
export class AutoPilotService implements OnDestroy {

  enabled$ = new BehaviorSubject<boolean>(false);

  private interval: any;
  private vesselSubs: Subscription[] = [];

  // IDs des vaisseaux de notre équipe (extraits des passive_scan)
  private friendlyIds = new Set<string>();

  constructor(private vesselService: VesselService) {
    this.vesselService.vessels$.subscribe(vessels => {
      this.clearVesselSubs();

      // Collecter les IDs amis depuis les messages passive_scan de chaque vaisseau
      vessels.forEach(vessel => {
        const stateSub = vessel.state$.subscribe(state => {
          if (state?.battleStarted && !this.enabled$.value) this.start();
        });

        const msgSub = vessel.messages$.subscribe(msg => {
          if (msg.type === 'passive_scan' && msg.what === 'move' && (msg as any).vessel) {
            const vid: string = (msg as any).vessel;
            // Format "Equipe:N" — on compare avec nos propres IDs
            const ownPrefix = vessel.state$.value?.id.split(':').slice(0, 1).join(':');
            if (ownPrefix && vid.startsWith(ownPrefix)) {
              this.friendlyIds.add(vid);
            }
          }
        });

        this.vesselSubs.push(stateSub, msgSub);
      });

      // Ajouter nos propres vaisseaux comme amis
      vessels.forEach(v => {
        const id = v.state$.value?.id;
        if (id) {
          // "Equipe:1:secret" → on garde "Equipe:1" pour la comparaison
          const shortId = id.split(':').slice(0, 2).join(':');
          this.friendlyIds.add(shortId);
        }
      });
    });
  }

  toggle(): void {
    this.enabled$.value ? this.stop() : this.start();
  }

  private start(): void {
    this.enabled$.next(true);
    clearInterval(this.interval);
    this.interval = setInterval(() => this.tick(), TICK_MS);
  }

  private stop(): void {
    this.enabled$.next(false);
    clearInterval(this.interval);
  }

  private tick(): void {
    this.vesselService.getAll().forEach(vessel => {
      const state = vessel.state$.value;
      if (!state || !state.battleStarted || state.frozen) return;

      // Mettre à jour les amis avec nos propres vaisseaux
      const shortId = state.id.split(':').slice(0, 2).join(':');
      this.friendlyIds.add(shortId);

      switch (state.role) {
        case 'fighter':          this.tickFighter(vessel);          break;
        case 'survivor':         this.tickSurvivor(vessel);         break;
        case 'miner':            this.tickMiner(vessel);            break;
        case 'collector':        this.tickCollector(vessel);        break;
        case 'smart_aggressive': this.tickSmartAggressive(vessel);  break;
      }
    });
  }

  // ── Combattant ────────────────────────────────────────────────────────────
  private tickFighter(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);

    const enemies   = this.getEnemies(scanned);
    const resources = scanned.filter(s => s.what === 'resource');

    if (enemies.length > 0 && energy >= 10) {
      this.shootAt(vessel, enemies[0], energy);
      return;
    }
    if (resources.length > 0 && energy >= 5) {
      this.moveSafe(vessel, this.closest(resources), scanned);
      return;
    }
    this.explore(vessel, energy, scanned);
  }

  // ── Survivant : fuit tout danger ──────────────────────────────────────────
  private tickSurvivor(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);

    const dangers = this.getDangers(scanned);
    if (dangers.length > 0 && energy >= 5) {
      const threat = this.closest(dangers);
      const fx = -Math.sign(threat.position[0]) || (Math.random() > 0.5 ? 1 : -1);
      const fy = -Math.sign(threat.position[1]) || (Math.random() > 0.5 ? 1 : -1);
      vessel.move(fx, fy);
      return;
    }

    const resources = scanned.filter(s => s.what === 'resource');
    if (resources.length > 0 && energy >= 5) {
      this.moveSafe(vessel, this.closest(resources), scanned);
      return;
    }
    this.explore(vessel, energy, scanned);
  }

  // ── Poseur de mines ───────────────────────────────────────────────────────
  private tickMiner(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);
    const state = vessel.state$.value!;

    // Fuir les dangers immédiats
    const imminent = scanned.filter(s => s.what === 'torpedo' || s.what === 'explosion');
    if (imminent.length > 0 && energy >= 5) {
      const threat = this.closest(imminent);
      vessel.move(-Math.sign(threat.position[0]) || 1, -Math.sign(threat.position[1]) || 1);
      return;
    }

    // Poser une mine
    if (energy >= 10 && Math.random() < 0.4) {
      vessel.dropMine(3.0);
    }

    // Direction constante basée sur l'ID
    if (energy >= 5) {
      const seed  = state.id.charCodeAt(state.id.length - 1) % 8;
      const dirs: [number, number][] = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
      const [dx, dy] = dirs[seed];
      // Vérifier que la direction est sûre avant de bouger
      const blocked = this.isDangerous([dx, dy], scanned);
      if (blocked) {
        vessel.move(-dx || 1, -dy || 1); // demi-tour si bloqué
      } else {
        vessel.move(dx, dy);
      }
    }
  }

  // ── Collecteur ────────────────────────────────────────────────────────────
  private tickCollector(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);

    const resources = scanned.filter(s => s.what === 'resource');
    const enemies   = this.getEnemies(scanned);

    if (resources.length > 0 && energy >= 5) {
      this.moveSafe(vessel, this.closest(resources), scanned);
      return;
    }
    if (energy >= 5 && scanned.length === 0) {
      vessel.scanRadar();
      return;
    }
    // Tir uniquement si ennemi très proche
    if (enemies.length > 0 && energy >= 10) {
      const enemy = this.closest(enemies);
      if (Math.abs(enemy.position[0]) + Math.abs(enemy.position[1]) <= 3) {
        this.shootAt(vessel, enemy, energy);
        return;
      }
    }
    this.explore(vessel, energy, scanned);
  }

  // ── Chasseur intelligent : smart move + agressif ──────────────────────────────
  private tickSmartAggressive(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);

    // Obstacles solides à éviter (mines, astéroïdes, torpilles)
    const obstacles: Point2D[] = scanned
      .filter(s => ['asteroid', 'mine', 'torpedo'].includes(s.what as string))
      .map(s => s.position as Point2D);

    const enemies  = scanned.filter(s => s.what === 'vessel' || s.what === 'move');
    const origin: Point2D = [0, 0];

    // — ATTAQUE en priorité si un ennemi est visible ——————————————————————
    if (enemies.length > 0 && energy >= 10) {
      const target = this.closest(enemies);
      const [tx, ty] = target.position;
      const sdx = Math.sign(tx);
      const sdy = Math.sign(ty);

      // Laser si énergie suffisante et ennemi aligné (ligne droite : horizontal/vertical/diagonal)
      const aligned = tx === 0 || ty === 0 || Math.abs(tx) === Math.abs(ty);
      if (energy >= 50 && aligned) {
        vessel.fireLaser(sdx || 1, sdy || 1);
        return;
      }

      // IEM si ennemi très proche (distance de Manhattan <= 2) et énergie suffisante
      const manhattan = Math.abs(tx) + Math.abs(ty);
      if (energy >= 30 && manhattan <= 2) {
        vessel.fireIem(sdx || 1, sdy || 1);
        return;
      }

      // Torpille sinon
      if (energy >= 10) {
        vessel.fireTorpedo(sdx || 1, sdy || 1);
      }
    }

    // — MOUVEMENT INTELLIGENT vers l'ennemi le plus proche (ou exploration) —
    if (energy >= 5) {
      // Vitesse maximale basée sur les stats du vaisseau (stats[0]) ou 5 par défaut
      const state = vessel.state$.value!;
      const maxSpeed = state.stats?.[0] ?? 5;

      let target: Point2D;
      if (enemies.length > 0) {
        target = this.closest(enemies).position as Point2D;
      } else if (scanned.length === 0) {
        // Rien de visible : scanner
        vessel.scanRadar();
        return;
      } else {
        // Explorer aléatoirement
        const dirs: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
        const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
        vessel.move(dx * maxSpeed, dy * maxSpeed);
        return;
      }

      // Calcul du meilleur mouvement avec SmartNavigation
      const [dx, dy] = SmartNavigation.getNextMoveGreedy(
        origin,
        target,
        obstacles,
        maxSpeed,
        /* obstacleRadius */ 4.0,
        /* numAngles */ 32
      );

      if (dx !== 0 || dy !== 0) {
        vessel.move(dx, dy);
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // ── Déplacement sécurisé : évite les cases dangereuses ───────────────────
  private moveSafe(vessel: VesselConnection, target: ScannedObject, scanned: ScannedObject[]): void {
    const dx = Math.sign(target.position[0]);
    const dy = Math.sign(target.position[1]);


    // Essayer la direction directe d'abord
    if (!this.isDangerous([dx, dy], scanned)) {
      vessel.move(dx, dy);
      return;
    }

    // Essayer des directions alternatives (contournement)
    const alternatives: [number, number][] = [
      [dx, 0], [0, dy],           // axes séparés
      [dx, -dy], [-dx, dy],       // diagonales alternatives
      [-dx, 0], [0, -dy],         // opposés partiels
      [-dx, -dy]                  // demi-tour complet
    ];

    for (const [ax, ay] of alternatives) {
      if ((ax !== 0 || ay !== 0) && !this.isDangerous([ax, ay], scanned)) {
        vessel.move(ax, ay);
        return;
      }
    }

    // Aucune direction sûre : rester sur place (scan)
    vessel.scanRadar();
  }

  // Vérifie si une direction mène vers un objet dangereux à 1-2 cases
  private isDangerous(dir: number[], scanned: ScannedObject[]): boolean {
    return scanned.some(s => {
      if (!this.isDangerousObject(s.what as string)) return false;
      // L'objet est dans la direction du déplacement et proche
      const sameDir = Math.sign(s.position[0]) === Math.sign(dir[0]) || Math.sign(s.position[1]) === Math.sign(dir[1]);
      const close   = Math.abs(s.position[0]) <= 2 && Math.abs(s.position[1]) <= 2;
      return sameDir && close;
    });
  }

  private isDangerousObject(what: string): boolean {
    return ['vessel', 'torpedo', 'mine', 'explosion','asteroid'].includes(what);
  }

  // ── Tir : ne tire jamais sur un ami ──────────────────────────────────────
  private shootAt(vessel: VesselConnection, enemy: ScannedObject, energy: number): void {
    // Vérifier que la cible n'est pas un ami
    // (les vaisseaux amis sont identifiés via passive_scan)
    if (this.isFriendlyPosition(enemy.position, vessel)) return;

    const [dx, dy] = enemy.position;
    if (energy >= 50 && (dx === 0 || dy === 0)) {
      vessel.fireLaser(Math.sign(dx), Math.sign(dy));
    } else if (energy >= 10) {
      vessel.fireTorpedo(Math.sign(dx), Math.sign(dy));
    }
  }

  // Vérifie si un autre de nos vaisseaux est dans cette direction
  private isFriendlyPosition(position: number[], shooter: VesselConnection): boolean {
    return this.vesselService.getAll().some(v => {
      if (v === shooter) return false;
      const s = v.state$.value;
      if (!s) return false;
      // Un ami est dans la même direction si ses coords relatives sont alignées
      return Math.sign(s.scanned[0]?.position[0] ?? 999) === Math.sign(position[0])
          && Math.sign(s.scanned[0]?.position[1] ?? 999) === Math.sign(position[1]);
    });
  }

  private getEnemies(scanned: ScannedObject[]): ScannedObject[] {
    return scanned.filter(s => {
      if (s.what !== 'vessel') return false;
      // Exclure si l'objet scanné correspond à un ami connu
      return !this.isFriendlyScannedObject(s);
    });
  }

  private isFriendlyScannedObject(_obj: ScannedObject): boolean {
    // Sans info de nom sur active_scan, on ne peut pas identifier avec certitude.
    // On se fie aux passive_scan pour alimenter friendlyIds.
    // Par défaut on considère tout vessel scanné comme ennemi potentiel.
    return false;
  }

  private getDangers(scanned: ScannedObject[]): ScannedObject[] {
    return scanned.filter(s => this.isDangerousObject(s.what as string));
  }

  // ── Exploration ───────────────────────────────────────────────────────────
  private explore(vessel: VesselConnection, energy: number, scanned: ScannedObject[]): void {
    if (energy < 5) return;
    if (scanned.length === 0) { vessel.scanRadar(); return; }

    const dirs: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    const safe = dirs.filter(d => !this.isDangerous(d, scanned));
    const pick  = safe.length > 0 ? safe : dirs;
    const [dx, dy] = pick[Math.floor(Math.random() * pick.length)];
    vessel.move(dx, dy);
  }

  private getContext(vessel: VesselConnection): { scanned: ScannedObject[]; energy: number } {
    const state = vessel.state$.value!;
    const now   = Date.now();
    return { scanned: state.scanned.filter(s => s.ts > now), energy: state.energy };
  }

  private closest(objects: ScannedObject[]): ScannedObject {
    return objects.reduce((best, cur) => {
      const distCur  = Math.abs(cur.position[0]) + Math.abs(cur.position[1]);
      const distBest = Math.abs(best.position[0]) + Math.abs(best.position[1]);
      return distCur < distBest ? cur : best;
    });
  }

  private clearVesselSubs(): void {
    this.vesselSubs.forEach(s => s.unsubscribe());
    this.vesselSubs = [];
  }

  ngOnDestroy(): void {
    this.stop();
    this.clearVesselSubs();
  }
}
