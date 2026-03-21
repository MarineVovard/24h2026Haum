import { Component, OnInit } from '@angular/core';
import { CommonModule, AsyncPipe } from '@angular/common';
import { WebSocketService } from './services/websocket.service';
import { VesselService, VesselConnection } from './services/vessel.service';
import { AutoPilotService } from './services/autopilot.service';
import { GridComponent } from './components/grid/grid.component';
import { FleetPanelComponent } from './components/fleet-panel/fleet-panel.component';
import { EventLogComponent } from './components/event-log/event-log.component';
import { SetupComponent } from './components/setup/setup.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, AsyncPipe, GridComponent, FleetPanelComponent, EventLogComponent, SetupComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {

  connected   = false;
  battleReady = false;
  showDebug   = true;
  autoPilot   = false;
  debugLogs: string[] = [];
  vessels: VesselConnection[] = [];
  selectedVessel: VesselConnection | null = null;

  private serverUrl = '';
  private key       = '';
  private _roles: any[] = [];

  constructor(
    public wsService:      WebSocketService,
    public vesselService:  VesselService,
    public autoPilotService: AutoPilotService
  ) {}

  ngOnInit(): void {
    this.wsService.connected$.subscribe(c => this.connected = c);
    this.wsService.debugLog$.subscribe(logs => this.debugLogs = logs);
    this.vesselService.vessels$.subscribe(vessels => {
      this.vessels = vessels;
      if (vessels.length > 0 && !this.selectedVessel) {
        this.selectedVessel = vessels[0];
      }
    });
    this.wsService.vesselIds$.subscribe(ids => {
      if (ids.length === 0) return;
      this.vesselService.createAll(ids, this._roles, this.serverUrl, this.wsService.needKeys$.value, this.key);
      this.battleReady = true;
    });
    this.autoPilotService.enabled$.subscribe(v => this.autoPilot = v);
  }

  onSetup(cfg: { serverUrl: string; team: string; key: string; vessels: [number,number,number,number][]; roles: any[] }): void {
    this.serverUrl = cfg.serverUrl;
    this.key       = cfg.key;
    this._roles    = cfg.roles ?? [];
    this.wsService.connect(cfg.serverUrl);
    setTimeout(() => {
      this.wsService.registerFleet(cfg.team, cfg.vessels, cfg.key || undefined);
    }, 10000);
  }

  toggleDebug():    void { this.showDebug = !this.showDebug; }
  toggleAutoPilot():void { this.autoPilotService.toggle(); }

  reset(): void {
    this.autoPilotService.enabled$.value && this.autoPilotService.toggle();
    this.battleReady    = false;
    this.selectedVessel = null;
    this.vessels        = [];
    this.wsService.vesselIds$.next([]);
  }

  selectVessel(v: VesselConnection): void {
    this.selectedVessel = v;
  }
}
