import * as THREE from 'three';

export class Hands {
  public group: THREE.Group;
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;

  private walkTime = 0;
  private idleTime = 0;
  private isWalking = false;
  private isVisible = true;

  private isPunching = false;
  private punchProgress = 0;
  private readonly punchDuration = 0.35;

  // Руки вытянуты вперёд, рукава уходят за нижний край экрана
  private readonly leftRest = new THREE.Vector3(-0.24, -0.2, -0.5);
  private readonly rightRest = new THREE.Vector3(0.24, -0.2, -0.5);

  constructor() {
    this.group = new THREE.Group();

    const skin = new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.75 });
    const skinD = new THREE.MeshStandardMaterial({ color: 0xc49464, roughness: 0.8 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0xff6b35, roughness: 0.85 });
    const sleeveD = new THREE.MeshStandardMaterial({ color: 0xe05a2a, roughness: 0.85 });

    this.leftArm = this.buildArm(true, skin, skinD, sleeve, sleeveD);
    this.rightArm = this.buildArm(false, skin, skinD, sleeve, sleeveD);

    this.leftArm.position.copy(this.leftRest);
    this.rightArm.position.copy(this.rightRest);

    this.group.add(this.leftArm, this.rightArm);
  }

  private buildArm(
    isLeft: boolean,
    skin: THREE.Material, skinD: THREE.Material,
    sleeve: THREE.Material, sleeveD: THREE.Material
  ): THREE.Group {
    const arm = new THREE.Group();
    const s = isLeft ? -1 : 1;

    // === ПЛЕЧЕВАЯ ЧАСТЬ — уходит за экран вниз-назад ===
    // Плечо (большой блок, уходит за нижний край)
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.25), sleeve);
    shoulder.position.set(s * 0.03, -0.06, 0.3);
    shoulder.rotation.x = 0.4;
    arm.add(shoulder);

    // Верхняя часть рукава (переход к плечу)
    const upperSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.18), sleeve);
    upperSleeve.position.set(s * 0.02, -0.04, 0.2);
    upperSleeve.rotation.x = 0.2;
    arm.add(upperSleeve);

    // Рукав (средняя часть)
    const midSleeve = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.14), sleeve);
    midSleeve.position.set(0, -0.01, 0.1);
    arm.add(midSleeve);

    // Манжета
    const cuffMesh = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, 0.03), sleeveD);
    cuffMesh.position.set(0, 0, 0.02);
    arm.add(cuffMesh);

    // === ПРЕДПЛЕЧЬЕ (кожа) ===
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.065, 0.1), skin);
    forearm.position.set(0, 0, -0.04);
    arm.add(forearm);

    // Запястье
    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.058, 0.03), skinD);
    wrist.position.set(0, 0, -0.1);
    arm.add(wrist);

    // === КУЛАК ===
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.07), skin);
    palm.position.set(0, -0.005, -0.14);
    arm.add(palm);

    // Тыльная сторона ладони
    const backHand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.01, 0.06), skinD);
    backHand.position.set(0, 0.02, -0.14);
    arm.add(backHand);

    // Костяшки
    for (let i = 0; i < 4; i++) {
      const kn = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.014, 0.014), skinD);
      kn.position.set(-0.026 + i * 0.018, 0.015, -0.175);
      arm.add(kn);
    }

    // 4 пальца (согнуты в кулак)
    for (let i = 0; i < 4; i++) {
      const f1 = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.032, 0.016), skin);
      f1.position.set(-0.026 + i * 0.018, -0.01, -0.18);
      arm.add(f1);
      const f2 = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.022, 0.014), skinD);
      f2.position.set(-0.026 + i * 0.018, -0.025, -0.17);
      arm.add(f2);
    }

    // Большой палец
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.02), skin);
    thumb.position.set(s * 0.048, -0.005, -0.13);
    thumb.rotation.z = s * 0.4;
    arm.add(thumb);

    return arm;
  }

  setWalking(w: boolean) { this.isWalking = w; }
  setVisible(v: boolean) { this.isVisible = v; this.group.visible = v; }

  startPunch() {
    if (this.isPunching) return;
    this.isPunching = true;
    this.punchProgress = 0;
  }

  update(delta: number) {
    if (!this.isVisible) return;
    this.idleTime += delta;

    if (this.isPunching) {
      this.punchProgress += delta / this.punchDuration;
      if (this.punchProgress >= 1) { this.isPunching = false; this.punchProgress = 0; }
      else {
        const p = this.punchProgress;
        const ease = (t: number) => 1 - (1 - t) ** 3;

        if (p < 0.2) {
          const t = ease(p / 0.2);
          this.rightArm.position.set(this.rightRest.x + t * 0.03, this.rightRest.y + t * 0.04, this.rightRest.z + t * 0.1);
          this.rightArm.rotation.x = t * 0.25;
        } else if (p < 0.45) {
          const t = ease((p - 0.2) / 0.25);
          this.rightArm.position.set(this.rightRest.x, this.rightRest.y + 0.04 * (1 - t), this.rightRest.z + 0.1 - t * 0.3);
          this.rightArm.rotation.x = 0.25 - t * 0.45;
        } else {
          const t = ease((p - 0.45) / 0.55);
          this.rightArm.position.set(this.rightRest.x, this.rightRest.y + 0.015 * (1 - t), this.rightRest.z - 0.2 + t * 0.2);
          this.rightArm.rotation.x = -0.2 * (1 - t);
        }
        const lr = Math.sin(p * Math.PI) * 0.015;
        this.leftArm.position.set(this.leftRest.x, this.leftRest.y + lr, this.leftRest.z - lr);
        this.leftArm.rotation.x = 0;
        return;
      }
    }

    const breathe = Math.sin(this.idleTime * 1.8) * 0.004;
    const sway = Math.sin(this.idleTime * 1.3) * 0.002;

    if (this.isWalking) {
      this.walkTime += delta * 7;
      const swL = Math.sin(this.walkTime) * 0.035;
      const swR = Math.sin(this.walkTime + Math.PI) * 0.035;
      const bob = Math.abs(Math.sin(this.walkTime)) * 0.012;

      this.leftArm.position.set(this.leftRest.x + sway, this.leftRest.y + bob, this.leftRest.z + swL);
      this.leftArm.rotation.x = swL * 0.6;
      this.rightArm.position.set(this.rightRest.x - sway, this.rightRest.y + bob, this.rightRest.z + swR);
      this.rightArm.rotation.x = swR * 0.6;
    } else {
      const sp = delta * 6;
      for (const [arm, rest] of [[this.leftArm, this.leftRest], [this.rightArm, this.rightRest]] as [THREE.Group, THREE.Vector3][]) {
        arm.position.x += (rest.x + sway - arm.position.x) * sp;
        arm.position.y += (rest.y + breathe - arm.position.y) * sp;
        arm.position.z += (rest.z - arm.position.z) * sp;
        arm.rotation.x += (0 - arm.rotation.x) * sp;
      }
    }
  }
}
