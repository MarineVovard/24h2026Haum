import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VesselRole, ROLES, RoleInfo } from '../../models/protocol.models';

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.scss'
})
export class SetupComponent {
  @Output() onConnect = new EventEmitter<any>();

  serverUrl = 'wss://24hc26.haum.org';
  team      = 'MMAGiciens';
  key       = '8c023cYoPHcyNg';

  statNames = ['H', 'A', 'S', 'R'];
  roles     = ROLES;

  vessels: { stats: [number,number,number,number]; role: VesselRole }[] = [
    { stats: [3, 2, 2, 2], role: 'fighter' },
    { stats: [2, 2, 3, 2], role: 'survivor' },
  ];

  get fleetTotal(): number {
    return this.vessels.reduce((s, v) => s + v.stats.reduce((a, b) => a + b, 0), 0);
  }

  rowTotal(i: number): number {
    return this.vessels[i].stats.reduce((a, b) => a + b, 0);
  }

  clamp(i: number, j: number): void {
    this.vessels[i].stats[j] = Math.max(0, Math.min(9, Number(this.vessels[i].stats[j]) || 0));
  }

  addVessel(): void {
    if (this.vessels.length < 6) this.vessels.push({ stats: [1,1,1,1], role: 'fighter' });
  }

  removeVessel(i: number): void {
    this.vessels.splice(i, 1);
  }

  roleInfo(role: VesselRole): RoleInfo {
    return ROLES.find(r => r.id === role)!;
  }

  launch(): void {
    this.onConnect.emit({
      serverUrl: this.serverUrl,
      team:      this.team,
      key:       this.key,
      vessels:   this.vessels.map(v => v.stats),
      roles:     this.vessels.map(v => v.role)
    });
  }
}
