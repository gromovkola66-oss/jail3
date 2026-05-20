import * as THREE from 'three';
import { FirstPersonController } from '../game/FirstPersonController';
import { Hands } from '../game/Hands';
import { Combat, CombatState } from '../game/Combat';
import { CameraSystem, CameraSystemState } from '../game/CameraSystem';
import { InventorySystem, InventoryState } from '../game/InventorySystem';
import { DoorSystem } from '../game/DoorSystem';
import { MapData } from './MapEditor';
import { getObjectById } from './EditorObjects';
import { soundSystem } from '../game/SoundSystem';

export class PlaytestMode {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private controller: FirstPersonController;
  private hands: Hands;
  private combat: Combat;
  private cameraSystem: CameraSystem;
  private inventory: InventorySystem;
  private doorSystem: DoorSystem;
  private team: 'guard' | 'prisoner';
  private colliders: THREE.Box3[] = [];
  private doorColliders: Map<string, THREE.Box3[]> = new Map();
  private inTerminalMode = false;

  private isRunning = false;
  private prevTime = 0;
  private footstepTimer = 0;
  private readonly FOOTSTEP_INTERVAL = 0.4;

  private raycaster = new THREE.Raycaster();
  private boundOnResize = this.onResize.bind(this);

  public onStatsUpdate?: (fps: number, pos: THREE.Vector3) => void;
  public onCombatUpdate?: (state: CombatState) => void;
  public onCameraSystemUpdate?: (state: CameraSystemState) => void;
  public onInventoryUpdate?: (state: InventoryState) => void;
  public onDoorStateUpdate?: (cellsOpen: boolean) => void;

  private frameCount = 0;
  private fpsTime = 0;
  private currentFps = 0;

