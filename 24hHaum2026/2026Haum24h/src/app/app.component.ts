import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WebSocketService } from './services/websocket.service';
import { VesselService, VesselConnection } from './services/vessel.service';
import { GridComponent } from './components/grid/grid.component';
import { FleetPanelComponent } from './components/fleet-panel/fleet-panel.component';
import { EventLogComponent } from './components/event-log/event-log.component';
import { SetupComponent } from './components/setup/setup.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, GridComponent, FleetPanelComponent, EventLogComponent, SetupComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {

  connected   = false;
  battleReady = false;
  showDebug   = true;
  debugLogs: string[] = [];
  selectedVessel: VesselConnection | null = null;

  private serverUrl = '';
  private key       = '';

  constructor(
    public wsService:     WebSocketService,
    public vesselService: VesselService
  ) {}

  ngOnInit(): void {
    this.wsService.connected$.subscribe(c => this.connected = c);
    this.wsService.debugLog$.subscribe(logs => this.debugLogs = logs);
    this.wsService.vesselIds$.subscribe(ids => {
      if (ids.length === 0) return;
      this.vesselService.createAll(ids, this.serverUrl, this.wsService.needKeys$.value, this.key);
      this.battleReady    = true;
      this.selectedVessel = this.vesselService.getAll()[0];
    });
  }

  onSetup(cfg: { serverUrl: string; team: string; key: string; vessels: [number,number,number,number][] }): void {
    this.serverUrl = cfg.serverUrl;
    this.key       = cfg.key;
    this.wsService.connect(cfg.serverUrl);
    setTimeout(() => {
      this.wsService.registerFleet(cfg.team, cfg.vessels, cfg.key || undefined);
    }, 600);
  }

  toggleDebug(): void {
    this.showDebug = !this.showDebug;
  }

  reset(): void {
    this.battleReady    = false;
    this.selectedVessel = null;
    this.wsService.vesselIds$.next([]);
  }

  selectVessel(v: VesselConnection): void {
    this.selectedVessel = v;
  }
}
