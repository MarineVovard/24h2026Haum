import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import { VesselService, VesselConnection } from './vessel.service';
import { ScannedObject } from '../models/protocol.models';

const TICK_MS = 1500;

@Injectable({ providedIn: 'root' })
export class AutoPilotService implements OnDestroy {

  enabled$ = new BehaviorSubject<boolean>(false);

  private interval: any;
  private vesselSubs: Subscription[] = [];
  private friendlyIds = new Set<string>();

  constructor(private vesselService: VesselService) {
    this.vesselService.vessels$.subscribe(vessels => {
      this.clearVesselSubs();

      vessels.forEach(vessel => {
        const stateSub = vessel.state$.subscribe(state => {
          if (state?.battleStarted && !this.enabled$.value) this.start();
        });

        const msgSub = vessel.messages$.subscribe(msg => {
          if (msg.type === 'passive_scan' && msg.what === 'move' && (msg as any).vessel) {
            const vid: string = (msg as any).vessel;
            const ownPrefix = vessel.state$.value?.id.split(':').slice(0, 1).join(':');
            if (ownPrefix && vid.startsWith(ownPrefix)) this.friendlyIds.add(vid);
          }
        });

        this.vesselSubs.push(stateSub, msgSub);
      });

      vessels.forEach(v => {
        const id = v.state$.value?.id;
        if (id) this.friendlyIds.add(id.split(':').slice(0, 2).join(':'));
      });
    });
  }

  toggle(): void { this.enabled$.value ? this.stop() : this.start(); }

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
      this.friendlyIds.add(state.id.split(':').slice(0, 2).join(':'));

