import { Injectable } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { InMessage, OutMessage, EvHello, EvNewVessels } from '../models/protocol.models';

@Injectable({ providedIn: 'root' })
export class WebSocketService {

  private socket!: WebSocket;
  messages$  = new Subject<InMessage>();
  connected$ = new BehaviorSubject<boolean>(false);
  needKeys$  = new BehaviorSubject<boolean>(false);
  vesselIds$ = new BehaviorSubject<string[]>([]);
  debugLog$  = new BehaviorSubject<string[]>([]);

  private log(direction: '▶ SENT' | '◀ RECV' | 'ℹ INFO' | '❌ ERR', msg: string): void {
    const entry = `[${new Date().toLocaleTimeString()}] ${direction} ${msg}`;
    console.log(entry);
    this.debugLog$.next([entry, ...this.debugLog$.value].slice(0, 100));
  }

  connect(serverUrl: string): void {
    if (this.socket) this.socket.close();
    const url = `${serverUrl}/ws`;
    this.log('ℹ INFO', `Connexion vers ${url}...`);
    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.log('ℹ INFO', 'WebSocket ouvert ✅');
      this.connected$.next(true);
    };

    this.socket.onclose = (ev) => {
      this.log('ℹ INFO', `WebSocket fermé — code: ${ev.code} raison: "${ev.reason || 'aucune'}"`);
      this.connected$.next(false);
    };

    this.socket.onerror = (ev) => {
      this.log('❌ ERR', `Erreur WebSocket (vérifier l'URL et que le serveur est accessible)`);
      this.connected$.next(false);
    };

    this.socket.onmessage = (ev) => {
      this.log('◀ RECV', ev.data);
      try {
        const msg: InMessage = JSON.parse(ev.data);
        this.messages$.next(msg);
        if (msg.type === 'hello')       this.needKeys$.next((msg as EvHello).need_keys);
        if (msg.type === 'new_vessels') this.vesselIds$.next((msg as EvNewVessels).vessels);
      } catch (e) {
        this.log('❌ ERR', `JSON invalide: ${ev.data}`);
      }
    };
  }

  send(msg: OutMessage): void {
    const json = JSON.stringify(msg);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(json);
      this.log('▶ SENT', json);
    } else {
      this.log('❌ ERR', `Impossible d'envoyer — état socket: ${this.socket?.readyState ?? 'non initialisé'}`);
    }
  }

  registerFleet(team: string, vessels: [number, number, number, number][], key?: string): void {
    this.send({ type: 'start', team, vessels, ...(key ? { key } : {}) });
  }
}
