import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule, AsyncPipe, DecimalPipe } from '@angular/common';
import { VesselConnection } from '../../services/vessel.service';
import { VesselRole, ROLES } from '../../models/protocol.models';

@Component({
  selector: 'app-fleet-panel',
  standalone: true,
  imports: [CommonModule, AsyncPipe, DecimalPipe],
  templateUrl: './fleet-panel.component.html',
  styleUrl: './fleet-panel.component.scss'
})
export class FleetPanelComponent {
  @Input()  vessels:  VesselConnection[] = [];
  @Input()  selected: VesselConnection | null = null;
  @Output() select = new EventEmitter<VesselConnection>();

  statNames = ['H', 'A', 'S', 'R'];

  shortId(id: string): string {
    const parts = id.split(':');
    return parts.length >= 2 ? `${parts[0]} #${parts[1]}` : id;
  }

  roleEmoji(role: VesselRole): string {
    return ROLES.find(r => r.id === role)?.emoji ?? '🚀';
  }

  hpPercent(hp: number, maxHp: number): number {
    return maxHp > 0 ? (hp / maxHp) * 100 : 0;
  }

  reconnect(event: MouseEvent, v: VesselConnection): void {
    event.stopPropagation(); // ne pas déclencher le select
    v.reconnect();
  }
}
