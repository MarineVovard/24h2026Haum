import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { InMessage } from '../models/protocol.models';

export interface GameSession {
  id?: number;
  startedAt: number;
  team: string;
}

export interface GameLog {
  id?: number;
  sessionId: number;
  timestamp: number;
  vesselId: string;
  type: string;
  msg: any;
  isOutCommand?: boolean;
}

@Injectable({ providedIn: 'root' })
export class DatabaseService extends Dexie {
  sessions!: Table<GameSession, number>;
  logs!: Table<GameLog, number>;
  
  currentSessionId: number | null = null;

  constructor() {
    super('MarabuntaDB');
    this.version(1).stores({
      sessions: '++id, startedAt',
      logs: '++id, sessionId, timestamp, type, vesselId'
    });
  }

  async startNewGame(team: string): Promise<number> {
    const id = await this.sessions.add({
      startedAt: Date.now(),
      team
    });
    this.currentSessionId = id;
    console.log(`[Database] Démarrage d'une nouvelle partie (Session ID: ${id})`);
    
    // ENVOI AU BACKEND MONGODB
    fetch('http://localhost:3000/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id, team })
    }).catch(e => console.warn('Backend MongoDB non joignable:', e));

    return id;
  }

  async logMessage(vesselId: string, msg: any, isOutCommand: boolean = false): Promise<void> {
    if (!this.currentSessionId) return;

    await this.logs.add({
      sessionId: this.currentSessionId,
      timestamp: Date.now(),
      vesselId,
      type: msg.type,
      msg,
      isOutCommand
    });
    
    // ENVOI AU BACKEND MONGODB (TRACE PARFAIT POUR REPLAY)
    fetch('http://localhost:3000/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.currentSessionId,
        vesselId,
        type: msg.type,
        msg,
        isOutCommand
      })
    }).catch(e => console.warn('Backend MongoDB non joignable:', e));
  }

  async exportCurrentSession(): Promise<void> {
    if (!this.currentSessionId) {
      alert("Aucune partie en cours à exporter.");
      return;
    }
    const session = await this.sessions.get(this.currentSessionId);
    const logs = await this.logs.where('sessionId').equals(this.currentSessionId).toArray();

    const data = { session, logs };
    const json = JSON.stringify(data, null, 2); // Indent pour être lisible
    
    const blob = new Blob([json], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `partie_${this.currentSessionId}_logs.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}