  constructor(container: HTMLElement, mapData: MapData, team: 'guard' | 'prisoner') {
    // Сцена
    this.scene = new THREE.Scene();
    this.scene.background = null;

    // Sky dome
    const skyGeo = new THREE.SphereGeometry(400, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          vec3 topColor = vec3(0.04, 0.1, 0.29);
          vec3 midColor = vec3(0.29, 0.56, 0.85);
          vec3 horizonColor = vec3(0.78, 0.88, 0.94);
          vec3 warmBand = vec3(1.0, 0.83, 0.63);

          vec3 color;
          if (h > 0.3) {
            color = mix(midColor, topColor, (h - 0.3) / 0.7);
          } else if (h > 0.0) {
            color = mix(horizonColor, midColor, h / 0.3);
          } else if (h > -0.1) {
            color = mix(warmBand, horizonColor, (h + 0.1) / 0.1);
          } else {
            color = warmBand;
          }
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
    this.scene.fog = new THREE.Fog(0xc8e0f0, 20, 80);

    // Рендерер
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Камера
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    // Контроллер
    this.controller = new FirstPersonController(camera);

    // Руки
    this.hands = new Hands(team);
    camera.add(this.hands.group);
    this.scene.add(camera);

    // Боевая система
    this.combat = new Combat(camera, this.scene, this.hands, {
      spawnDefaultWeapons: false,
      team,
    });
    this.combat.onStateChange = (state) => {
      this.onCombatUpdate?.(state);
    };
    this.combat.onWeaponPickedUp = () => {
      this.inventory.addItem({ id: 'weapon_ak47', name: 'AK-47', icon: '\u{1F52B}', type: 'weapon' });
    };
    this.combat.onWeaponDropped = () => {
      this.inventory.removeItem('weapon_ak47');
    };

    // Inventory system
    this.inventory = new InventorySystem();
    this.inventory.onStateChange = (state) => {
      this.onInventoryUpdate?.(state);
    };
    this.inventory.onOpen = () => {
      document.exitPointerLock();
    };
    this.inventory.onClose = () => {
      document.body.requestPointerLock();
    };
    this.inventory.onEquip = (item) => {
      if (item && item.type === 'weapon') {
        this.combat.takeOutWeapon();
      } else {
        this.combat.putAwayWeapon();
      }
    };

    // Система камер наблюдения
    this.cameraSystem = new CameraSystem(this.scene, this.renderer);
    this.cameraSystem.onStateChange = (state) => {
      this.inTerminalMode = state.inTerminalMode;
      this.onCameraSystemUpdate?.(state);
    };

    // Система дверей
    this.doorSystem = new DoorSystem(this.scene);
    this.team = team;
    this.doorSystem.onDoorStateChange = (doorId, isOpen) => {
      const boxes = this.doorColliders.get(doorId);
      if (!boxes) return;
      if (isOpen) {
        for (const box of boxes) {
          const idx = this.colliders.indexOf(box);
          if (idx >= 0) this.colliders.splice(idx, 1);
        }
      } else {
        for (const box of boxes) {
          if (!this.colliders.includes(box)) {
            this.colliders.push(box);
          }
        }
      }
      this.controller.setColliders(this.colliders);
      this.onDoorStateUpdate?.(this.doorSystem.getDoors().every(d => d.isOpen));
    };

    // Освещение
    this.scene.add(new THREE.AmbientLight(0x808080, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(20, 30, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -42;
    sun.shadow.camera.right = 42;
    sun.shadow.camera.top = 42;
    sun.shadow.camera.bottom = -42;
    sun.shadow.bias = -0.0012;
    this.scene.add(sun);
    this.scene.add(new THREE.DirectionalLight(0xffffee, 0.3).translateX(-20).translateY(10));

    // Загружаем карту
    this.loadMap(mapData, team);

    // Если охрана — даём оружие
    if (team === 'guard') {
      this.combat.giveWeapon();
      // Sync inventory equipped slot to weapon
      const state = this.inventory.getState();
      const weaponIdx = state.slots.findIndex(s => s?.type === 'weapon');
      if (weaponIdx >= 0) {
        this.inventory.equipSlot(weaponIdx);
      }
    }

    // Коллизии
    this.controller.setColliders(this.colliders);
    this.combat.setMapColliders(this.colliders);

    // E key for terminal interaction
    document.addEventListener('keydown', this.onKeyDown);

    // Ресайз
    window.addEventListener('resize', this.boundOnResize);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'KeyQ') {
      if (document.pointerLockElement !== null || this.inventory.getIsOpen()) {
        this.inventory.toggle();
      }
      return;
    }
    if (event.code === 'KeyE') {
      // Terminal exit does NOT require pointer lock (pointer lock is released while in terminal mode)
      if (this.inTerminalMode) {
        this.cameraSystem.exitTerminalMode();
        return;
      }
      // All other E interactions require pointer lock
      if (document.pointerLockElement === null) return;
      if (this.cameraSystem.terminalHighlighted) {
        const playerPos = this.controller.camera.position;
        this.cameraSystem.enterTerminalMode(playerPos);
        return;
      }
      // Door interaction (guards only)
      if (this.team === 'guard') {
        const { canInteract, door } = this.doorSystem.canInteract(this.controller.camera.position);
        if (canInteract && door) {
          this.doorSystem.toggleDoor(door.id);
        }
      }
    }
  };

  private loadMap(mapData: MapData, team: 'guard' | 'prisoner') {
    let spawnPoint: THREE.Vector3 | null = null;
    const spawnType = team === 'guard' ? 'spawn_guard' : 'spawn_prisoner';
    let cameraCount = 0;
    let doorCellIndex = 0;

    for (const objData of mapData.objects) {
      const objType = getObjectById(objData.type);
      if (!objType) continue;

      // Скрипты — не рендерим визуально, но обрабатываем логику
      if (objData.type === 'spawn_prisoner' || objData.type === 'spawn_guard') {
        if (objData.type === spawnType && !spawnPoint) {
          spawnPoint = new THREE.Vector3(objData.position.x, 1.7, objData.position.z);
        }
        continue;
      }

      // Оружие — создаём подбираемое
      if (objData.type === 'weapon_ak47') {
        this.combat.createDroppedWeaponAt(
          new THREE.Vector3(objData.position.x, objData.position.y + 0.5, objData.position.z)
        );
        continue;
      }

      // Terminal - register with camera system
      if (objData.type === 'terminal') {
        const obj = objType.create();
        obj.position.set(objData.position.x, objData.position.y, objData.position.z);
        obj.rotation.y = THREE.MathUtils.degToRad(objData.rotation);
        this.scene.add(obj);
        obj.updateMatrixWorld(true);
        this.addColliders(obj);
        const terminalPos = new THREE.Vector3(objData.position.x, objData.position.y, objData.position.z);
        this.cameraSystem.registerTerminal(
          `terminal_${objData.id}`,
          obj,
          terminalPos,
          objData.groupId ?? 1
        );
        continue;
      }

      // Camera - register with camera system
      if (objData.type === 'camera') {
        cameraCount++;
        const obj = objType.create();
        obj.position.set(objData.position.x, objData.position.y, objData.position.z);
        obj.rotation.y = THREE.MathUtils.degToRad(objData.rotation);
        this.scene.add(obj);
        const camPos = new THREE.Vector3(objData.position.x, objData.position.y + 3.4, objData.position.z);
        const camRot = new THREE.Euler(-0.3, THREE.MathUtils.degToRad(objData.rotation), 0);
        this.cameraSystem.registerCamera(
          `cam_${objData.id}`,
          camPos,
          camRot,
          objData.groupId ?? 1,
          objData.label || `Камера ${cameraCount}`
        );
        continue;
      }

      // Решётка-дверь — регистрируем в системе дверей
      if (objData.type === 'bars_door') {
        const obj = objType.create();
        obj.position.set(objData.position.x, objData.position.y, objData.position.z);
        obj.rotation.y = THREE.MathUtils.degToRad(objData.rotation);
        this.scene.add(obj);
        obj.updateMatrixWorld(true);

        const prevLen = this.colliders.length;
        this.addColliders(obj);
        const doorBoxes = this.colliders.slice(prevLen);

        const rotRad = THREE.MathUtils.degToRad(objData.rotation);
        const pos = new THREE.Vector3(objData.position.x, objData.position.y, objData.position.z);
        const door = this.doorSystem.registerDoor(doorCellIndex, obj, pos, rotRad);
        this.doorColliders.set(door.id, doorBoxes);
        doorCellIndex++;
        continue;
      }

      // Обычные объекты — рендерим и делаем коллизии
      const obj = objType.create();
      obj.position.set(objData.position.x, objData.position.y, objData.position.z);
      obj.rotation.y = THREE.MathUtils.degToRad(objData.rotation);
      this.scene.add(obj);
      obj.updateMatrixWorld(true);

      // Коллизии — берём bounding box каждого меша
      this.addColliders(obj);
    }

    // Спавн
    if (spawnPoint) {
      this.controller.camera.position.copy(spawnPoint);
      // Adjust spawn height based on floor colliders below spawn point
      let bestFloorY = 0;
      for (const collider of this.colliders) {
        if (spawnPoint.x + 0.3 > collider.min.x &&
            spawnPoint.x - 0.3 < collider.max.x &&
            spawnPoint.z + 0.3 > collider.min.z &&
            spawnPoint.z - 0.3 < collider.max.z &&
            collider.max.y <= spawnPoint.y &&
            collider.max.y > bestFloorY) {
          bestFloorY = collider.max.y;
        }
      }
      this.controller.camera.position.y = bestFloorY + 1.7;
    } else {
      this.controller.camera.position.set(0, 1.7, 0);
    }
  }

  private addColliders(group: THREE.Object3D) {
    // Force full scene matrix update so all world matrices are correct
    this.scene.updateMatrixWorld(true);
    
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const box = new THREE.Box3().setFromObject(child);
        if (box.isEmpty()) return;
        
        const size = new THREE.Vector3();
        box.getSize(size);
        
        // Skip flat horizontal surfaces (floors, ceiling panels, stains, cracks)
        if (size.y < 0.1) return;
        // Skip very thin decorative elements (seams, lines, overlays) - only if BOTH horizontal dims are tiny
        if (size.x < 0.03 && size.z < 0.03) return;
        // Skip flat ground-level meshes (floor tiles/panels that are both thin and at ground level)
        if (size.y < 0.15 && box.max.y < 0.2) return;
        
        this.colliders.push(box);
      }
    });
  }

