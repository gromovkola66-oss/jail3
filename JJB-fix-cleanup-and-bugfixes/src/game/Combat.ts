import * as THREE from 'three';
import { Weapon } from './Weapon';
import { Hands } from './Hands';
import { soundSystem } from './SoundSystem';

export interface CombatState {
  hp: number;
  maxHp: number;
  hasWeapon: boolean;
  ammo: number;
  maxAmmo: number;
  isDead: boolean;
  isReloading: boolean;
}

export type CombatTeam = 'guard' | 'prisoner';

export interface CombatOptions {
  spawnDefaultWeapons?: boolean;
  team?: CombatTeam;
}

export class Combat {
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private team: CombatTeam;
  
  public weapon: Weapon | null = null;
  public hands: Hands;
  public droppedWeapons: THREE.Group[] = [];
  
  private hp = 100;
  private maxHp = 100;
  private isDead = false;
  
  // Состояние атаки
  private isPunching = false;
  private punchCooldown = 0;
  public punchDamage = 20;
  private punchRange = 2;
  private punchCooldownTime = 0.5; // секунды между ударами
  
  private storedWeapon: Weapon | null = null;

  // Callbacks
  public onStateChange?: (state: CombatState) => void;
  public onHit?: (damage: number) => void;
  public onDeath?: () => void;
  public onCameraRecoil?: (amount: number) => void;
  public onWeaponPickedUp?: (weaponName: string) => void;
  public onWeaponDropped?: () => void;
  
  private boundMouseDown = this.onMouseDown.bind(this);
  private boundKeyDown = this.onKeyDown.bind(this);

  constructor(
    camera: THREE.Camera,
    scene: THREE.Scene,
    hands: Hands,
    options: CombatOptions = {}
  ) {
    this.camera = camera;
    this.scene = scene;
    this.hands = hands;
    this.team = options.team || 'prisoner';
    
    this.setupInput();

    if (options.spawnDefaultWeapons !== false) {
      // Оружие в оружейной для подбора зеками при бунте
      this.createDroppedWeapon(new THREE.Vector3(9, 1, 0));
      this.createDroppedWeapon(new THREE.Vector3(9, 1, 2));
      this.createDroppedWeapon(new THREE.Vector3(9, 1, 4));
    }
  }

  // Выдать оружие игроку (для охраны при спавне)
  giveWeapon() {
    if (this.weapon) return;
    
    this.weapon = new Weapon(this.team);
    this.camera.add(this.weapon.group);
    this.hands.setVisible(false);
    this.notifyStateChange();
    this.onWeaponPickedUp?.(this.weapon.stats.name);
  }

  // Создать подбираемое оружие в указанной позиции
  createDroppedWeaponAt(position: THREE.Vector3) {
    this.createDroppedWeapon(position);
  }

  // Убрать оружие у игрока (при респавне зека)
  removeWeapon() {
    if (!this.weapon) return;
    
    this.camera.remove(this.weapon.group);
    this.weapon = null;
    this.hands.setVisible(true);
    this.notifyStateChange();
  }

  // Put away weapon (hide from camera but keep reference for inventory)
  putAwayWeapon() {
    if (!this.weapon) return;
    this.camera.remove(this.weapon.group);
    this.storedWeapon = this.weapon;
    this.weapon = null;
    this.hands.setVisible(true);
    this.notifyStateChange();
  }

  // Take out stored weapon (re-attach to camera)
  takeOutWeapon() {
    if (!this.storedWeapon) return;
    this.weapon = this.storedWeapon;
    this.storedWeapon = null;
    this.camera.add(this.weapon.group);
    this.hands.setVisible(false);
    this.notifyStateChange();
  }

  private setupInput() {
    document.addEventListener('mousedown', this.boundMouseDown);
    document.addEventListener('keydown', this.boundKeyDown);
  }

  private onMouseDown(event: MouseEvent) {
    if (document.pointerLockElement === null) return;
    
    if (event.button === 0) { // ЛКМ
      if (this.weapon) {
        this.shoot();
      } else {
        this.punch();
      }
    }
  }

