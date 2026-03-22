import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { InMessage, OutMessage, VesselState, ScannedObject, VesselRole } from '../models/protocol.models';

export class VesselConnection {

  private socket!: WebSocket;
  state$    = new BehaviorSubject<VesselState | null>(null);
  messages$ = new Subject<InMessage>();
  wsStatus$ = new BehaviorSubject<'connecting' | 'open' | 'closed'>('connecting');

  private energyInterval: any;
  private vesselId = '';
  private needKeys = false;
  private key      = '';

  constructor(private serverUrl: string, public role: VesselRole, public team: string = '') {}

  connect(id: string, needKeys: boolean, key?: string): void {
    this.vesselId = id;
    this.needKeys = needKeys;
    this.key      = key ?? '';
    this.openSocket();
  }

  reconnect(): void {
    this.socket?.close();
    clearInterval(this.energyInterval);
    this.wsStatus$.next('connecting');
    const s = this.state$.value;
    if (s) this.state$.next({ ...s, log: ['🔄 Reconnexion...', ...s.log] });
    this.openSocket();
  }

  private openSocket(): void {
    this.socket = new WebSocket(`${this.serverUrl}/ws`);
    this.wsStatus$.next('connecting');

    this.socket.onopen = () => {
      this.wsStatus$.next('open');
      this.send({ type: 'connect', id: this.vesselId, ...(this.needKeys && this.key ? { key: this.key } : {}) });
    };

    this.socket.onmessage = (ev) => {
      const msg: InMessage = JSON.parse(ev.data);
      this.messages$.next(msg);
      this.handleMessage(msg, this.vesselId);
    };

    this.socket.onclose = () => {
      this.wsStatus$.next('closed');
      clearInterval(this.energyInterval);
      const s = this.state$.value;
      if (s) this.state$.next({ ...s, log: ['🔌 Connexion fermée', ...s.log] });
    };
  }

  private handleMessage(msg: InMessage, id: string): void {
    const cur = this.state$.value;
    console.log(msg);

    switch (msg.type) {
      case 'stats':
        this.state$.next({
          id, stats: msg.stats, hp: msg.hp, maxHp: msg.hp,
          energy: 100, frozen: false, battleStarted: false,
          scanned: [], allies: new Set<string>(), log: ['Connecté ✅'], role: this.role
        });
        this.energyInterval = setInterval(() => {
          const s = this.state$.value;
          if (s) this.state$.next({ ...s, energy: Math.min(100, s.energy + 4) });
        }, 1000);
        break;

      case 'start_battle':
        if (cur) this.state$.next({ ...cur, battleStarted: true, log: ['⚔️ Bataille démarrée !', ...cur.log] });
        break;

      case 'damage':
        if (cur) this.state$.next({ ...cur, hp: msg.hp, log: [`💥 Dégâts ! HP: ${msg.hp}`, ...cur.log] });
        break;

      case 'low_energy':
        if (cur) this.state$.next({ ...cur, log: ['⚡ Énergie insuffisante', ...cur.log] });
        break;

      case 'iem_damage':
        if (cur) this.state$.next({ ...cur, frozen: true, log: ['🧊 IEM reçue ! Gelé 5s', ...cur.log] });
        setTimeout(() => {
          const s = this.state$.value;
          if (s) this.state$.next({ ...s, frozen: false });
        }, 5000);
        break;

      case 'iem_frozen':
        if (cur) this.state$.next({ ...cur, log: ['🧊 Action bloquée — gelé par IEM', ...cur.log] });
        break;

      case 'move_aborded':
        if (cur) this.state$.next({ ...cur, log: ['⚠️ Déplacement annulé (trop loin)', ...cur.log] });
        break;

      case 'resource_depleted':
        if (cur) this.state$.next({ ...cur, log: ['💎 Ressource épuisée', ...cur.log] });
        break;

      case 'active_scan': {
        if (!cur) break;
        const obj: ScannedObject = {
          what: msg.what,
          position: msg.position,
          ts: Date.now() + 8000,
          isActive: true,
          allyVessel: false // sera mis à jour via passive_scan
        };
        const filtered = cur.scanned.filter(s =>
          !(s.position[0] === obj.position[0] &&
            s.position[1] === obj.position[1] &&
            s.position[2] === obj.position[2])
        );
        this.state$.next({ ...cur, scanned: [...filtered, obj] });
        break;
      }

      case 'passive_scan': {
        if (!cur) break;

        if (msg.what === 'explosion') {
          // explosion : position relative connue → on l'affiche sur la scène
          const pos = (msg as any).position as number[];
          if (pos) {
            const obj: ScannedObject = {
              what: 'explosion',
              position: pos,
              ts: Date.now() + 3000, // expire vite
              isActive: true,
              allyVessel: false
            };
            this.state$.next({ ...cur,
              scanned: [...cur.scanned, obj],
              log: [`💥 Explosion détectée en [${pos.join(', ')}]`, ...cur.log]
            });
          } else {
            this.state$.next({ ...cur, log: ['💥 Explosion détectée (position inconnue)', ...cur.log] });
          }

        } else if (msg.what === 'move') {
          // move : on reçoit vessel (nom) + movement (vecteur de déplacement)
          // PAS une position absolue — on ne peut pas placer l'objet sur la scène
          const vessel = (msg as any).vessel as string;
          const movement = (msg as any).movement as number[];
          const ownTeam = cur.id.split(':')[0];

          // Détecter les alliés (même équipe)
          const newAllies = new Set(cur.allies);
          if (vessel && vessel.startsWith(ownTeam + ':')) {
            newAllies.add(vessel);
          }

          const log = movement
            ? `👁 ${vessel} s'est déplacé de [${movement.join(', ')}]`
            : `👁 ${vessel} s'est déplacé`;

          this.state$.next({ ...cur, allies: newAllies, log: [log, ...cur.log] });
        }
        break;
      }

      case 'won':
        if (cur) this.state$.next({ ...cur, log: ['🏆 Victoire !', ...cur.log] });
        break;

      case 'end':
        if (cur) this.state$.next({ ...cur, log: ['💀 Défaite', ...cur.log] });
        break;

      case 'pong':
        if (cur) this.state$.next({ ...cur, log: [`🏓 Pong (n=${(msg as any).n})`, ...cur.log] });
        break;
    }
  }

