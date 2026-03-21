import { Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SmartNavigation } from '../../services/smart-navigation';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { VesselConnection } from '../../services/vessel.service';
import { VesselState, ScannedObject } from '../../models/protocol.models';

const ICONS: Record<string, string> = {
  vessel: '🚀', asteroid: '🪨', mine: '💣',
  torpedo: '🔥', resource: '💎', explosion: '💥', move: '👁'
};

const DIRECTIONS: Record<string, [number, number]> = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1]
};

@Component({
  selector: 'app-grid',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './grid.component.html',
  styleUrl: './grid.component.scss'
})
export class GridComponent implements OnChanges, OnDestroy {

  @Input() vessel: VesselConnection | null = null;

  state: VesselState | null = null;
  size      = 11;
  cellSize  = 44;
  weaponDir = 'E';
  cells: { x: number; y: number; id: string }[] = [];

  private sub?: Subscription;

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    this.buildGrid();
    if (this.vessel) {
      this.sub = this.vessel.state$.subscribe(s => this.state = s);
    }
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  buildGrid(): void {
    this.cells = [];
    const half = Math.floor(this.size / 2);
    for (let y = -half; y <= half; y++)
      for (let x = -half; x <= half; x++)
        this.cells.push({ x, y, id: `${x}_${y}` });
  }

  getObject(x: number, y: number): ScannedObject | undefined {
    return this.state?.scanned.find(s =>
      s.position[0] === x && s.position[1] === y && s.ts > Date.now()
    );
  }

  getLabel(x: number, y: number): string {
    const o = this.getObject(x, y);
    return o ? `${o.what} (${x}, ${y})` : `(${x}, ${y}) — cliquer pour se déplacer`;
  }

  getIcon(what: string): string { return ICONS[what] ?? '?'; }

  energyDisplay(): string {
    return this.state ? Math.round(this.state.energy).toString() : '0';
  }

  gridColumns(): string {
    return `repeat(${this.size}, ${this.cellSize}px)`;
  }

  onCellClick(x: number, y: number): void {
    if (x === 0 && y === 0) return;
    this.vessel?.move(x, y);
  }

  move(dx: number, dy: number): void { this.vessel?.move(dx, dy); }
  scan(): void  { this.vessel?.scanRadar(); }
  mine(): void  { this.vessel?.dropMine(3.0); }
  ping(): void  { this.vessel?.ping(); }

  async magicAutoFarm(): Promise<void> {
    if (!this.vessel) return;

    // Lance le scan et attend les résultats
    const context = await this.vessel.scanAndGetNavigationContext(300);
    if (!context || context.resources.length === 0) return;

    // Sélectionne la ressource la plus proche
    let bestTarget = context.resources[0];
    let minDist = Infinity;
    for (const r of context.resources) {
      const d = SmartNavigation.distance(context.currentPos, r);
      if (d < minDist) { minDist = d; bestTarget = r; }
    }

    const allObstacles = [...context.obstacles, ...context.enemyVessels];

    // L'algo calcule le move
    const [dx, dy] = SmartNavigation.getNextMoveGreedy(
      context.currentPos,
      bestTarget,
      allObstacles,
      5, // maxSpeed
      2  // Radius 
    );

    const idx = Math.round(dx);
    const idy = Math.round(dy);

    if (idx !== 0 || idy !== 0) {
      this.vessel.move(idx, idy);
    }
  }

  autodestruct(): void {
    if (confirm('Confirmer l\'autodestruction ? (20 dégâts en zone)'))
      this.vessel?.autodestruct();
  }

  private getDir(): [number, number] {
    return DIRECTIONS[this.weaponDir] ?? [1, 0];
  }

  fireTorpedo(): void { const [dx, dy] = this.getDir(); this.vessel?.fireTorpedo(dx, dy); }
  fireLaser():   void { const [dx, dy] = this.getDir(); this.vessel?.fireLaser(dx, dy); }
  fireIem():     void { const [dx, dy] = this.getDir(); this.vessel?.fireIem(dx, dy); }
}