  private onKeyDown(event: KeyboardEvent) {
    if (document.pointerLockElement === null) return;
    
    switch (event.code) {
      case 'KeyE':
        this.tryPickupWeapon();
        break;
      case 'KeyG':
        this.dropWeapon();
        break;
      case 'KeyR':
        if (this.weapon && !this.weapon.isCurrentlyReloading() && this.weapon.stats.currentAmmo < this.weapon.stats.maxAmmo) {
          this.weapon.reload();
          soundSystem.playReload();
          this.notifyStateChange();
        }
        break;
    }
  }

  private punch() {
    if (this.isPunching || this.punchCooldown > 0 || this.isDead) return;
    
    this.isPunching = true;
    this.punchCooldown = this.punchCooldownTime;
    
    // Звук удара
    soundSystem.playPunch();
    
    // Анимация удара через hands
    this.hands.startPunch();
    
    // Проверка попадания (raycast от камеры)
    setTimeout(() => {
      this.checkPunchHit();
      this.isPunching = false;
    }, 150);
  }

  private checkPunchHit() {
    const raycaster = new THREE.Raycaster();
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    
    raycaster.set(this.camera.position, direction);
    raycaster.far = this.punchRange;
    
    // Здесь будет проверка попадания по другим игрокам
  }

  private shoot() {
    if (!this.weapon || this.isDead) return;
    
    if (this.weapon.fire()) {
      soundSystem.playGunshot();
      
      // Отдача камеры
      this.onCameraRecoil?.(0.03);
      
      const raycaster = new THREE.Raycaster();
      const direction = this.weapon.getAimDirection(this.camera);
      
      raycaster.set(this.camera.position, direction);
      raycaster.far = this.weapon.stats.range;
      
      const intersects = raycaster.intersectObjects(this.scene.children, true);
      
      if (intersects.length > 0) {
        const hit = intersects[0];
        this.createBulletHole(hit.point, hit.face?.normal);
      }
      
      this.notifyStateChange();
    } else if (this.weapon.stats.currentAmmo <= 0 && !this.weapon.isCurrentlyReloading()) {
      // Сухой щелчок
      soundSystem.playDryFire();
    }
  }

  

  private createBulletHole(position: THREE.Vector3, normal?: THREE.Vector3) {
    const geometry = new THREE.CircleGeometry(0.05, 8);
    const material = new THREE.MeshBasicMaterial({ 
      color: 0x111111,
      side: THREE.DoubleSide
    });
    const hole = new THREE.Mesh(geometry, material);
    hole.position.copy(position);
    
    if (normal) {
      hole.position.add(normal.multiplyScalar(0.01));
      hole.lookAt(position.clone().add(normal));
    }
    
    this.scene.add(hole);
    
    // Удаляем через 30 секунд
    setTimeout(() => {
      this.scene.remove(hole);
    }, 30000);
  }

