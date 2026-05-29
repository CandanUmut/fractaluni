import * as THREE from 'three';

// Game-feel effects: pooled GPU particles (impacts, sparks, debris), expanding
// explosion shockwaves, screen shake, and hit-stop. World-space; weapons call
// into it. Cheap: one Points draw call for all particles, a small ring pool.

const MAX_PARTICLES = 800;
const MAX_SHOCKWAVES = 8;

export class Effects {
  readonly group = new THREE.Group();

  // particle pool (parallel arrays)
  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly pz = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly vz = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly grav = new Float32Array(MAX_PARTICLES);
  private next = 0;

  private readonly points: THREE.Points;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly sizeAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;

  private readonly shockwaves: { mesh: THREE.Mesh; t: number; dur: number; max: number }[] = [];

  // screen shake + hit-stop
  private shakeAmp = 0;
  private hitStopT = 0;
  private shakeSeed = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setAttribute('size', this.sizeAttr);
    geo.setAttribute('alpha', this.alphaAttr);
    geo.setDrawRange(0, 0);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float a = smoothstep(1.0, 0.0, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  /** Spawn a burst of particles at a world point. */
  burst(
    pos: THREE.Vector3,
    color: THREE.Color,
    count: number,
    speed: number,
    lifeSec: number,
    gravity = -9,
    sizePx = 6,
  ): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_PARTICLES;
      this.px[i] = pos.x;
      this.py[i] = pos.y;
      this.pz[i] = pos.z;
      // random direction in a cone-ish sphere
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u) * (0.5 + Math.random());
      const s = speed * (0.4 + Math.random());
      this.vx[i] = Math.cos(a) * r * s;
      this.vy[i] = (Math.abs(u) + 0.3) * s;
      this.vz[i] = Math.sin(a) * r * s;
      this.life[i] = lifeSec * (0.7 + Math.random() * 0.6);
      this.maxLife[i] = this.life[i];
      this.grav[i] = gravity;
      // stash color + size in attribute buffers directly
      this.colAttr.setXYZ(i, color.r, color.g, color.b);
      this.sizeAttr.setX(i, sizePx * (0.6 + Math.random() * 0.8));
    }
  }

  /** Expanding shockwave ring at a world point. */
  shockwave(pos: THREE.Vector3, maxRadius: number, color: THREE.Color): void {
    let entry = this.shockwaves.find((s) => s.t >= s.dur);
    if (!entry && this.shockwaves.length < MAX_SHOCKWAVES) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 32), mat);
      mesh.rotation.x = -Math.PI / 2;
      this.group.add(mesh);
      entry = { mesh, t: 0, dur: 0.5, max: maxRadius };
      this.shockwaves.push(entry);
    }
    if (!entry) return;
    entry.t = 0;
    entry.dur = 0.5;
    entry.max = maxRadius;
    entry.mesh.position.copy(pos);
    (entry.mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    entry.mesh.visible = true;
  }

  explosion(pos: THREE.Vector3, radius: number, color: THREE.Color): void {
    this.shockwave(pos, radius, color);
    this.burst(pos, color, 90, radius * 3.5, 0.9, -12, 9);
    this.burst(pos, new THREE.Color(0xffd089), 40, radius * 2, 0.5, -4, 12);
    this.addShake(radius * 0.06);
    this.hitStop(0.06);
  }

  addShake(amt: number): void {
    this.shakeAmp = Math.min(0.5, this.shakeAmp + amt);
  }
  hitStop(sec: number): void {
    this.hitStopT = Math.max(this.hitStopT, sec);
  }

  /** Time multiplier for the rest of the game while hit-stopped. */
  get timeFactor(): number {
    return this.hitStopT > 0 ? 0.06 : 1;
  }

  /** Transient camera rotation jitter (radians) to add this frame. */
  getShake(out: THREE.Vector2): THREE.Vector2 {
    if (this.shakeAmp <= 0.0001) return out.set(0, 0);
    this.shakeSeed += 1.7;
    const a = this.shakeAmp * 0.06;
    return out.set(Math.sin(this.shakeSeed * 12.9) * a, Math.cos(this.shakeSeed * 7.3) * a);
  }

  /** Advance on REAL dt (so hit-stop can time itself). */
  update(dt: number): void {
    if (this.hitStopT > 0) this.hitStopT -= dt;
    this.shakeAmp *= Math.exp(-dt * 9);

    // Particles.
    let count = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        this.alphaAttr.setX(i, 0);
        continue;
      }
      this.vy[i]! += this.grav[i]! * dt;
      this.px[i]! += this.vx[i]! * dt;
      this.py[i]! += this.vy[i]! * dt;
      this.pz[i]! += this.vz[i]! * dt;
      this.posAttr.setXYZ(i, this.px[i]!, this.py[i]!, this.pz[i]!);
      this.alphaAttr.setX(i, Math.min(1, this.life[i]! / this.maxLife[i]!));
      count = i + 1;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, count);

    // Shockwaves.
    for (const s of this.shockwaves) {
      if (s.t >= s.dur) {
        s.mesh.visible = false;
        continue;
      }
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const r = 0.6 + k * s.max;
      s.mesh.scale.setScalar(r);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    for (const s of this.shockwaves) {
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
  }
}
