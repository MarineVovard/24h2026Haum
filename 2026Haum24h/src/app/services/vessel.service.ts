import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { InMessage, OutMessage, VesselState, ScannedObject } from '../models/protocol.models';

export class VesselConnection {

  private socket!: WebSocket;
  state$    = new BehaviorSubject<VesselState | null>(null);
  messages$ = new Subject<InMessage>();

  private energyInterval: any;

  constructor(private serverUrl: string) {}

  connect(id: string, needKeys: boolean, key?: string): void {
    this.socket = new WebSocket(`${this.serverUrl}/ws`);

    this.socket.onopen = () => {
      this.send({ type: 'connect', id, ...(needKeys && key ? { key } : {}) });
    };

    this.socket.onmessage = (ev) => {
      const msg: InMessage = JSON.parse(ev.data);
      this.messages$.next(msg);
      this.handleMessage(msg, id);
    };

    this.socket.onclose = () => clearInterval(this.energyInterval);
  }

  private handleMessage(msg: InMessage, id: string): void {
    const cur = this.state$.value;

    switch (msg.type) {
      case 'stats':
        this.state$.next({
          id, stats: msg.stats, hp: msg.hp, maxHp: msg.hp,
          energy: 100, frozen: false, battleStarted: false,
          scanned: [], log: ['Connecté ✅']
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
        const obj: ScannedObject = { what: msg.what, position: msg.position, ts: Date.now() + 8000 };
        const filtered = cur.scanned.filter(s =>
          !(s.position[0] === obj.position[0] && s.position[1] === obj.position[1])
        );
        this.state$.next({ ...cur, scanned: [...filtered, obj] });
        break;
      }

      case 'passive_scan': {
        if (!cur) break;
        const pos = (msg as any).position ?? (msg as any).movement ?? [0, 0];
        const obj: ScannedObject = { what: msg.what, position: pos, ts: Date.now() + 8000 };
        this.state$.next({ ...cur, scanned: [...cur.scanned, obj], log: [`👁 Scan passif: ${msg.what}`, ...cur.log] });
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

  move(dx: number, dy: number)        { this.cost(5);  this.send({ type: 'move',         direction: [dx, dy] }); }
  fireTorpedo(dx: number, dy: number) { this.cost(10); this.send({ type: 'fire_torpedo', direction: [dx, dy] }); }
  dropMine(delay = 3.0)               { this.cost(10); this.send({ type: 'drop_mine',    delay }); }
  fireLaser(dx: number, dy: number)   { this.cost(50); this.send({ type: 'fire_laser',   direction: [dx, dy] }); }
  fireIem(dx: number, dy: number)     { this.cost(30); this.send({ type: 'fire_iem',     direction: [dx, dy] }); }
  scanRadar()                         { this.cost(5);  this.send({ type: 'scan_radar' }); }
  ping()                              {                this.send({ type: 'ping', n: Date.now() }); }
  autodestruct()                      {                this.send({ type: 'autodestruction' }); }

  /**
   * Lance un scan radar, attend quelques ms (réponses du serveur),
   * et renvoie le contexte trié (position, cibles, obstacles).
   * Idéal pour nourrir automatiquement SmartNavigation !
   */
  async scanAndGetNavigationContext(waitMs: number = 300) {
    this.scanRadar();
    // Attend la réception des messages `active_scan` via le WebSocket
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return this.getNavigationContext();
  }

  /**
   * Extrait et trie les informations du vaisseau dans ses attributs (State).
   */
  getNavigationContext() {
    const s = this.state$.value;
    if (!s) return null;

    // TOUT est relatif, la position du vaisseau est donc le point zéro local [0, 0].
    const currentPos: [number, number] = [0, 0];

    const now = Date.now();
    const validScans = s.scanned.filter(obj => obj.ts > now);

    // Mouvements ou présences de ressources
    const resources = validScans
      .filter(o => o.what === 'resource')
      .map(o => o.position as [number, number]);

    // On récupère "vessel" (vaisseau fixe) ou "move" (mouvement détecté) 
    const enemyVessels = validScans
      .filter(o => o.what === 'vessel' || o.what === 'move')
      .map(o => o.position as [number, number]);

    // Les obstacles "solides" (mines, astéroïdes, torpilles...)
    const obstacles = validScans
      .filter(o => ['asteroid', 'mine', 'torpedo'].includes(o.what))
      .map(o => o.position as [number, number]);

    return {
      currentPos,
      resources,
      enemyVessels,
      obstacles
    };
  }

  private cost(c: number): void {
    const s = this.state$.value;
    if (s) this.state$.next({ ...s, energy: Math.max(0, s.energy - c) });
  }
}

@Injectable({ providedIn: 'root' })
export class VesselService {
  connections = new Map<string, VesselConnection>();

  createAll(ids: string[], serverUrl: string, needKeys: boolean, key?: string): void {
    this.connections.clear();
    ids.forEach(id => {
      const conn = new VesselConnection(serverUrl);
      conn.connect(id, needKeys, key);
      this.connections.set(id, conn);
    });
  }

  get(id: string): VesselConnection | undefined {
    return this.connections.get(id);
  }

  getAll(): VesselConnection[] {
    return [...this.connections.values()];
  }
}