      switch (state.role) {
        case 'fighter':   this.tickFighter(vessel);   break;
        case 'survivor':  this.tickSurvivor(vessel);  break;
        case 'miner':     this.tickMiner(vessel);     break;
        case 'collector': this.tickCollector(vessel); break;
      }
    });
  }

  // ── Rôles ─────────────────────────────────────────────────────────────────

  private tickFighter(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);
    const enemies   = this.getEnemies(scanned);
    const resources = scanned.filter(s => s.what === 'resource');

    if (enemies.length > 0 && energy >= 10) { this.shootAt(vessel, enemies[0], energy); return; }
    if (resources.length > 0 && energy >= 5) { this.moveSafe(vessel, this.closest(resources), scanned); return; }
    this.explore(vessel, energy, scanned);
  }

  private tickSurvivor(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);
    const dangers = this.getDangers(scanned);

    if (dangers.length > 0 && energy >= 5) {
      const threat = this.closest(dangers);
      const [tx, ty, tz] = threat.position;
      vessel.move3d(-Math.sign(tx) || rnd(), -Math.sign(ty) || rnd(), -Math.sign(tz) || rnd());
      return;
    }
    const resources = scanned.filter(s => s.what === 'resource');
    if (resources.length > 0 && energy >= 5) { this.moveSafe(vessel, this.closest(resources), scanned); return; }
    this.explore(vessel, energy, scanned);
  }

  private tickMiner(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);
    const state = vessel.state$.value!;

    const imminent = scanned.filter(s => s.what === 'torpedo' || s.what === 'explosion');
    if (imminent.length > 0 && energy >= 5) {
      const [tx, ty, tz] = this.closest(imminent).position;
      vessel.move3d(-Math.sign(tx) || 1, -Math.sign(ty) || 1, -Math.sign(tz) || 1);
      return;
    }

    if (energy >= 10 && Math.random() < 0.4) vessel.dropMine(3.0);

    if (energy >= 5) {
      const seed = state.id.charCodeAt(state.id.length - 1) % 8;
      const dirs3d: [number,number,number][] = [
        [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,0],[-1,-1,0]
      ];
      const [dx, dy, dz] = dirs3d[seed];
      const blocked = this.isCellBlocked3d(dx, dy, dz, scanned) || this.isPathDangerous3d(dx, dy, dz, scanned);
      vessel.move3d(blocked ? (-dx||1) : dx, blocked ? (-dy||1) : dy, blocked ? (-dz||1) : dz);
    }
  }

  private tickCollector(vessel: VesselConnection): void {
    const { scanned, energy } = this.getContext(vessel);
    const resources = scanned.filter(s => s.what === 'resource');
    const enemies   = this.getEnemies(scanned);

    if (resources.length > 0 && energy >= 5) { this.moveSafe(vessel, this.closest(resources), scanned); return; }
    if (scanned.length === 0 && energy >= 5) { vessel.scanRadar(); return; }
    if (enemies.length > 0 && energy >= 10) {
      const enemy = this.closest(enemies);
      if (this.norm3d(enemy.position) <= 3) { this.shootAt(vessel, enemy, energy); return; }
    }
    this.explore(vessel, energy, scanned);
  }

  // ── Déplacement sécurisé 3D ───────────────────────────────────────────────
  private moveSafe(vessel: VesselConnection, target: ScannedObject, scanned: ScannedObject[]): void {
    const state   = vessel.state$.value!;
    const maxDist = Math.max(1, state.stats[2] ?? 1);

    const [tx, ty, tz] = target.position;
    const dist = Math.sqrt(tx*tx + ty*ty + tz*tz);
    const scale  = Math.min(1, maxDist / dist);
    const idealX = Math.round(tx * scale);
    const idealY = Math.round(ty * scale);
    const idealZ = Math.round(tz * scale);

    const candidates = this.generateCandidates3d(idealX, idealY, idealZ, maxDist);

    for (const [cx, cy, cz] of candidates) {
      if (!this.isCellBlocked3d(cx, cy, cz, scanned) && !this.isPathDangerous3d(cx, cy, cz, scanned)) {
        vessel.move3d(cx, cy, cz);
        return;
      }
    }

    vessel.scanRadar();
  }

  // Génère tous les vecteurs [x,y,z] avec norme <= maxDist, triés par angle 3D avec l'idéal
  private generateCandidates3d(dx: number, dy: number, dz: number, maxDist: number): [number,number,number][] {
    const candidates: [number,number,number][] = [];
    const m = Math.ceil(maxDist);

    for (let x = -m; x <= m; x++) {
      for (let y = -m; y <= m; y++) {
        for (let z = -m; z <= m; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          if (Math.sqrt(x*x + y*y + z*z) > maxDist + 0.01) continue;
          candidates.push([x, y, z]);
        }
      }
    }

    // Trier par cosinus (produit scalaire normalisé) avec le vecteur idéal
    const idNorm = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    candidates.sort((a, b) => {
      const cosA = (a[0]*dx + a[1]*dy + a[2]*dz) / (this.norm3d(a) * idNorm);
      const cosB = (b[0]*dx + b[1]*dy + b[2]*dz) / (this.norm3d(b) * idNorm);
      return cosB - cosA; // plus grand cosinus = angle plus proche
    });

    return candidates;
  }

  private isCellBlocked3d(cx: number, cy: number, cz: number, scanned: ScannedObject[]): boolean {
    return scanned.some(s =>
      s.position[0] === cx && s.position[1] === cy && (s.position[2] ?? 0) === cz &&
      ['asteroid', 'mine'].includes(s.what as string)
    );
  }

  private isPathDangerous3d(cx: number, cy: number, cz: number, scanned: ScannedObject[]): boolean {
    const steps = Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz));
    for (let i = 1; i <= steps; i++) {
      const ix = Math.round(cx * i / steps);
      const iy = Math.round(cy * i / steps);
      const iz = Math.round(cz * i / steps);
      if (scanned.some(s =>
        s.position[0] === ix && s.position[1] === iy && (s.position[2] ?? 0) === iz &&
        ['torpedo', 'explosion'].includes(s.what as string)
      )) return true;
    }
    return false;
  }

  // ── Tir ───────────────────────────────────────────────────────────────────
  private shootAt(vessel: VesselConnection, enemy: ScannedObject, energy: number): void {
    if (this.isFriendlyPosition(enemy.position, vessel)) return;
    const [dx, dy, dz] = enemy.position;
    if (energy >= 50) {
      vessel.fireLaser3d(Math.sign(dx), Math.sign(dy), Math.sign(dz));
    } else if (energy >= 10) {
      vessel.fireTorpedo3d(Math.sign(dx), Math.sign(dy), Math.sign(dz));
    }
  }

  private isFriendlyPosition(position: number[], shooter: VesselConnection): boolean {
    return this.vesselService.getAll().some(v => {
      if (v === shooter) return false;
      const s = v.state$.value;
      if (!s) return false;
      return Math.sign(s.scanned[0]?.position[0] ?? 999) === Math.sign(position[0])
          && Math.sign(s.scanned[0]?.position[1] ?? 999) === Math.sign(position[1])
          && Math.sign(s.scanned[0]?.position[2] ?? 999) === Math.sign(position[2] ?? 0);
    });
  }

  // ── Exploration ───────────────────────────────────────────────────────────
  private explore(vessel: VesselConnection, energy: number, scanned: ScannedObject[]): void {
    if (energy < 5) return;
    if (scanned.length === 0) { vessel.scanRadar(); return; }

    const dirs: [number,number,number][] = [
      [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
      [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
      [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
      [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
    ];
    const safe = dirs.filter(([x,y,z]) =>
      !this.isCellBlocked3d(x,y,z,scanned) && !this.isPathDangerous3d(x,y,z,scanned)
    );
    const pick = safe.length > 0 ? safe : dirs;
    const [dx, dy, dz] = pick[Math.floor(Math.random() * pick.length)];
    vessel.move3d(dx, dy, dz);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private getContext(vessel: VesselConnection): { scanned: ScannedObject[]; energy: number } {
    const state = vessel.state$.value!;
    const now   = Date.now();
    return { scanned: state.scanned.filter(s => s.ts > now), energy: state.energy };
  }

  private getEnemies(scanned: ScannedObject[]): ScannedObject[] {
    return scanned.filter(s => s.what === 'vessel' && !s.allyVessel);
  }

  private getDangers(scanned: ScannedObject[]): ScannedObject[] {
    // On ne garde que les objets dont on a une POSITION fiable (active_scan ou explosion passive)
    // Les passive_scan de type 'move' ne sont PAS inclus : movement ≠ position
    return scanned.filter(s =>
      ['vessel','torpedo','mine','explosion','asteroid'].includes(s.what as string)
      && s.isActive // isActive = true uniquement pour les active_scan et explosions
    );
  }

  private closest(objects: ScannedObject[]): ScannedObject {
    return objects.reduce((best, cur) =>
      this.norm3d(cur.position) < this.norm3d(best.position) ? cur : best
    );
  }

  private norm3d(pos: number[]): number {
    return Math.sqrt((pos[0]??0)**2 + (pos[1]??0)**2 + (pos[2]??0)**2);
  }

  // Réaction à un passive_scan ennemi : scan actif puis tir laser si trouvé
  private reactToEnemyPassiveScan(vessel: VesselConnection, enemyId: string): void {
    const state = vessel.state$.value;
    if (!state || !state.battleStarted || state.frozen) return;
    if (state.energy < 5) return; // pas assez d'énergie pour scanner

    // Lancer un scan radar actif
    vessel.scanRadar();

    // Attendre les réponses active_scan (le serveur répond dans les ~200ms)
    setTimeout(() => {
      const updated = vessel.state$.value;
      if (!updated || updated.frozen) return;

      const now     = Date.now();
      const enemies = updated.scanned.filter(s =>
        s.what === 'vessel' && s.isActive && s.ts > now && !s.allyVessel
      );

      if (enemies.length === 0) return; // aucun ennemi localisé

      // Prendre l'ennemi le plus proche
      const target = this.closest(enemies);
      const [dx, dy, dz] = target.position;

      if (this.isFriendlyPosition(target.position, vessel)) return;

      // Tirer laser si énergie suffisante, torpille sinon
      if (updated.energy >= 50) {
        vessel.fireLaser3d(Math.sign(dx), Math.sign(dy), Math.sign(dz));
      } else if (updated.energy >= 10) {
        vessel.fireTorpedo3d(Math.sign(dx), Math.sign(dy), Math.sign(dz));
      }
    }, 400); // 400ms = délai raisonnable pour recevoir les active_scan
  }

  private clearVesselSubs(): void {
    this.vesselSubs.forEach(s => s.unsubscribe());
    this.vesselSubs = [];
  }

  ngOnDestroy(): void { this.stop(); this.clearVesselSubs(); }
}

function rnd(): number { return Math.random() > 0.5 ? 1 : -1; }
