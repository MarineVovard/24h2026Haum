import {
  Component, Input, OnChanges, OnDestroy, AfterViewInit,
  ElementRef, ViewChild, NgZone
} from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import * as THREE from 'three';
import { VesselConnection } from '../../services/vessel.service';
import { VesselState, ScannedObject } from '../../models/protocol.models';

const OBJECT_COLORS: Record<string, number> = {
  vessel:    0xff4444,
  asteroid:  0x888888,
  mine:      0xff8800,
  torpedo:   0xff2200,
  resource:  0x00ffaa,
  explosion: 0xffff00,
};

const WEAPON_DIRS: Record<string, [number,number,number]> = {
  'X+': [1,0,0], 'X-': [-1,0,0],
  'Y+': [0,1,0], 'Y-': [0,-1,0],
  'Z+': [0,0,1], 'Z-': [0,0,-1],
};

@Component({
  selector: 'app-grid',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './grid.component.html',
  styleUrl: './grid.component.scss'
})
export class GridComponent implements OnChanges, AfterViewInit, OnDestroy {

  @Input() vessel: VesselConnection | null = null;
  @Input() autoPilot = false;

  @ViewChild('threeCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  state: VesselState | null = null;
  weaponDir = 'X+';
  weaponDirs = Object.keys(WEAPON_DIRS);

  private sub?: Subscription;
  private renderer!: THREE.WebGLRenderer;
  private scene!:    THREE.Scene;
  private camera!:   THREE.PerspectiveCamera;
  private animId!:   number;
  private objects    = new Map<string, THREE.Object3D>();
  private shipMesh!: THREE.Mesh;
  private isDragging = false;
  private prevMouse  = { x: 0, y: 0 };
  private spherical  = { theta: Math.PI / 5, phi: 1.1, radius: 60 };

  constructor(private ngZone: NgZone) {}

  ngAfterViewInit(): void {
    // Attendre un tick pour que le DOM ait ses dimensions finales
    setTimeout(() => this.initThree(), 0);
  }

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    if (this.vessel) {
      this.sub = this.vessel.state$.subscribe(s => {
        this.state = s;
        this.updateScene();
      });
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    cancelAnimationFrame(this.animId);
    this.renderer?.dispose();
  }

  // ── Three.js init ─────────────────────────────────────────────────────────

  private initThree(): void {
    const canvas = this.canvasRef.nativeElement;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x060612, 1);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x060612, 0.008);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 2000);
    this.updateCameraPosition();

    // Lumières
    this.scene.add(new THREE.AmbientLight(0x334466, 2));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(10, 20, 10);
    this.scene.add(dirLight);

    // Grille XZ (plan horizontal)
    const gridXZ = new THREE.GridHelper(200, 40, 0x1a1a4a, 0x0d0d2a);
    this.scene.add(gridXZ);

    // Axes XYZ
    this.scene.add(new THREE.AxesHelper(20));

    // Vaisseau joueur
    const shipGeo = new THREE.CapsuleGeometry(0.5, 1.5, 4, 8);
    const shipMat = new THREE.MeshPhongMaterial({ color: 0x00ff88, emissive: 0x003322 });
    this.shipMesh = new THREE.Mesh(shipGeo, shipMat);
    this.scene.add(this.shipMesh);

    // Halo
    const haloGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.06, wireframe: true });
    this.shipMesh.add(new THREE.Mesh(haloGeo, haloMat));

    // Étoiles
    this.addStars();

    // Démo : objets de test pour visualiser la 3D immédiatement
    this.addTestObjects();

    // Mouse events
    canvas.addEventListener('mousedown',  e => this.onMouseDown(e));
    canvas.addEventListener('mousemove',  e => this.onMouseMove(e));
    canvas.addEventListener('mouseup',    ()  => this.isDragging = false);
    canvas.addEventListener('mouseleave', ()  => this.isDragging = false);
    canvas.addEventListener('wheel',      e  => { e.preventDefault(); this.onWheel(e); }, { passive: false });

    // ResizeObserver pour adapter le canvas à sa taille CSS réelle
    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(canvas.parentElement!);
    this.onResize();

    this.ngZone.runOutsideAngular(() => this.animate());
  }

  private addStars(): void {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(4500);
    for (let i = 0; i < 4500; i++) pos[i] = (Math.random() - 0.5) * 1000;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(geo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.4, transparent: true, opacity: 0.5 })
    ));
  }

  // Objets de démo pour montrer la 3D avant le premier scan
  private addTestObjects(): void {
    const testPositions: [string, number, number, number][] = [
      ['asteroid',  8,  3,  0],
      ['asteroid', -6,  5,  4],
      ['asteroid',  3, -4, -5],
      ['resource',  0,  6, -4],
      ['resource',  5, -5,  3],
      ['vessel',   -8,  3, -3],
      ['mine',      3,  4,  6],
      ['torpedo',  -4, -3,  2],
    ];
    testPositions.forEach(([type, x, y, z]) => {
      const key = `test_${type}_${x}_${y}_${z}`;
      const fake: ScannedObject = {
        what: type as any,
        position: [x, y, z],
        ts: Date.now() + 99999999,
        isActive: true,
        allyVessel: false
      };
      const mesh = this.createObjectMesh(fake);
      this.scene.add(mesh);
      this.objects.set(key, mesh);
    });
  }

  private animate(): void {
    this.animId = requestAnimationFrame(() => this.animate());
    if (this.shipMesh) this.shipMesh.rotation.y += 0.008;
    // Rotation légère des objets scannés
    this.objects.forEach(obj => { obj.rotation.y += 0.005; });
    this.renderer.render(this.scene, this.camera);
  }

  // ── Mise à jour depuis les scans ──────────────────────────────────────────

  private updateScene(): void {
    if (!this.scene || !this.renderer) return;
    const now     = Date.now();
    const scanned = this.state?.scanned.filter(s => s.ts > now) ?? [];

    // Supprimer les vrais objets scannés expirés (pas les objets de démo)
    const activeKeys = new Set(scanned.map(s => this.objKey(s)));
    this.objects.forEach((mesh, key) => {
      if (!key.startsWith('test_') && !activeKeys.has(key)) {
        this.scene.remove(mesh);
        this.objects.delete(key);
      }
    });

    // Quand on reçoit de vrais scans, supprimer les objets de démo
    if (scanned.length > 0) {
      this.objects.forEach((mesh, key) => {
        if (key.startsWith('test_')) {
          this.scene.remove(mesh);
          this.objects.delete(key);
        }
      });
    }

    // Afficher uniquement les objets avec position fiable (active_scan ou explosion)
    scanned.filter(s => s.isActive).forEach(s => {
      const key = this.objKey(s);
      const existing = this.objects.get(key);
      if (existing) {
        // Mettre à jour la position du mesh existant (après un déplacement du vaisseau)
        existing.position.set(
          s.position[0] ?? 0,
          s.position[1] ?? 0,
          s.position[2] ?? 0
        );
      } else {
        const mesh = this.createObjectMesh(s);
        this.scene.add(mesh);
        this.objects.set(key, mesh);
      }
    });
  }

  private objKey(s: ScannedObject): string {
    // Utiliser uid stable si disponible, sinon fallback sur type+position initiale
    return s.uid ?? `${s.what}_${s.position.join('_')}`;
  }

  private createObjectMesh(s: ScannedObject): THREE.Object3D {
    const color = OBJECT_COLORS[s.what] ?? 0xffffff;
    // Mapping direct : serveur [x, y, z] → Three.js [x, y, z]
    // Pas de swap — les coordonnées relatives du serveur sont utilisées telles quelles
    const px = s.position[0] ?? 0;
    const py = s.position[1] ?? 0;
    const pz = s.position[2] ?? 0;

    let mesh: THREE.Mesh;

    switch (s.what) {
      case 'asteroid':
        mesh = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.7 + Math.random() * 0.3, 0),
          new THREE.MeshPhongMaterial({ color, flatShading: true })
        ); break;
      case 'mine':
        mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.5),
          new THREE.MeshPhongMaterial({ color, wireframe: false, emissive: 0x441100 })
        ); break;
      case 'torpedo':
        mesh = new THREE.Mesh(
          new THREE.ConeGeometry(0.2, 0.8, 6),
          new THREE.MeshPhongMaterial({ color, emissive: color })
        ); break;
      case 'resource':
        mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.6),
          new THREE.MeshPhongMaterial({ color, emissive: 0x004422, transparent: true, opacity: 0.85 })
        ); break;
      case 'vessel':
        mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.35, 1, 4, 8),
          new THREE.MeshPhongMaterial({ color })
        ); break;
      default:
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.35),
          new THREE.MeshBasicMaterial({ color })
        );
    }

    mesh.position.set(px, py, pz);

    return mesh;
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  private onResize(): void {
    const parent = this.canvasRef?.nativeElement?.parentElement;
    if (!parent || !this.renderer) return;
    const rect = parent.getBoundingClientRect();
    const w = rect.width;
    // Hauteur = hauteur du parent minus les controls en haut
    const topBar = this.canvasRef.nativeElement.closest('.grid-wrap')
      ?.querySelector('.top-bar') as HTMLElement | null;
    const topH = topBar?.offsetHeight ?? 0;
    const h = rect.height - topH;
    if (w <= 0 || h <= 0) return;
    this.renderer.setSize(w, h, false);
    this.canvasRef.nativeElement.style.width  = w + 'px';
    this.canvasRef.nativeElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── Orbite caméra ─────────────────────────────────────────────────────────

  private updateCameraPosition(): void {
    const { theta, phi, radius } = this.spherical;
    this.camera.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(0, 0, 0);
  }

  private onMouseDown(e: MouseEvent): void {
    this.isDragging = true;
    this.prevMouse = { x: e.clientX, y: e.clientY };
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;
    const dx = e.clientX - this.prevMouse.x;
    const dy = e.clientY - this.prevMouse.y;
    this.spherical.theta -= dx * 0.008;
    this.spherical.phi    = Math.max(0.05, Math.min(Math.PI - 0.05, this.spherical.phi + dy * 0.008));
    this.prevMouse = { x: e.clientX, y: e.clientY };
    this.updateCameraPosition();
  }

  private onWheel(e: WheelEvent): void {
    this.spherical.radius = Math.max(3, Math.min(200, this.spherical.radius + e.deltaY * 0.1));
    this.updateCameraPosition();
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  energyDisplay(): string { return this.state ? Math.round(this.state.energy).toString() : '0'; }

  move(dx: number, dy: number, dz: number): void { this.vessel?.move3d(dx, dy, dz); }
  scan():   void { this.vessel?.scanRadar(); }
  mine():   void { this.vessel?.dropMine(3.0); }
  ping():   void { this.vessel?.ping(); }

  autodestruct(): void {
    if (confirm('Confirmer l\'autodestruction ?')) this.vessel?.autodestruct();
  }

  fireTorpedo(): void { const [x,y,z] = this.getDir(); this.vessel?.fireTorpedo3d(x,y,z); }
  fireLaser():   void { const [x,y,z] = this.getDir(); this.vessel?.fireLaser3d(x,y,z); }
  fireIem():     void { const [x,y,z] = this.getDir(); this.vessel?.fireIem3d(x,y,z); }

  private getDir(): [number,number,number] { return WEAPON_DIRS[this.weaponDir] ?? [1,0,0]; }
}
