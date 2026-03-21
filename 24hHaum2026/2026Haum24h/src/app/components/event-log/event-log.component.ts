import { Component, Input } from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { VesselConnection } from '../../services/vessel.service';

@Component({
  selector: 'app-event-log',
  standalone: true,
  imports: [CommonModule, AsyncPipe],
  templateUrl: './event-log.component.html',
  styleUrl: './event-log.component.scss'
})
export class EventLogComponent {
  @Input() vessel: VesselConnection | null = null;
}