  private onResize() {
    this.controller.camera.aspect = window.innerWidth / window.innerHeight;
    this.controller.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start() {
    this.isRunning = true;
    this.prevTime = performance.now();
    this.animate();
  }

  stop() {
    this.isRunning = false;
  }

  private animate() {
    if (!this.isRunning) return;

    requestAnimationFrame(this.animate.bind(this));

    const time = performance.now();
    const delta = Math.min((time - this.prevTime) / 1000, 0.1);
    this.prevTime = time;

    // FPS
    this.frameCount++;
    this.fpsTime += delta;
    if (this.fpsTime >= 1) {
      this.currentFps = Math.round(this.frameCount / this.fpsTime);
      this.frameCount = 0;
      this.fpsTime = 0;
    }

    // Skip movement in terminal mode
    if (!this.inTerminalMode) {
      // Обновления
      this.controller.update(delta);

      const isMoving = this.controller.isMoving();
      this.hands.setWalking(isMoving);
      this.hands.update(delta);

      // Шаги
      if (isMoving && document.pointerLockElement !== null) {
        this.footstepTimer += delta;
        if (this.footstepTimer >= this.FOOTSTEP_INTERVAL) {
          soundSystem.playFootstep();
          this.footstepTimer = 0;
        }
      } else {
        this.footstepTimer = 0;
      }

      this.combat.update(delta);

      // Door animation
      this.doorSystem.update(delta);

      // Terminal raycast
      this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.controller.camera);
      this.cameraSystem.checkRaycast(this.raycaster);
    }

    this.onStatsUpdate?.(this.currentFps, this.controller.camera.position);

    // Always update camera system (renders terminal screen textures)
    this.cameraSystem.update(delta, this.controller.camera);

    // Render
    if (this.inTerminalMode && this.cameraSystem.selectedCameraIndex !== null) {
      // renderFromCamera already called inside update() above
    } else {
      this.renderer.render(this.scene, this.controller.camera);
    }
  }

  selectCamera(index: number | null) {
    this.cameraSystem.selectCamera(index);
  }

  inventoryEquipSlot(index: number) {
    this.inventory.equipSlot(index);
  }

  inventorySetHovered(index: number | null) {
    this.inventory.setHoveredSlot(index);
  }

  openAllDoors() {
    this.doorSystem.openAllDoors();
  }

  closeAllDoors() {
    this.doorSystem.closeAllDoors();
  }

  hasDoors(): boolean {
    return this.doorSystem.getDoors().length > 0;
  }

  areCellsOpen(): boolean {
    const doors = this.doorSystem.getDoors();
    return doors.length > 0 && doors.every(d => d.isOpen);
  }

  dispose() {
    this.stop();
    this.renderer.domElement.parentElement?.removeChild(this.renderer.domElement);
    this.renderer.dispose();
    this.controller.dispose();
    this.combat.dispose();
    this.cameraSystem.dispose();
    document.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.boundOnResize);
  }
}
