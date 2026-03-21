import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.scss'
})
export class SetupComponent {
  @Output() onConnect = new EventEmitter<any>();

  serverUrl = 'ws://24hc26.haum.org';
  team      = 'MMAGiciens';
  key       = '8c023cYoPHcyNg';
  statNames = ['H', 'A', 'S', 'R'];

  vessels: [number, number, number, number][] = [
    [3, 2, 2, 2],
    [2, 2, 3, 2],
  ];

  get fleetTotal(): number {
    return this.vessels.reduce((s, v) => s + v.reduce((a, b) => a + b, 0), 0);
  }

  rowTotal(i: number): number {
    return this.vessels[i].reduce((a, b) => a + b, 0);
  }

  clamp(i: number, j: number): void {
    this.vessels[i][j] = Math.max(0, Math.min(9, Number(this.vessels[i][j]) || 0));
  }

  addVessel(): void {
    if (this.vessels.length < 6) this.vessels.push([1, 1, 1, 1]);
  }

  removeVessel(i: number): void {
    this.vessels.splice(i, 1);
  }

  launch(): void {
    this.onConnect.emit({ serverUrl: this.serverUrl, team: this.team, key: this.key, vessels: this.vessels });
  }
}
