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

  constructor(private vesselService: VesselService) {
    this.vesselService.vessels$.subscribe(vessels => {
      this.clearVesselSubs();
      vessels.forEach(vessel => {
        const sub = vessel.state$.subscribe(state => {
          if (state?.battleStarted && !this.enabled$.value) {
            this.start();
          }
        });
        this.vesselSubs.push(sub);
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

      switch (state.role) {
        case 'fighter':          this.tickFighter(vessel);          break;
        case 'survivor':         this.tickSurvivor(vessel);         break;
        case 'miner':            this.tickMiner(vessel);            break;
        case 'collector':        this.tickCollector(vessel);        break;
        case 'smart_aggressive': this.tickSmartAggressive(vessel);  break;
      }
    });
  }

  // ── Combattant : ressources puis ennemis ──────────────────────────────────
  private tickFighter(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);

    const enemies   = scanned.filter(s => s.what === 'vessel');
    const resources = scanned.filter(s => s.what === 'resource');

    if (enemies.length > 0 && energy >= 10) {
      this.shootAt(vessel, enemies[0], energy);
      return;
    }
    if (resources.length > 0 && energy >= 5) {
      this.moveToward(vessel, this.closest(resources));
      return;
    }
    this.explore(vessel, energy);
  }

  // ── Survivant : fuit dès qu'un danger est détecté ────────────────────────
  private tickSurvivor(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);

    const dangers = scanned.filter(s =>
      s.what === 'vessel' || s.what === 'torpedo' || s.what === 'mine' || s.what === 'explosion'
    );

    if (dangers.length > 0 && energy >= 5) {
      // Fuir dans la direction opposée au danger le plus proche
      const threat = this.closest(dangers);
      const fx = -Math.sign(threat.position[0]);
      const fy = -Math.sign(threat.position[1]);
      vessel.move(fx || 1, fy || 1); // fallback si sur la même case
      return;
    }

    // Pas de danger : scanner et récupérer des ressources
    const resources = scanned.filter(s => s.what === 'resource');
    if (resources.length > 0 && energy >= 5) {
      this.moveToward(vessel, this.closest(resources));
      return;
    }
    this.explore(vessel, energy);
  }

  // ── Poseur de mines : pose une mine puis se déplace ──────────────────────
  private tickMiner(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);
    const state = vessel.state$.value!;

    // Fuir si une torpille ou explosion est détectée
    const imminent = scanned.filter(s => s.what === 'torpedo' || s.what === 'explosion');
    if (imminent.length > 0 && energy >= 5) {
      const threat = this.closest(imminent);
      vessel.move(-Math.sign(threat.position[0]) || 1, -Math.sign(threat.position[1]) || 1);
      return;
    }

    // Poser une mine si énergie suffisante (une mine toutes les ~3 ticks)
    if (energy >= 10 && Math.random() < 0.4) {
      vessel.dropMine(3.0);
    }

    // Se déplacer en continu dans une direction quasi-constante
    // On utilise l'ID du vaisseau pour avoir une direction déterministe
    const seed  = state.id.charCodeAt(state.id.length - 1) % 8;
    const dirs: [number, number][] = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
    const [dx, dy] = dirs[seed];
    if (energy >= 5) vessel.move(dx, dy);
  }

  // ── Collecteur : ressources d'abord, tir en dernier recours ─────────────
  private tickCollector(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);

    const resources = scanned.filter(s => s.what === 'resource');
    const enemies   = scanned.filter(s => s.what === 'vessel');

    // Priorité absolue : ressources
    if (resources.length > 0 && energy >= 5) {
      this.moveToward(vessel, this.closest(resources));
      return;
    }

    // Scanner pour trouver des ressources
    if (energy >= 5 && scanned.length === 0) {
      vessel.scanRadar();
      return;
    }

    // Tirer uniquement si pas de ressource visible et ennemi proche
    if (enemies.length > 0 && energy >= 10) {
      const enemy = this.closest(enemies);
      const dist  = Math.abs(enemy.position[0]) + Math.abs(enemy.position[1]);
      if (dist <= 3) {
        this.shootAt(vessel, enemy, energy);
        return;
      }
    }

    this.explore(vessel, energy);
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

  private getContext(vessel: VesselConnection): { scanned: ScannedObject[]; energy: number } {
    const state = vessel.state$.value!;
    const now   = Date.now();
    return {
      scanned: state.scanned.filter(s => s.ts > now),
      energy:  state.energy
    };
  }

  private explore(vessel: VesselConnection, energy: number): void {
    if (energy < 5) return;
    const state = vessel.state$.value!;
    if (state.scanned.length === 0) {
      vessel.scanRadar();
      return;
    }
    const dirs: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
    vessel.move(dx, dy);
  }

  private moveToward(vessel: VesselConnection, target: ScannedObject): void {
    vessel.move(Math.sign(target.position[0]), Math.sign(target.position[1]));
  }

  private shootAt(vessel: VesselConnection, enemy: ScannedObject, energy: number): void {
    const [dx, dy] = enemy.position;
    if (energy >= 50 && (dx === 0 || dy === 0)) {
      vessel.fireLaser(Math.sign(dx), Math.sign(dy));
    } else if (energy >= 10) {
      vessel.fireTorpedo(Math.sign(dx), Math.sign(dy));
    }
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
