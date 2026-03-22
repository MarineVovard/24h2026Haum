import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { InMessage, OutMessage, VesselState, ScannedObject, VesselRole } from '../models/protocol.models';

export class VesselConnection {

  private socket!: WebSocket;
  state$    = new BehaviorSubject<VesselState | null>(null);
  messages$ = new Subject<InMessage>();
  wsStatus$ = new BehaviorSubject<'connecting' | 'open' | 'closed'>('connecting');
  heartbeatInterval:any;

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
      // ❤️ heartbeat toutes les 20s
      this.heartbeatInterval = setInterval(() => {
      this.send({ type: 'ping' });
      }, 50000);
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

    switch (msg.type) {
      case 'stats':
        this.state$.next({
          id, stats: msg.stats, hp: msg.hp, maxHp: msg.hp,
          energy: 100, frozen: false, battleStarted: false,
          scanned: [], scannedPassive: [], allies: new Set<string>(), log: ['Connecté ✅'], role: this.role
        });
        this.energyInterval = setInterval(() => {
          const s = this.state$.value;
          if (s) this.state$.next({ ...s, energy: Math.min(100, s.energy + 4) });
        }, 5000);
        console.log(msg);
        break;

      case 'start_battle':
        if (cur) this.state$.next({ ...cur, battleStarted: true, log: ['⚔️ Bataille démarrée !', ...cur.log] });
        console.log(msg);
        break;

      case 'damage':
        if (cur) this.state$.next({ ...cur, hp: msg.hp, log: [`💥 Dégâts ! HP: ${msg.hp}`, ...cur.log] });
        console.log(msg);
        break;

      case 'low_energy':
        if (cur) this.state$.next({ ...cur, log: ['⚡ Énergie insuffisante', ...cur.log] });
        console.log(msg);
        break;

      case 'iem_damage':
        if (cur) this.state$.next({ ...cur, frozen: true, log: ['🧊 IEM reçue ! Gelé 5s', ...cur.log] });
        setTimeout(() => {
          const s = this.state$.value;
          if (s) this.state$.next({ ...s, frozen: false });
        }, 5000);
        console.log(msg);
        break;

      case 'iem_frozen':
        if (cur) this.state$.next({ ...cur, log: ['🧊 Action bloquée — gelé par IEM', ...cur.log] });
        console.log(msg);
        break;

      case 'move_aborded':
        if (cur) this.state$.next({ ...cur, log: ['⚠️ Déplacement annulé (trop loin)', ...cur.log] });
        console.log(msg);
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
        if(cur.id.split(":")[0] === msg.vessel?.split(':')[0]) {
          this.state$.next({ ...cur, log: [`👁 Scan passif: mon bateau se deplace en ${msg.movement}`, ...cur.log] });
          break;
        }
        const details = msg.what === 'move'
          ? `vaisseau ${(msg as any).vessel} s'est déplacé`
          : `explosion détectée`;
        // Enregistrer les alliés (même équipe) depuis le passive_scan
        const newAllies = new Set(cur.allies);
        if (msg.what === 'move' && (msg as any).vessel) {
          const vid: string = (msg as any).vessel;
          const ownTeam = cur.id.split(':')[0];
          if (vid.startsWith(ownTeam + ':')) newAllies.add(vid);
        }
        if(msg.what === 'move') {
          console.log("On est dans le move");
          const obj: ScannedObject = { what: msg.what, position: msg.movement ?? [], ts: Date.now() + 1000, isActive: false, allyVessel: false }; 
          // [TODO]: il faut adapter le temps à la longueur du trajet
          const filtered: ScannedObject[] = cur.scannedPassive.filter(s => s.ts >= Date.now()); // on enlève les infos qui ne sont plus à jour
          console.log([...filtered, obj]);
          this.state$.next({ ...cur, scannedPassive: [...filtered, obj] , log: [`👁 Scan passif: ${details}`, ...cur.log] });
        }
        else {
        this.state$.next({ ...cur, log: [`👁 Scan passif: ${details}`, ...cur.log] });
        }
        // this.state$.next({ ...cur, allies: newAllies, log: [`👁 Scan passif: ${details}`, ...cur.log] });
        break;
      }

      case 'won':
        if (cur) this.state$.next({ ...cur, log: ['🏆 Victoire !', ...cur.log] });
        break;

      case 'end':
        if (cur) this.state$.next({ ...cur, log: ['💀 Défaite', ...cur.log] });
        break;

      case 'pong':
        if (cur) this.state$.next({ ...cur});
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
    this.updateScans([dx, dy, dz]);
  }

          
  fireTorpedo3d(dx: number, dy: number, dz: number) { this.cost(10); this.send({ type: 'fire_torpedo', direction: [dx, dy, dz] });  this.log('fire_torpedo')}
  dropMine(delay = 3.0)                             { this.cost(10); this.send({ type: 'drop_mine',    delay }); this.log('drop_mine')}
  fireLaser3d(dx: number, dy: number, dz: number)   { this.cost(50); this.send({ type: 'fire_laser',   direction: [dx, dy, dz] }); this.log('fire_laser') }
  fireIem3d(dx: number, dy: number, dz: number)     { this.cost(30); this.send({ type: 'fire_iem',     direction: [dx, dy, dz] }); this.log('fire_iem') }
  scanRadar()                                        { this.cost(5);  this.send({ type: 'scan_radar' }); this.log('scan_radar') }
  ping()                                             {                this.send({ type: 'ping', n: Date.now() }); }
  autodestruct()                                     {                this.send({ type: 'autodestruction' }); this.log('autodestruction') }

  /**
   * Lance un scan radar, attend quelques ms (réponses du serveur),
   * et renvoie le contexte trié (position, cibles, obstacles).
   * Idéal pour nourrir automatiquement SmartNavigation !
   */
  async scanAndGetNavigationContext(waitMs: number = 300) {
    this.clearActiveScans();
    this.scanRadar();
    // Attend la réception des messages `active_scan` via le WebSocket
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return this.getNavigationContext();
  }

  log(msg: string) : void {
    const cur = this.state$.value;
    if (!cur) return;
    this.state$.next({ ...cur, log: [`👁 Scan passif: ${msg}`, ...cur.log] });
  }
  /**
   * Extrait et trie les informations du vaisseau dans ses attributs (State).
   */
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

  private updateScans(position: number[]): void {
    const s = this.state$.value;

    const unique = Array.from(
      new Map(
       s?.scanned.map(obj => [obj.position.join(','), obj])
     ).values()
    );

    const updatedList = unique.map(scanObject => {
     scanObject.position = scanObject.position.map((value, index) => value - position[index])
     return scanObject}
    );
    if (s) this.state$.next({ ...s, scanned: updatedList ?? [] });
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