  private createDroppedWeapon(position: THREE.Vector3) {
    const weaponGroup = new THREE.Group();
    
    const metalMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a2a2a,
      roughness: 0.4,
      metalness: 0.8
    });
    
    const woodMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b4513,
      roughness: 0.8,
      metalness: 0.1
    });

    // Упрощённая модель AK на земле
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.8),
      metalMaterial
    );
    weaponGroup.add(body);

    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.3),
      woodMaterial
    );
    stock.position.set(0, 0, 0.4);
    weaponGroup.add(stock);

    const magazine = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.15, 0.1),
      metalMaterial
    );
    magazine.position.set(0, -0.1, 0);
    weaponGroup.add(magazine);

    weaponGroup.position.copy(position);
    weaponGroup.rotation.z = Math.PI / 2;
    weaponGroup.rotation.y = Math.random() * Math.PI;
    
    // Метаданные для идентификации
    weaponGroup.userData.isWeapon = true;
    weaponGroup.userData.weaponType = 'AK-47';
    
    this.scene.add(weaponGroup);
    this.droppedWeapons.push(weaponGroup);
  }

  private tryPickupWeapon() {
    if (this.weapon || this.storedWeapon || this.isDead) return;
    
    const playerPos = this.camera.position;
    const pickupRange = 2;
    
    for (let i = 0; i < this.droppedWeapons.length; i++) {
      const droppedWeapon = this.droppedWeapons[i];
      const distance = playerPos.distanceTo(droppedWeapon.position);
      
      if (distance < pickupRange) {
        // Подбираем оружие
        this.scene.remove(droppedWeapon);
        this.droppedWeapons.splice(i, 1);
        
        this.weapon = new Weapon(this.team);
        this.camera.add(this.weapon.group);
        
        // Скрываем руки
        this.hands.setVisible(false);
        
        // Звук подбора
        soundSystem.playPickup();
        
        this.notifyStateChange();
        this.onWeaponPickedUp?.('AK-47');
        return;
      }
    }
  }

  private dropWeapon() {
    if (this.isDead) return;

    // If weapon is holstered, take it out first so we can drop it
    if (!this.weapon && this.storedWeapon) {
      this.weapon = this.storedWeapon;
      this.storedWeapon = null;
    }

    if (!this.weapon) return;
    
    // Убираем оружие из камеры
    this.camera.remove(this.weapon.group);
    
    // Создаём выброшенное оружие перед игроком
    const dropDirection = new THREE.Vector3();
    this.camera.getWorldDirection(dropDirection);
    dropDirection.y = 0;
    dropDirection.normalize();
    
    const dropPosition = this.camera.position.clone()
      .add(dropDirection.multiplyScalar(1.5));
    dropPosition.y = 0.5;
    
    this.createDroppedWeapon(dropPosition);
    
    this.weapon = null;
    
    // Показываем руки
    this.hands.setVisible(true);
    
    // Звук выброса
    soundSystem.playDrop();
    
    this.notifyStateChange();
    this.onWeaponDropped?.();
  }

  takeDamage(damage: number) {
    if (this.isDead) return;
    
    this.hp = Math.max(0, this.hp - damage);
    
    if (this.onHit) this.onHit(damage);
    
    if (this.hp <= 0) {
      this.die();
    }
    
    this.notifyStateChange();
  }

  private die() {
    this.isDead = true;
    if (this.onDeath) this.onDeath();
    
    // Выбрасываем оружие при смерти (check storedWeapon too)
    if (this.weapon || this.storedWeapon) {
      this.dropWeapon();
    }
  }

  heal(amount: number) {
    if (this.isDead) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.notifyStateChange();
  }

  respawn() {
    this.hp = this.maxHp;
    this.isDead = false;
    this.notifyStateChange();
  }

  private notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  getState(): CombatState {
    return {
      hp: this.hp,
      maxHp: this.maxHp,
      hasWeapon: this.weapon !== null,
      ammo: this.weapon?.stats.currentAmmo ?? 0,
      maxAmmo: this.weapon?.stats.maxAmmo ?? 0,
      isDead: this.isDead,
      isReloading: this.weapon?.isCurrentlyReloading() ?? false
    };
  }

  update(delta: number) {
    // Обновляем кулдаун удара
    if (this.punchCooldown > 0) {
      this.punchCooldown -= delta;
    }
    
    // Обновляем оружие
    if (this.weapon) {
      const wasReloading = this.weapon.isCurrentlyReloading();
      this.weapon.update(delta);
      const isReloading = this.weapon.isCurrentlyReloading();
      // Обновляем UI при смене состояния перезарядки
      if (wasReloading !== isReloading || (wasReloading && isReloading)) {
        this.notifyStateChange();
      }
    }
    
    // Вращение выброшенного оружия (для визуала)
    for (const dropped of this.droppedWeapons) {
      dropped.rotation.y += delta * 0.5;
      // Небольшое покачивание
      dropped.position.y = 0.5 + Math.sin(performance.now() * 0.002) * 0.05;
    }
  }

  dispose() {
    document.removeEventListener('mousedown', this.boundMouseDown);
    document.removeEventListener('keydown', this.boundKeyDown);
  }
}
