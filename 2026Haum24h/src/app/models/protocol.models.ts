// ── Messages envoyés ──────────────────────────────────────────────────────────
export interface MsgStart {
  type: 'start';
  team: string;
  key?: string;
  vessels: [number, number, number, number][];
}
export interface MsgConnect       { type: 'connect';        id: string; key?: string; }
export interface MsgMove          { type: 'move';           direction: number[]; }
export interface MsgFireTorpedo   { type: 'fire_torpedo';   direction: number[]; }
export interface MsgDropMine      { type: 'drop_mine';      delay: number; }
export interface MsgFireLaser     { type: 'fire_laser';     direction: number[]; }
export interface MsgFireIem       { type: 'fire_iem';       direction: number[]; }
export interface MsgScanRadar     { type: 'scan_radar'; }
export interface MsgAutodestruct  { type: 'autodestruction'; }
export interface MsgPing          { type: 'ping'; n?: number; }

export type OutMessage = MsgStart | MsgConnect | MsgMove | MsgFireTorpedo
  | MsgDropMine | MsgFireLaser | MsgFireIem | MsgScanRadar | MsgAutodestruct | MsgPing;

// ── Messages reçus ────────────────────────────────────────────────────────────
export interface EvHello            { type: 'hello';             need_keys: boolean; }
export interface EvNewVessels       { type: 'new_vessels';       vessels: string[]; }
export interface EvStats            { type: 'stats';             stats: number[]; hp: number; }
export interface EvStartBattle      { type: 'start_battle'; }
export interface EvDamage           { type: 'damage';            hp: number; }
export interface EvActiveScan       { type: 'active_scan';       what: ScanObject; position: number[]; }
export interface EvPassiveScan      { type: 'passive_scan';      what: 'explosion' | 'move'; position?: number[]; vessel?: string; movement?: number[]; }
export interface EvLowEnergy        { type: 'low_energy'; }
export interface EvIemDamage        { type: 'iem_damage'; }
export interface EvIemFrozen        { type: 'iem_frozen'; }
export interface EvResourceDepleted { type: 'resource_depleted'; }
export interface EvPong             { type: 'pong'; n?: number; }
export interface EvWon              { type: 'won'; }
export interface EvEnd              { type: 'end'; }
export interface EvInvalidMsg       { type: 'invalid_msg'; }
export interface EvMoveAborded      { type: 'move_aborded'; }

export type ScanObject = 'vessel' | 'asteroid' | 'mine' | 'torpedo' | 'resource';
export type InMessage  = EvHello | EvNewVessels | EvStats | EvStartBattle | EvDamage
  | EvActiveScan | EvPassiveScan | EvLowEnergy | EvIemDamage | EvIemFrozen
  | EvResourceDepleted | EvPong | EvWon | EvEnd | EvInvalidMsg | EvMoveAborded;

// ── Rôles des vaisseaux ───────────────────────────────────────────────────────
export type VesselRole = 'fighter' | 'survivor' | 'miner' | 'collector';

export interface RoleInfo {
  id: VesselRole;
  label: string;
  emoji: string;
  description: string;
}

export const ROLES: RoleInfo[] = [
  { id: 'fighter',   emoji: '⚔️',  label: 'Combattant',   description: 'Récupère les ressources et tire sur les ennemis détectés' },
  { id: 'survivor',  emoji: '🛡️',  label: 'Survivant',    description: 'Fuit dès qu\'un danger est détecté, priorité à la survie' },
  { id: 'miner',     emoji: '💣',  label: 'Poseur de mines', description: 'Pose des mines sur son chemin et se déplace en continu' },
  { id: 'collector', emoji: '💎',  label: 'Collecteur',   description: 'Récupère les ressources en priorité, tire en dernier recours' },
];

// ── État local d'un vaisseau ──────────────────────────────────────────────────
export interface VesselState {
  id: string;
  stats: number[];
  hp: number;
  maxHp: number;
  energy: number;
  frozen: boolean;
  battleStarted: boolean;
  scanned: ScannedObject[];
  allies: Set<string>;  // noms des vaisseaux alliés détectés
  log: string[];
  role: VesselRole;
}

export interface ScannedObject {
  what: ScanObject | 'explosion' | 'move';
  position: number[];
  ts: number;
  isActive: boolean;
  allyVessel: boolean;  // true = vaisseau allié, ne pas cibler
}