  send(msg: OutMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(msg));
  }

  // ── Commandes 3D ──────────────────────────────────────────────────────────
  move3d(dx: number, dy: number, dz: number): void {
    this.cost(5);
    this.send({ type: 'move', direction: [dx, dy, dz] });
    this.clearActiveScans();
  }

  fireTorpedo3d(dx: number, dy: number, dz: number) { this.cost(10); this.send({ type: 'fire_torpedo', direction: [dx, dy, dz] }); }
  dropMine(delay = 3.0)                             { this.cost(10); this.send({ type: 'drop_mine',    delay }); }
  fireLaser3d(dx: number, dy: number, dz: number)   { this.cost(50); this.send({ type: 'fire_laser',   direction: [dx, dy, dz] }); }
  fireIem3d(dx: number, dy: number, dz: number)     { this.cost(30); this.send({ type: 'fire_iem',     direction: [dx, dy, dz] }); }
  scanRadar()                                        { this.cost(5);  this.send({ type: 'scan_radar' }); }
  ping()                                             {                this.send({ type: 'ping', n: Date.now() }); }
  autodestruct()                                     {                this.send({ type: 'autodestruction' }); }

  getNavigationContext() {
    const s = this.state$.value;
    if (!s) return null;
    const now = Date.now();
    const validScans = s.scanned.filter(obj => obj.ts > now);
    return {
      currentPos: [0, 0, 0] as [number, number, number],
      resources:    validScans.filter(o => o.what === 'resource').map(o => o.position as [number,number,number]),
      enemyVessels: validScans.filter(o => o.what === 'vessel').map(o => o.position as [number,number,number]),
      obstacles:    validScans.filter(o => ['asteroid','mine','torpedo'].includes(o.what)).map(o => o.position as [number,number,number])
    };
  }

  private clearActiveScans(): void {
    const s = this.state$.value;
    if (s) this.state$.next({ ...s, scanned: [] });
  }

  private cost(c: number): void {
    const s = this.state$.value;
    if (s) this.state$.next({ ...s, energy: Math.max(0, s.energy - c) });
  }
}

@Injectable({ providedIn: 'root' })
export class VesselService {
  private connections = new Map<string, VesselConnection>();
  vessels$ = new BehaviorSubject<VesselConnection[]>([]);

  createAll(ids: string[], roles: VesselRole[], serverUrl: string, needKeys: boolean, key?: string, team?: string): void {
    this.connections.clear();
    const conns: VesselConnection[] = [];
    ids.forEach((id, i) => {
      const role = roles[i] ?? 'fighter';
      const conn = new VesselConnection(serverUrl, role, team ?? '');
      conn.connect(id, needKeys, key);
      this.connections.set(id, conn);
      conns.push(conn);
    });
    this.vessels$.next(conns);
  }

  get(id: string): VesselConnection | undefined { return this.connections.get(id); }
  getAll(): VesselConnection[] { return [...this.connections.values()]; }
}
