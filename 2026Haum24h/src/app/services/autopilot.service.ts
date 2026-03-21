import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import { VesselService, VesselConnection } from './vessel.service';
import { ScannedObject, VesselRole } from '../models/protocol.models';
import { BEST_MODEL_WEIGHTS } from '../models/neural-weights';

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
        case 'fighter':   this.tickFighter(vessel);   break;
        case 'survivor':  this.tickSurvivor(vessel);  break;
        case 'miner':     this.tickMiner(vessel);     break;
        case 'collector': this.tickCollector(vessel); break;
        case 'smart_aggressive': break; // handled elsewhere it seems
        case 'neural_network': this.tickNeuralNetwork(vessel); break;
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

  // ── Neural Network ────────────────────────────────────────────────────────
  private tickNeuralNetwork(vessel: VesselConnection): void {
    const state = vessel.state$.value!;
    const { scanned, energy } = this.getContext(vessel);
    
    const enemies   = this.getEnemies(scanned);
    const asteroids = scanned.filter(s => s.what === 'asteroid');
    const torpedoes = scanned.filter(s => s.what === 'torpedo');
    const resources = scanned.filter(s => s.what === 'resource');
    
    const inputs: number[] = [state.hp / 100.0, Math.random()];
    const getPos = (arr: ScannedObject[]) => arr.length > 0 ? this.closest(arr).position : null;
    
    for (const arr of [enemies, asteroids, torpedoes, resources]) {
      const p = getPos(arr);
      if (p) {
        inputs.push(p[0] / 50.0, p[1] / 50.0);
      } else {
        inputs.push(0.0, 0.0);
      }
    }

    // Evaluate
    const h = [];
    const { W1, b1, W2, b2 } = BEST_MODEL_WEIGHTS as any;
    for (let i = 0; i < W1.length; i++) {
        let sum = b1[i];
        for (let j = 0; j < inputs.length; j++) {
            sum += W1[i][j] * inputs[j];
        }
        h.push(Math.max(0, sum));
    }
    const o = [];
    for (let i = 0; i < W2.length; i++) {
        let sum = b2[i];
        for (let j = 0; j < h.length; j++) {
            sum += W2[i][j] * h[j];
        }
        o.push(sum);
    }
    const action_idx = o.indexOf(Math.max(...o));

    if (action_idx === 0) vessel.move(0, 1);
    else if (action_idx === 1) vessel.move(0, -1);
    else if (action_idx === 2) vessel.move(1, 0);
    else if (action_idx === 3) vessel.move(-1, 0);
    else if (action_idx === 4) {
      const e = getPos(enemies);
      if (e && energy >= 10) vessel.fireTorpedo(Math.sign(e[0]), Math.sign(e[1]));
    }
    else if (action_idx === 5) {
      const e = getPos(enemies);
      if (e && energy >= 50) vessel.fireLaser(Math.sign(e[0]), Math.sign(e[1]));
    }
    else if (action_idx === 6 && energy >= 10) vessel.dropMine(2.0);
    else if (action_idx === 7 && energy >= 5) vessel.scanRadar();
  }

  // ── Déplacement sécurisé : évite les cases dangereuses ───────────────────
  // Respecte la stat S (vitesse) du vaisseau et vérifie que la case d'arrivée est libre
  private moveSafe(vessel: VesselConnection, target: ScannedObject, scanned: ScannedObject[]): void {
    const state   = vessel.state$.value!;
    const maxDist = state.stats[2] ?? 1; // stat S = index 2

    // Vecteur vers la cible
    const tx = target.position[0];
    const ty = target.position[1];
    const dist = Math.sqrt(tx * tx + ty * ty);

    // Normaliser et limiter à maxDist (norme euclidienne ≤ S)
    const scale  = Math.min(1, maxDist / (dist || 1));
    const baseDx = Math.round(tx * scale);
    const baseDy = Math.round(ty * scale);

    // Candidats triés par proximité avec la direction idéale
    const candidates = this.generateCandidates(baseDx, baseDy, maxDist);

    for (const [cx, cy] of candidates) {
      if (!this.isDangerous([cx, cy], scanned) && !this.isOccupied([cx, cy], scanned)) {
        vessel.move(cx, cy);
        return;
      }
    }

    // Aucune case sûre accessible : scanner
    vessel.scanRadar();
  }

  // Génère les vecteurs candidats autour de la direction idéale, dans la limite de maxDist
  private generateCandidates(dx: number, dy: number, maxDist: number): [number, number][] {
    const candidates: [number, number][] = [];

    for (let x = -maxDist; x <= maxDist; x++) {
      for (let y = -maxDist; y <= maxDist; y++) {
        if (x === 0 && y === 0) continue;
        if (Math.sqrt(x * x + y * y) > maxDist) continue;
        candidates.push([x, y]);
      }
    }

    // Trier par angle proche de la direction cible, puis par distance croissante
    const targetAngle = Math.atan2(dy, dx);
    candidates.sort((a, b) => {
      const angleA = Math.atan2(a[1], a[0]);
      const angleB = Math.atan2(b[1], b[0]);
      const diffA  = Math.abs(this.angleDiff(angleA, targetAngle));
      const diffB  = Math.abs(this.angleDiff(angleB, targetAngle));
      if (Math.abs(diffA - diffB) > 0.1) return diffA - diffB;
      // À angle égal, préférer les cases les plus proches de la cible
      const distA = Math.abs(a[0] - dx) + Math.abs(a[1] - dy);
      const distB = Math.abs(b[0] - dx) + Math.abs(b[1] - dy);
      return distA - distB;
    });

    return candidates;
  }

  private angleDiff(a: number, b: number): number {
    let d = a - b;
    while (d >  Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  // Vérifie si une case est occupée par un objet solide (astéroïde, mine)
  private isOccupied(dir: number[], scanned: ScannedObject[]): boolean {
    return scanned.some(s =>
      s.position[0] === dir[0] && s.position[1] === dir[1] &&
      ['asteroid', 'mine'].includes(s.what as string)
    );
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
    if (energy >= 50) {
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
