/**
 * SignAI v3 – Real-Time Speech-to-Sign Language Avatar
 * =====================================================
 *
 * Fixed version:
 *  - Avatar placeholder correctly hidden after load/build
 *  - Token case-insensitive matching (T5 outputs uppercase)
 *  - WebSocket auto-reconnect with cleaner status reporting
 *  - Robust procedural avatar fallback
 *  - No silent failures in avatar/animation pipeline
 */

import * as THREE from 'three';
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ════════════════════════════════════════════════════════════
   CONFIG
════════════════════════════════════════════════════════════ */
const CFG = {
  API_BASE:      'http://127.0.0.1:8000',
  WS_URL:        'ws://127.0.0.1:8000/ws/realtime',
  AVATAR_PATH:   '/assets/avatar.glb',
  ANIM_BASE:     '/assets/animations/',
  DEFAULT_ANIM:  'default.glb',
  SIGN_DURATION:  2200,
  CROSSFADE:      0.3,
  SILENCE_MS:     1200,
  PRELOAD_AHEAD:  2,
};

/* ════════════════════════════════════════════════════════════
   UTILITY
════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
function showToast(msg, type = 'info', ms = 3000) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), ms);
}
function now() { return performance.now(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const smooth = t => Math.max(0, Math.min(1, t)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, t)));

/* ════════════════════════════════════════════════════════════
   PARTICLE BACKGROUND
════════════════════════════════════════════════════════════ */
class ParticleSystem {
  constructor(id) {
    this.cvs = $(id);
    if (!this.cvs) return;
    this.ctx = this.cvs.getContext('2d');
    this.pts = [];
    this._resize(); this._init(); this._loop();
    window.addEventListener('resize', () => this._resize());
  }
  _resize() { this.w = this.cvs.width = window.innerWidth; this.h = this.cvs.height = window.innerHeight; }
  _init() {
    for (let i = 0; i < 80; i++)
      this.pts.push({
        x: Math.random() * this.w, y: Math.random() * this.h,
        r: Math.random() * 1.6 + 0.3,
        dx: (Math.random() - .5) * .35, dy: (Math.random() - .5) * .35,
        a: Math.random() * .45 + .1
      });
  }
  _loop() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    for (const p of this.pts) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(99,179,237,${p.a})`; ctx.fill();
      p.x += p.dx; p.y += p.dy;
      if (p.x < 0 || p.x > w) p.dx *= -1;
      if (p.y < 0 || p.y > h) p.dy *= -1;
    }
    requestAnimationFrame(() => this._loop());
  }
}

/* ════════════════════════════════════════════════════════════
   ASL PROCEDURAL SIGN KINEMATICS DICTIONARY
   Authentic poses based on ASL linguistics (Lifeprint/Stokoe)
   Indices: [lUZ, rUZ, lFX, rFX, lHX, rHX, lUX, rUX, spX, spY]
════════════════════════════════════════════════════════════ */
const ASL_SIGNS = {
  // HELLO / HI: Right hand at temple, sweeps outward in salute
  hello: { attack: [0.25, -0.25, -0.1, -2.1, 0.0, 0.4, 0.0, -1.0, 0.0, 0.04], repeats: 1 },
  bye:   { attack: [0.25, -0.3, -0.1, -1.8, 0.0, 0.5, 0.0, -0.9, 0.0, 0.04], repeats: 2 },
  // ME / I: Right index finger points to center of chest
  me:    { attack: [0.2, -0.2, -0.1, -1.9, 0.0, 0.4, 0.0, -0.5, 0.02, -0.05], repeats: 1 },
  i:     { attack: [0.2, -0.2, -0.1, -1.9, 0.0, 0.4, 0.0, -0.5, 0.02, -0.05], repeats: 1 },
  my:    { attack: [0.2, -0.2, -0.1, -1.8, 0.0, 0.3, 0.0, -0.5, 0.02, -0.05], repeats: 1 },
  // YOU / YOUR: Right arm points forward towards viewer
  you:   { attack: [0.2, -0.25, -0.1, -0.5, 0.0, 0.3, 0.0, -0.85, 0.02, 0.0], repeats: 1 },
  your:  { attack: [0.2, -0.25, -0.1, -0.6, 0.0, 0.2, 0.0, -0.8, 0.02, 0.0], repeats: 1 },
  // GO: Both arms point forward and flick outward
  go:    { attack: [0.35, -0.35, -0.8, -0.8, 0.3, -0.3, -0.7, -0.7, 0.05, 0.0], repeats: 2 },
  come:  { attack: [0.3, -0.3, -1.4, -1.4, 0.4, -0.4, -0.5, -0.5, 0.03, 0.0], repeats: 2 },
  // SCHOOL: Both hands at chest, right hand claps down onto left palm
  school:{ attack: [0.4, -0.4, -1.6, -1.8, 0.2, -0.2, -0.7, -0.6, 0.04, 0.0], repeats: 2 },
  // EAT / FOOD: Right hand fingers brought to mouth
  eat:   { attack: [0.2, -0.2, -0.1, -2.3, 0.0, 0.5, 0.0, -0.9, -0.04, 0.0], repeats: 2 },
  food:  { attack: [0.2, -0.2, -0.1, -2.3, 0.0, 0.5, 0.0, -0.9, -0.04, 0.0], repeats: 2 },
  // DRINK / WATER: Right hand tilts cup to mouth
  drink: { attack: [0.2, -0.2, -0.1, -2.2, 0.0, 0.6, 0.0, -0.85, -0.03, 0.0], repeats: 2 },
  water: { attack: [0.2, -0.2, -0.1, -2.2, 0.0, 0.5, 0.0, -0.8, -0.02, 0.0], repeats: 2 },
  // WANT: Hands extended forward, palms up, pulling in to body
  want:  { attack: [0.4, -0.4, -0.8, -0.8, 0.3, -0.3, -0.8, -0.8, 0.05, 0.0], repeats: 1 },
  need:  { attack: [0.2, -0.25, -0.1, -1.5, 0.0, 0.5, 0.0, -0.6, 0.02, 0.0], repeats: 2 },
  // HELP: Left flat palm up, right fist placed on top and lifted
  help:  { attack: [0.35, -0.35, -1.6, -1.7, 0.2, -0.2, -0.6, -0.6, 0.03, 0.0], repeats: 2 },
  // THANK YOU / THANKS: Hand starts at chin and moves forward
  thankyou: { attack: [0.2, -0.2, -0.1, -2.2, 0.0, 0.4, 0.0, -0.8, 0.0, 0.0], repeats: 1 },
  thanks:   { attack: [0.2, -0.2, -0.1, -2.2, 0.0, 0.4, 0.0, -0.8, 0.0, 0.0], repeats: 1 },
  // PLEASE / SORRY: Circular rub on chest
  please: { attack: [0.25, -0.25, -0.1, -1.8, 0.0, 0.3, 0.0, -0.5, 0.02, 0.0], repeats: 2 },
  sorry:  { attack: [0.25, -0.25, -0.1, -1.8, 0.0, 0.3, 0.0, -0.5, 0.02, 0.0], repeats: 2 },
  // EMOTIONS
  happy: { attack: [0.35, -0.35, -1.7, -1.7, 0.3, -0.3, -0.5, -0.5, 0.03, 0.0], repeats: 2 },
  sad:   { attack: [0.3, -0.3, -1.5, -1.5, 0.2, -0.2, -0.4, -0.4, -0.06, 0.0], repeats: 1 },
  love:  { attack: [0.3, -0.3, -1.9, -1.9, 0.3, -0.3, -0.6, -0.6, 0.04, 0.0], repeats: 1 },
  like:  { attack: [0.2, -0.25, -0.1, -1.6, 0.0, 0.3, 0.0, -0.6, 0.02, 0.0], repeats: 1 },
  // AFFIRMATION & NEGATION
  yes:   { attack: [0.25, -0.25, -0.1, -1.5, 0.0, 0.5, 0.0, -0.6, 0.02, 0.0], repeats: 2 },
  no:    { attack: [0.25, -0.25, -0.1, -1.4, 0.0, 0.3, 0.0, -0.7, 0.02, 0.0], repeats: 2 },
  not:   { attack: [0.25, -0.25, -0.1, -2.0, 0.0, 0.4, 0.0, -0.7, 0.0, 0.0], repeats: 1 },
  // QUESTIONS
  what:  { attack: [0.5, -0.5, -1.2, -1.2, 0.4, -0.4, -0.6, -0.6, 0.04, 0.0], repeats: 2 },
  where: { attack: [0.3, -0.25, -0.1, -1.5, 0.0, 0.4, 0.0, -0.7, 0.03, 0.0], repeats: 2 },
  hospital: { attack: [0.35, -0.2, -0.8, -1.8, 0.1, 0.3, -0.4, -0.6, 0.02, 0.0], repeats: 2 },
  doctor:   { attack: [0.3, -0.3, -1.6, -1.7, 0.1, -0.1, -0.5, -0.5, 0.02, 0.0], repeats: 2 },
  work:     { attack: [0.35, -0.35, -1.6, -1.6, 0.2, -0.2, -0.6, -0.6, 0.03, 0.0], repeats: 2 },
  learn:    { attack: [0.35, -0.25, -1.5, -1.9, 0.2, 0.4, -0.5, -0.9, 0.03, 0.0], repeats: 2 },
  study:    { attack: [0.35, -0.25, -1.5, -1.8, 0.2, 0.3, -0.5, -0.8, 0.03, 0.0], repeats: 2 },
  time:     { attack: [0.3, -0.3, -1.5, -1.6, 0.1, -0.1, -0.5, -0.5, 0.02, 0.0], repeats: 2 },
  good:     { attack: [0.25, -0.3, -0.2, -1.9, 0.0, 0.3, 0.0, -0.7, 0.02, 0.0], repeats: 1 },
  morning:  { attack: [0.3, -0.35, -1.3, -1.5, 0.2, -0.2, -0.5, -0.6, 0.03, 0.0], repeats: 1 },
  coffee:   { attack: [0.35, -0.35, -1.7, -1.7, 0.2, -0.2, -0.6, -0.6, 0.03, 0.0], repeats: 2 },
  tea:      { attack: [0.35, -0.3, -1.6, -1.8, 0.2, 0.1, -0.5, -0.6, 0.02, 0.0], repeats: 2 },
  '1': { attack: [0.2, -0.25, -0.1, -1.8, 0.0, 0.3, 0.0, -0.6, 0.02, 0.0], repeats: 1 },
  '2': { attack: [0.2, -0.25, -0.1, -1.8, 0.0, 0.3, 0.0, -0.6, 0.02, 0.0], repeats: 1 },
  '3': { attack: [0.2, -0.25, -0.1, -1.8, 0.0, 0.3, 0.0, -0.6, 0.02, 0.0], repeats: 1 },
  '4': { attack: [0.2, -0.25, -0.1, -1.8, 0.0, 0.3, 0.0, -0.6, 0.02, 0.0], repeats: 1 },
  '5': { attack: [0.2, -0.25, -0.1, -1.8, 0.0, 0.3, 0.0, -0.6, 0.02, 0.0], repeats: 1 },
};

/* ════════════════════════════════════════════════════════════
   AVATAR RENDERER
════════════════════════════════════════════════════════════ */
class AvatarRenderer {
  constructor(canvasId) {
    this.cvs    = $(canvasId);
    this.mixer  = null;
    this.avatar = null;
    this.clock  = new THREE.Clock();
    this._ready = false;
    this._clips = {};
    this._currentAction = null;
    this._crossfadeMs   = CFG.CROSSFADE;
    this._proceduralActive = false;

    // Procedural bone refs
    this._lUpperArm = null; this._rUpperArm = null;
    this._lForearm  = null; this._rForearm  = null;
    this._lHand     = null; this._rHand     = null;
    this.headGroup  = null; this.spine      = null;

    // Cancellation token – increment to instantly kill any in-flight rAF loop
    this._animToken = 0;
    // Expression animation token – increments to cancel any in-flight expression
    this._exprToken = 0;
    // Base avatar yaw orientation
    this._baseRotY  = 0;

    this._initScene();
    this._initLights();
    this._initControls();
    this._loader = new GLTFLoader();
    this._loadAvatar();
    this._animate();

    // Attach ResizeObserver to canvas parent to prevent stretching/growing during voice input
    const wrapper = this.cvs.parentElement;
    if (wrapper && window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this._onResize());
      this._ro.observe(wrapper);
    }
    window.addEventListener('resize', () => this._onResize());
  }

  _initScene() {
    const wrapper = this.cvs.parentElement;
    const w = wrapper ? wrapper.clientWidth : (this.cvs.clientWidth || 600);
    const h = wrapper ? wrapper.clientHeight : (this.cvs.clientHeight || 450);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.cvs, antialias: true, alpha: true });
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f1e);
    this.scene.fog = new THREE.FogExp2(0x0a0f1e, 0.028);

    const floorGeo = new THREE.PlaneGeometry(12, 12);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0d1525, roughness: 0.95, metalness: 0.05 });
    const floor    = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.05, 50);
    this.camera.position.set(0, 1.25, 3.2);
  }

  _initLights() {
    this.scene.add(new THREE.AmbientLight(0xfff4e0, 0.55));
    const key = new THREE.SpotLight(0xfff6d9, 3.8, 12, 0.45, 0.4);
    key.position.set(1.8, 4.5, 3.0);
    key.target.position.set(0, 1.1, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.001;
    this.scene.add(key); this.scene.add(key.target);
    const fill = new THREE.DirectionalLight(0x89b4e8, 1.2);
    fill.position.set(-2.5, 3.5, 1.5);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0x6ec6ff, 1.5);
    rim.position.set(0, 2.0, -3.5);
    this.scene.add(rim);
    const hair = new THREE.PointLight(0xffe8cc, 1.2, 4.5);
    hair.position.set(0, 3.2, -1.0);
    this.scene.add(hair);
    const bounce = new THREE.PointLight(0xff9966, 0.4, 3);
    bounce.position.set(0, 0.1, 0.6);
    this.scene.add(bounce);
    this.scene.add(new THREE.HemisphereLight(0x2a3a5a, 0x0a0810, 0.4));
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping  = true;
    this.controls.dampingFactor  = 0.05;
    this.controls.minDistance    = 1.0;
    this.controls.maxDistance    = 5.0;
    this.controls.minPolarAngle  = Math.PI * 0.08;
    this.controls.maxPolarAngle  = Math.PI * 0.7;
    this.controls.target.set(0, 1.05, 0);
    this.controls.update();
  }

  _loadAvatar() {
    const localUrl = `${CFG.API_BASE}${CFG.AVATAR_PATH}`;
    this._loader.load(
      localUrl,
      gltf => {
        // If GLB has real animation clips, load it
        if (gltf.animations && gltf.animations.length > 0) {
          console.log('[SignAI] Local avatar.glb with embedded clips loaded successfully');
          this._onGLTFLoaded(gltf);
          showToast('Avatar with GLB animations loaded! ✨', 'success');
        } else {
          // If GLB has no clips (placeholder or static mesh), build the full procedural avatar
          // which has full 5-finger hands, jacket, facial features, and 100% working ASL arm animations
          console.log('[SignAI] avatar.glb has no embedded animations. Activating procedural 3D avatar.');
          this._buildProceduralAvatar();
          showToast('SignAI 3D Avatar Ready ✨', 'success');
        }
      },
      xhr => {},
      err => {
        console.warn('[SignAI] Local avatar.glb failed, using procedural:', err.message || err);
        this._buildProceduralAvatar();
      }
    );
  }

  _onGLTFLoaded(gltf) {
    try {
      const root = gltf.scene;

      // Auto-scale to ~1.75m
      const box  = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const s    = 1.75 / Math.max(size.y, 0.001);
      root.scale.setScalar(s);

      // Place feet on floor
      const boxS = new THREE.Box3().setFromObject(root);
      root.position.y -= boxS.min.y;

      // Center horizontally
      const c = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
      root.position.x -= c.x;
      root.position.z -= c.z;

      root.traverse(n => {
        if (n.isMesh) {
          n.castShadow    = true;
          n.receiveShadow = true;
          if (n.material) {
            n.material.envMapIntensity = 1.2;
            if (n.material.map) n.material.map.anisotropy = 8;
          }
        }
      });

      this.scene.add(root);
      this.avatar = root;
      this.mixer = new THREE.AnimationMixer(root);

      if (gltf.animations?.length) {
        gltf.animations.forEach(clip => {
          this._clips[clip.name.toLowerCase()] = clip;
        });
        console.log('[SignAI] GLB embedded clips:', Object.keys(this._clips));
        const idle = this._clips['idle'] || Object.values(this._clips)[0];
        if (idle) {
          const a = this.mixer.clipAction(idle);
          a.setLoop(THREE.LoopRepeat).play();
          this._currentAction = a;
        }
      } else {
        console.warn('[SignAI] GLB has NO embedded animations – switching to skeleton-driven procedural mode');
      }

      // ── CRITICAL: map skeleton bones so procedural signs can drive the avatar ──
      this._mapSkeletonBones(root);

      this._ready = true;
      this._hidePlaceholder();
    } catch (err) {
      console.error('[SignAI] _onGLTFLoaded error:', err);
      this._buildProceduralAvatar();
    }
  }

  /**
   * Scan the loaded GLB for humanoid skeleton bones and bind them to the
   * same references used by _playProceduralSign().  Works with ReadyPlayerMe,
   * Mixamo, VRM and most standard rigged avatars.
   */
  _mapSkeletonBones(root) {
    // Collect every bone: first via SkinnedMesh.skeleton (most reliable),
    // then fall back to isBone traversal.
    const boneSet = new Set();
    root.traverse(n => {
      if (n.isSkinnedMesh && n.skeleton?.bones) {
        n.skeleton.bones.forEach(b => boneSet.add(b));
      }
      if (n.isBone) boneSet.add(n);
    });

    const bones = [...boneSet];
    console.log('[SignAI] Skeleton scan – total bones found:', bones.length);
    if (bones.length) {
      console.log('[SignAI] Bone names:', bones.map(b => b.name).join(', '));
    }

    // Name-pattern matching (case-insensitive, strips separators)
    const nm = s => s.toLowerCase().replace(/[\s_.\-]/g, '');

    for (const bone of bones) {
      const n = nm(bone.name);

      // Left upper arm  (LeftArm / LeftUpperArm / mixamorig:LeftArm)
      if (!this._lUpperArm &&
          (n.includes('leftarm') || n === 'larm' || n.endsWith('leftupperarm') ||
           n === 'leftshoulder' || n === 'shoulderl' || n.includes('l_upperarm'))) {
        this._lUpperArm = bone;
        console.log('[SignAI] 🦾 L.UpperArm →', bone.name);
      }
      // Right upper arm
      if (!this._rUpperArm &&
          (n.includes('rightarm') || n === 'rarm' || n.endsWith('rightupperarm') ||
           n === 'rightshoulder' || n === 'shoulderr' || n.includes('r_upperarm'))) {
        this._rUpperArm = bone;
        console.log('[SignAI] 🦾 R.UpperArm →', bone.name);
      }
      // Left forearm
      if (!this._lForearm &&
          (n.includes('leftforearm') || n.includes('lforearm') ||
           n.includes('leftlowerarm') || n.includes('leftelbow') ||
           n.includes('l_forearm'))) {
        this._lForearm = bone;
        console.log('[SignAI] 💪 L.Forearm →', bone.name);
      }
      // Right forearm
      if (!this._rForearm &&
          (n.includes('rightforearm') || n.includes('rforearm') ||
           n.includes('rightlowerarm') || n.includes('rightelbow') ||
           n.includes('r_forearm'))) {
        this._rForearm = bone;
        console.log('[SignAI] 💪 R.Forearm →', bone.name);
      }
      // Left hand / wrist
      if (!this._lHand &&
          (n.includes('lefthand') || n === 'lhand' || n.includes('leftwrist') ||
           n.includes('l_hand'))) {
        this._lHand = bone;
        console.log('[SignAI] ✋ L.Hand →', bone.name);
      }
      // Right hand / wrist
      if (!this._rHand &&
          (n.includes('righthand') || n === 'rhand' || n.includes('rightwrist') ||
           n.includes('r_hand'))) {
        this._rHand = bone;
        console.log('[SignAI] 🤚 R.Hand →', bone.name);
      }
      // Spine / chest / hips (use the first one found)
      if (!this.spine &&
          (n === 'spine' || n === 'spine1' || n === 'spine2' || n === 'chest' ||
           n === 'upperchest' || n === 'hips' || n === 'pelvis' ||
           n === 'torso' || n.includes('spine'))) {
        this.spine = bone;
        console.log('[SignAI] 🫀 Spine →', bone.name);
      }
      // Head
      if (!this.headGroup &&
          (n === 'head' || n === 'headjnt' || n === 'bip001head' || n.endsWith('head'))) {
        this.headGroup = bone;
        console.log('[SignAI] 👤 Head →', bone.name);
      }
    }

    // ── Fallback: if arm bones still not found, try index-based guesses ─────
    if (!this._lUpperArm && bones.length > 0) {
      console.warn('[SignAI] ⚠️ Arm bones not matched by name – trying partial fallbacks');
      // Try any bone whose name contains "arm"
      const armBones = bones.filter(b => nm(b.name).includes('arm'));
      console.log('[SignAI] Arm-like bones:', armBones.map(b => b.name));
      const lArm = armBones.find(b => nm(b.name).startsWith('l') || nm(b.name).includes('left'));
      const rArm = armBones.find(b => nm(b.name).startsWith('r') || nm(b.name).includes('right'));
      if (lArm) { this._lUpperArm = lArm; console.log('[SignAI] Fallback L.Arm →', lArm.name); }
      if (rArm) { this._rUpperArm = rArm; console.log('[SignAI] Fallback R.Arm →', rArm.name); }
    }

    // ── Last resort: attach virtual animation groups to the avatar root ──────
    // These are invisible Groups; rotating them won't move GLB mesh geometry
    // but prevents _playProceduralSign from silently no-oping.
    if (!this._lUpperArm) {
      console.warn('[SignAI] ❌ No arm bones found. Attaching virtual animation groups.');
      console.warn('[SignAI]    The avatar body will NOT visually move during signs.');
      console.warn('[SignAI]    FIX: Export your GLB with a rigged humanoid skeleton.');

      const makeVirtual = (name, parent) => {
        const g = new THREE.Group(); g.name = name; parent.add(g); return g;
      };
      this._lUpperArm = makeVirtual('virtual_lUpperArm', root);
      this._rUpperArm = makeVirtual('virtual_rUpperArm', root);
      this._lForearm  = makeVirtual('virtual_lForearm',  this._lUpperArm);
      this._rForearm  = makeVirtual('virtual_rForearm',  this._rUpperArm);
      this._lHand     = makeVirtual('virtual_lHand',     this._lForearm);
      this._rHand     = makeVirtual('virtual_rHand',     this._rForearm);
      if (!this.spine)     this.spine     = makeVirtual('virtual_spine', root);
      if (!this.headGroup) this.headGroup = makeVirtual('virtual_head',  root);
    }

    // ── Ensure forearm/hand fallbacks so _playProceduralSign never crashes ─
    if (!this._lForearm)  this._lForearm  = this._lUpperArm;
    if (!this._rForearm)  this._rForearm  = this._rUpperArm;
    if (!this.spine)      this.spine      = root;
    if (!this.headGroup)  this.headGroup  = null;

    const mapped = !!this._lUpperArm && !(this._lUpperArm.name?.startsWith('virtual'));
    console.log(mapped
      ? '[SignAI] ✅ Skeleton bones fully mapped – procedural signs will animate the GLB'
      : '[SignAI] ⚠️  Virtual groups in use – upgrade GLB to rigged avatar for body motion');
  }

  _buildProceduralAvatar() {
    console.log('[SignAI] Building procedural avatar…');
    try {
      const root = new THREE.Group();
      this.spine  = new THREE.Group();
      root.add(this.spine);

      const S  = (c, r = 0.5, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
      const SP = (c, r = 0.3, m = 0, op = 1) => new THREE.MeshPhysicalMaterial({ color: c, roughness: r, metalness: m, opacity: op, transparent: op < 1 });

      const skin      = S(0xf5c5a3, 0.55);
      const skinDark  = S(0xe8aa82, 0.58);
      const skinBlush = S(0xf0a898, 0.50);
      const eyeWhite  = S(0xfafafa, 0.4);
      const eyeIris   = S(0x2e8fa8, 0.3);
      const eyePupil  = S(0x070a10, 0.9);
      const eyeHL     = S(0xffffff, 0.1, 0.3);
      const hairBase  = S(0xd4a843, 0.75);
      const hairLight = S(0xe8c265, 0.70);
      const hairDark  = S(0xa87d2a, 0.80);
      const jacket    = S(0x2c5dcd, 0.65, 0.05);
      const jacketDk  = S(0x1e3f9a, 0.70, 0.05);
      const collar    = S(0x0a1230, 0.70);
      const legging   = S(0x1a1a2a, 0.40, 0.35);
      const leggingHi = S(0x2a2a3e, 0.35, 0.40);
      const shoe      = S(0x0c0c0c, 0.50, 0.20);
      const soleMat   = S(0x1a1a1a, 0.70, 0.05);
      const nail      = SP(0xf0d8c8, 0.25, 0.1);

      const mesh = (geo, mat, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, parent = this.spine) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, py, pz); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
        m.castShadow = m.receiveShadow = true;
        parent.add(m); return m;
      };
      const grp = (px = 0, py = 0, pz = 0, parent = this.spine) => {
        const g = new THREE.Group(); g.position.set(px, py, pz); parent.add(g); return g;
      };

      // Shoes
      [[-0.09], [0.09]].forEach(([x]) => {
        mesh(new THREE.BoxGeometry(0.11, 0.04, 0.26), soleMat, x, 0.02, 0.03, 0, 0, 0, 1, 1, 1, root);
        mesh(new THREE.CapsuleGeometry(0.055, 0.12, 8, 12), shoe, x, 0.075, 0.03, Math.PI / 2, 0, 0, 1, 1, 1, root);
        mesh(new THREE.BoxGeometry(0.07, 0.06, 0.06), shoe, x, 0.03, -0.09, 0, 0, 0, 1, 1, 1, root);
      });

      // Legs
      mesh(new THREE.CapsuleGeometry(0.048, 0.36, 12, 16), legging, -0.09, 0.28, 0, 0, 0, 0, 1, 1, 1, root);
      mesh(new THREE.CapsuleGeometry(0.048, 0.36, 12, 16), legging, 0.09, 0.28, 0, 0, 0, 0, 1, 1, 1, root);
      mesh(new THREE.SphereGeometry(0.052, 12, 10), leggingHi, -0.09, 0.48, 0.01, 0, 0, 0, 1, 1, 1, root);
      mesh(new THREE.SphereGeometry(0.052, 12, 10), leggingHi, 0.09, 0.48, 0.01, 0, 0, 0, 1, 1, 1, root);
      mesh(new THREE.CapsuleGeometry(0.068, 0.34, 12, 16), legging, -0.09, 0.65, 0, 0, 0, 0, 1, 1, 1, root);
      mesh(new THREE.CapsuleGeometry(0.068, 0.34, 12, 16), legging, 0.09, 0.65, 0, 0, 0, 0, 1, 1, 1, root);
      mesh(new THREE.SphereGeometry(0.125, 16, 12), legging, 0, 0.82, 0, 0, 0, 0, 1, 0.65, 1, root);

      // Pelvis & Torso
      mesh(new THREE.CylinderGeometry(0.155, 0.135, 0.24, 24), legging, 0, 0.96, 0, 0, 0, 0, 1, 1, 1, root);
      mesh(new THREE.CapsuleGeometry(0.155, 0.18, 16, 24), skin, 0, 1.08, 0);
      mesh(new THREE.CapsuleGeometry(0.175, 0.20, 16, 24), jacket, 0, 1.27, 0, 0, 0, 0, 1, 0.88, 1);
      mesh(new THREE.CapsuleGeometry(0.185, 0.22, 20, 24), jacket, 0, 1.43, 0, 0, 0, 0, 1, 0.82, 1);
      mesh(new THREE.CylinderGeometry(0.105, 0.175, 0.10, 20), collar, 0, 1.52, 0);
      mesh(new THREE.TorusGeometry(0.170, 0.012, 8, 32), jacketDk, 0, 1.05, 0, Math.PI / 2);
      mesh(new THREE.BoxGeometry(0.022, 0.46, 0.008), jacketDk, 0, 1.32, 0.19);
      mesh(new THREE.CapsuleGeometry(0.030, 0.40, 8, 12), jacketDk, -0.16, 1.28, 0.12, 0, 0, -0.15);
      mesh(new THREE.CapsuleGeometry(0.030, 0.40, 8, 12), jacketDk, 0.16, 1.28, 0.12, 0, 0, 0.15);

      // Shoulders
      mesh(new THREE.SphereGeometry(0.092, 16, 12), jacket, -0.27, 1.50, 0, 0, 0, 0, 1, 0.90, 1);
      mesh(new THREE.SphereGeometry(0.092, 16, 12), jacket, 0.27, 1.50, 0, 0, 0, 0, 1, 0.90, 1);

      // Neck
      mesh(new THREE.CylinderGeometry(0.058, 0.072, 0.18, 20), skin, 0, 1.62, 0);

      // Head
      this.headGroup = grp(0, 1.70, 0, this.spine);
      const hM = (geo, mat, px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px, py, pz); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
        m.castShadow = m.receiveShadow = true;
        this.headGroup.add(m); return m;
      };

      hM(new THREE.SphereGeometry(0.168, 48, 48), skin, 0, 0.168, 0, 0, 0, 0, 1, 1.10, 0.92);
      hM(new THREE.SphereGeometry(0.135, 32, 24), skinDark, 0, 0.01, 0.02, 0, 0, 0, 1, 0.55, 0.82);
      hM(new THREE.SphereGeometry(0.068, 12, 10), skinBlush, -0.108, 0.11, 0.12, 0, 0, 0, 0.65, 0.45, 0.55);
      hM(new THREE.SphereGeometry(0.068, 12, 10), skinBlush, 0.108, 0.11, 0.12, 0, 0, 0, 0.65, 0.45, 0.55);

      // Eyebrows
      hM(new THREE.CapsuleGeometry(0.016, 0.062, 8, 8), skinDark, -0.060, 0.205, 0.170, 0, 0, Math.PI / 2);
      hM(new THREE.CapsuleGeometry(0.016, 0.062, 8, 8), skinDark, 0.060, 0.205, 0.170, 0, 0, Math.PI / 2);

      // Eyes
      [-0.062, 0.062].forEach(ex => {
        hM(new THREE.SphereGeometry(0.028, 16, 12), eyeWhite, ex, 0.168, 0.165);
        hM(new THREE.SphereGeometry(0.018, 14, 12), eyeIris, ex, 0.168, 0.180);
        hM(new THREE.SphereGeometry(0.010, 10, 10), eyePupil, ex, 0.168, 0.185);
        hM(new THREE.SphereGeometry(0.005, 6, 6), eyeHL, ex + 0.006, 0.174, 0.188);
        hM(new THREE.CapsuleGeometry(0.005, 0.048, 6, 6), S(0x0a0a0a, 0.9), ex, 0.184, 0.175, 0, 0, Math.PI / 2);
      });

      // Nose
      hM(new THREE.CapsuleGeometry(0.012, 0.044, 8, 8), skinDark, 0, 0.105, 0.190, 0.28, 0, 0);
      hM(new THREE.SphereGeometry(0.016, 10, 8), skinDark, 0, 0.086, 0.195);

      // Mouth / Lips
      hM(new THREE.CapsuleGeometry(0.011, 0.052, 8, 8), skinBlush, 0, 0.040, 0.188, 0.12, 0, 0);
      hM(new THREE.CapsuleGeometry(0.008, 0.046, 8, 8), skinBlush, 0, 0.024, 0.185, -0.10, 0, 0);

      // Ears
      hM(new THREE.SphereGeometry(0.034, 10, 10), skinDark, -0.170, 0.148, 0.008, 0, 0, 0, 0.48, 0.78, 0.32);
      hM(new THREE.SphereGeometry(0.034, 10, 10), skinDark, 0.170, 0.148, 0.008, 0, 0, 0, 0.48, 0.78, 0.32);
      hM(new THREE.SphereGeometry(0.010, 8, 8), S(0xd4af37, 0.1, 0.9), -0.178, 0.130, 0.012);
      hM(new THREE.SphereGeometry(0.010, 8, 8), S(0xd4af37, 0.1, 0.9), 0.178, 0.130, 0.012);

      // Hair (styled above forehead so eyes and face are visible)
      hM(new THREE.SphereGeometry(0.172, 40, 32, 0, Math.PI * 2, 0, Math.PI * 0.44), hairBase, 0, 0.175, 0);
      hM(new THREE.SphereGeometry(0.155, 24, 18), hairLight, 0, 0.310, -0.02, 0, 0, 0, 1, 0.85, 1);
      hM(new THREE.CapsuleGeometry(0.090, 0.32, 12, 16), hairBase, 0, 0.24, -0.16, 0.15, 0, 0);
      hM(new THREE.CapsuleGeometry(0.075, 0.28, 12, 14), hairLight, -0.06, 0.20, -0.20, 0.20, 0, 0.08);
      hM(new THREE.CapsuleGeometry(0.075, 0.28, 12, 14), hairLight, 0.06, 0.20, -0.20, 0.20, 0, -0.08);
      hM(new THREE.CapsuleGeometry(0.048, 0.24, 8, 10), hairBase, -0.155, 0.24, 0.00, 0.10, 0, -0.28);
      hM(new THREE.CapsuleGeometry(0.048, 0.24, 8, 10), hairBase, 0.155, 0.24, 0.00, 0.10, 0, 0.28);
      hM(new THREE.CapsuleGeometry(0.038, 0.14, 8, 10), hairDark, -0.065, 0.325, 0.10, -0.30, 0, -0.05);
      hM(new THREE.CapsuleGeometry(0.038, 0.14, 8, 10), hairDark, 0.065, 0.325, 0.10, -0.30, 0, 0.05);
      hM(new THREE.CapsuleGeometry(0.032, 0.10, 8, 10), hairDark, 0.000, 0.330, 0.125, -0.35, 0, 0.00);

      // Arms
      const mkArm = (x, rz) => {
        const p = grp(x, 1.50, 0, this.spine);
        mesh(new THREE.CapsuleGeometry(0.066, 0.28, 12, 16), jacket, 0, -0.15, 0, 0, 0, 0, 1, 1, 1, p);
        p.rotation.z = rz;
        return p;
      };
      this._lUpperArm = mkArm(-0.275, 0.20);
      this._rUpperArm = mkArm(0.275, -0.20);

      const mkFore = (parent) => {
        const p = grp(0, -0.34, 0, parent);
        mesh(new THREE.CapsuleGeometry(0.050, 0.26, 12, 16), jacket, 0, -0.13, 0, 0, 0, 0, 1, 1, 1, p);
        mesh(new THREE.TorusGeometry(0.058, 0.012, 8, 20), S(0x222244, 0.4, 0.6), 0, -0.28, 0, Math.PI / 2, 0, 0, 1, 1, 1, p);
        mesh(new THREE.CylinderGeometry(0.036, 0.044, 0.06, 16), skin, 0, -0.30, 0, 0, 0, 0, 1, 1, 1, p);
        const hGroup = grp(0, -0.37, 0, p);
        return { fore: p, hand: hGroup };
      };
      const lF = mkFore(this._lUpperArm); this._lForearm = lF.fore; this._lHand = lF.hand;
      const rF = mkFore(this._rUpperArm); this._rForearm = rF.fore; this._rHand = rF.hand;

      this._buildHand(this._lHand, skin, skinDark, nail, -1);
      this._buildHand(this._rHand, skin, skinDark, nail, 1);

      root.position.y = 0.0;
      this._baseRotY  = 0;
      root.rotation.y = 0;
      this.scene.add(root);
      this.avatar = root;
      this._ready = true;
      this._hidePlaceholder();
      console.log('[SignAI] Procedural avatar built successfully');
      showToast('Avatar ready ✨', 'success');
    } catch (err) {
      console.error('[SignAI] Procedural avatar build error:', err);
      // Still hide placeholder even on error
      this._hidePlaceholder();
    }
  }

  _buildHand(hg, skin, skinDark, nail, side) {
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.072, 0.020), skin);
    palm.castShadow = true; hg.add(palm);

    [[-0.026, -0.044, 0.062, 0.013], [-0.008, -0.041, 0.075, 0.014],
     [0.009, -0.042, 0.068, 0.013], [0.028, -0.048, 0.052, 0.011]
    ].forEach(([fx, fy, len, w]) => {
      const fg = new THREE.Group(); fg.position.set(fx, fy, 0); hg.add(fg);
      [[len * 0.42, -len * 0.22], [len * 0.32, -len * 0.60], [len * 0.22, -len * 0.84]].forEach(([sl, py2]) => {
        const ph = new THREE.Mesh(new THREE.CapsuleGeometry(w * (sl < len * 0.35 ? 1 : 0.85), sl, 6, 8), skin);
        ph.position.y = py2; ph.castShadow = true; fg.add(ph);
      });
      const kn = new THREE.Mesh(new THREE.SphereGeometry(w * 1.05, 8, 6), skinDark);
      kn.position.y = -len * 0.44; fg.add(kn);
      const nl = new THREE.Mesh(new THREE.BoxGeometry(w * 1.3, 0.005, w * 1.4), nail);
      nl.position.set(0, -len * 0.96, 0.007); nl.rotation.x = -0.12; fg.add(nl);
    });

    const tg = new THREE.Group();
    tg.position.set(side * -0.040, -0.012, 0.004);
    tg.rotation.set(0.22, 0, side * 0.52);
    hg.add(tg);
    [[0.040, -0.020], [0.034, -0.056]].forEach(([sl, py2]) => {
      const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.015, sl, 6, 8), skin);
      th.position.y = py2; th.castShadow = true; tg.add(th);
    });
    const tnl = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.004, 0.018), nail);
    tnl.position.set(0, -0.075, 0.006); tg.add(tnl);
  }

  _hidePlaceholder() {
    const el = $('avatar-placeholder');
    if (!el) return;
    // Use both hidden attribute AND CSS class for compatibility
    el.classList.add('hidden');
    el.setAttribute('hidden', '');
    // Force hide via style as failsafe
    el.style.display   = 'none';
    el.style.opacity   = '0';
    el.style.pointerEvents = 'none';
  }

  playSign(signName, url, speed = 1.0, durationMs = CFG.SIGN_DURATION) {
    return new Promise(resolve => {
      if (this.mixer && Object.keys(this._clips).length > 0) {
        this._playGLBSign(signName, url, speed, durationMs, (ok) => {
          if (!ok) this._playProceduralSign(signName, durationMs, resolve);
          else resolve();
        });
      } else {
        this._playProceduralSign(signName, durationMs, resolve);
      }
    });
  }

  async _playGLBSign(name, url, speed, dur, done) {
    name = name.toLowerCase();
    if (!this._clips[name] && url) {
      try {
        const gltf = await this._loader.loadAsync(url);
        if (gltf.animations?.length) {
          const clip = gltf.animations[0];
          clip.name = name;
          this._clips[name] = clip;
        }
      } catch (e) {
        // Animation GLB not available, will use procedural
      }
    }

    const clip = this._clips[name] || this._clips['default'];
    if (!clip) { done(false); return; }

    if (this._currentAction) this._currentAction.fadeOut(this._crossfadeMs);
    const action = this.mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopOnce, 1).fadeIn(this._crossfadeMs).play();
    action.clampWhenFinished = true;
    action.timeScale = speed;
    this._currentAction = action;
    const playMs = clip.duration > 0 ? (clip.duration * 1000 / Math.max(0.1, speed)) : dur;
    setTimeout(() => done(true), playMs);
  }

  _playProceduralSign(name, dur, done) {
    console.log(`[SignAI] ▶ _playProceduralSign('${name}', ${dur}ms) | lUpperArm:`, this._lUpperArm?.name || 'NULL');
    if (!this._lUpperArm) {
      console.error('[SignAI] ❌ _playProceduralSign SKIPPED – _lUpperArm is null.');
      setTimeout(done, dur);
      return;
    }

    this._proceduralActive = true;
    const myToken = ++this._animToken;
    const key = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    const signDef = ASL_SIGNS[key];
    let lUZ, rUZ, lFX, rFX, lHX, rHX, lUX, rUX, spX, spY, repeats;

    if (signDef) {
      [lUZ, rUZ, lFX, rFX, lHX, rHX, lUX, rUX, spX, spY] = signDef.attack;
      repeats = signDef.repeats || 1;
    } else {
      const hash = [...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0xffff, 0);
      const POSES = [
        [0.35, -0.35, -1.6, -1.6, 0.2, -0.2, -0.6, -0.6, 0.02, 0.0],
        [0.25, -0.25, -0.1, -1.8, 0.0, 0.3, 0.0, -0.6, 0.02, 0.0],
        [0.2, -0.2, -0.1, -2.0, 0.0, 0.4, 0.0, -0.7, 0.02, 0.0],
        [0.4, -0.4, -1.2, -1.2, 0.3, -0.3, -0.7, -0.7, 0.03, 0.0],
        [0.3, -0.3, -1.4, -1.4, 0.2, -0.2, -0.5, -0.5, 0.02, 0.0],
      ];
      [lUZ, rUZ, lFX, rFX, lHX, rHX, lUX, rUX, spX, spY] = POSES[hash % POSES.length];
      repeats = 1;
    }

    const t0 = now();
    const ATTACK = Math.min(dur * 0.32, 550);
    const RELEASE = Math.min(dur * 0.26, 450);
    const HOLD = Math.max(0, dur - ATTACK - RELEASE);

    const initPose = {
      lUZ: this._lUpperArm.rotation.z, rUZ: this._rUpperArm.rotation.z,
      lFX: this._lForearm ? this._lForearm.rotation.x : -0.1,
      rFX: this._rForearm ? this._rForearm.rotation.x : -0.1,
      lUX: this._lUpperArm.rotation.x, rUX: this._rUpperArm.rotation.x,
      lHX: this._lHand?.rotation.x || 0, rHX: this._rHand?.rotation.x || 0,
      spX: this.spine?.rotation.x || 0, spY: this.spine?.rotation.y || 0,
    };
    const REST = { lUZ: 0.20, rUZ: -0.20, lFX: -0.1, rFX: -0.1, lUX: 0, rUX: 0, lHX: 0, rHX: 0, spX: 0, spY: 0 };

    const tick = () => {
      if (this._animToken !== myToken) {
        this._proceduralActive = false;
        done();
        return;
      }
      const el = now() - t0;
      if (el < ATTACK) {
        const t = smooth(el / ATTACK);
        this._lUpperArm.rotation.set(initPose.lUX + (lUX - initPose.lUX) * t, 0, initPose.lUZ + (lUZ - initPose.lUZ) * t);
        this._rUpperArm.rotation.set(initPose.rUX + (rUX - initPose.rUX) * t, 0, initPose.rUZ + (rUZ - initPose.rUZ) * t);
        if (this._lForearm) this._lForearm.rotation.x = initPose.lFX + (lFX - initPose.lFX) * t;
        if (this._rForearm) this._rForearm.rotation.x = initPose.rFX + (rFX - initPose.rFX) * t;
        if (this._lHand) this._lHand.rotation.x = initPose.lHX + (lHX - initPose.lHX) * t;
        if (this._rHand) this._rHand.rotation.x = initPose.rHX + (rHX - initPose.rHX) * t;
        if (this.spine) this.spine.rotation.set(initPose.spX + (spX - initPose.spX) * t, initPose.spY + (spY - initPose.spY) * t, 0);
        if (this.headGroup && this.spine) this.headGroup.rotation.y = this.spine.rotation.y * -0.5;
        requestAnimationFrame(tick);
      } else if (el < ATTACK + HOLD) {
        const holdT = (el - ATTACK) / Math.max(HOLD, 1);
        let w = 0;
        if (repeats > 1) {
          w = Math.sin(holdT * Math.PI * 2 * repeats) * 0.12;
        } else {
          w = Math.sin(holdT * Math.PI) * 0.03;
        }
        this._lUpperArm.rotation.z = lUZ + w * 0.4;
        this._rUpperArm.rotation.z = rUZ - w * 0.4;
        if (this._lForearm) this._lForearm.rotation.x = lFX + w * 0.7;
        if (this._rForearm) this._rForearm.rotation.x = rFX + w * 0.7;
        requestAnimationFrame(tick);
      } else if (el < dur) {
        const t = smooth((el - ATTACK - HOLD) / Math.max(RELEASE, 1));
        this._lUpperArm.rotation.set(lUX * (1 - t), 0, lUZ + (REST.lUZ - lUZ) * t);
        this._rUpperArm.rotation.set(rUX * (1 - t), 0, rUZ + (REST.rUZ - rUZ) * t);
        if (this._lForearm) this._lForearm.rotation.x = lFX + (REST.lFX - lFX) * t;
        if (this._rForearm) this._rForearm.rotation.x = rFX + (REST.rFX - rFX) * t;
        if (this._lHand) this._lHand.rotation.x = lHX * (1 - t);
        if (this._rHand) this._rHand.rotation.x = rHX * (1 - t);
        if (this.spine) this.spine.rotation.set(spX * (1 - t), spY * (1 - t), 0);
        if (this.headGroup && this.spine) this.headGroup.rotation.y = this.spine.rotation.y * -0.5;
        requestAnimationFrame(tick);
      } else {
        this._proceduralActive = false;
        done();
      }
    };
    requestAnimationFrame(tick);
  }

  setCrossfade(s) { this._crossfadeMs = Math.max(0, Math.min(0.6, s)); }

  resetPose(instant = false) {
    if (!this._lUpperArm) return;
    const myToken = ++this._animToken;
    this._proceduralActive = false;
    const REST = { lUZ: 0.20, rUZ: -0.20, lFX: -0.1, rFX: -0.1, lUX: 0, rUX: 0, spX: 0, spY: 0 };

    if (instant) {
      this._lUpperArm.rotation.set(REST.lUX, 0, REST.lUZ);
      this._rUpperArm.rotation.set(REST.rUX, 0, REST.rUZ);
      if (this._lForearm) this._lForearm.rotation.x = REST.lFX;
      if (this._rForearm) this._rForearm.rotation.x = REST.rFX;
      if (this._lHand) this._lHand.rotation.set(0, 0, 0);
      if (this._rHand) this._rHand.rotation.set(0, 0, 0);
      if (this.spine) this.spine.rotation.set(0, 0, 0);
      return;
    }

    const dur = 280;
    const t0  = now();
    const curr = {
      lUZ: this._lUpperArm.rotation.z, rUZ: this._rUpperArm.rotation.z,
      lFX: this._lForearm?.rotation.x || 0, rFX: this._rForearm?.rotation.x || 0,
      lUX: this._lUpperArm.rotation.x, rUX: this._rUpperArm.rotation.x,
      spX: this.spine?.rotation.x || 0, spY: this.spine?.rotation.y || 0,
    };
    const tick = () => {
      if (this._animToken !== myToken) return;
      const el = now() - t0;
      if (el >= dur) {
        this._lUpperArm.rotation.set(REST.lUX, 0, REST.lUZ);
        this._rUpperArm.rotation.set(REST.rUX, 0, REST.rUZ);
        if (this._lForearm) this._lForearm.rotation.x = REST.lFX;
        if (this._rForearm) this._rForearm.rotation.x = REST.rFX;
        if (this.spine) this.spine.rotation.set(REST.spX, REST.spY, 0);
        return;
      }
      const t = smooth(el / dur);
      this._lUpperArm.rotation.set(curr.lUX * (1 - t), 0, curr.lUZ + (REST.lUZ - curr.lUZ) * t);
      this._rUpperArm.rotation.set(curr.rUX * (1 - t), 0, curr.rUZ + (REST.rUZ - curr.rUZ) * t);
      if (this._lForearm) this._lForearm.rotation.x = curr.lFX + (REST.lFX - curr.lFX) * t;
      if (this._rForearm) this._rForearm.rotation.x = curr.rFX + (REST.rFX - curr.rFX) * t;
      if (this.spine) {
        this.spine.rotation.set(curr.spX * (1 - t), curr.spY * (1 - t), 0);
        if (this.headGroup) this.headGroup.rotation.y = this.spine.rotation.y * -0.5;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _onResize() {
    const wrapper = this.cvs.parentElement;
    const w = wrapper ? wrapper.clientWidth : (this.cvs.clientWidth || 600);
    const h = wrapper ? wrapper.clientHeight : (this.cvs.clientHeight || 450);
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const delta = this.clock.getDelta();
    const t = this.clock.elapsedTime;

    // Idle breathing & subtle motion – runs for BOTH procedural and GLB avatars
    // (GLB without clips also needs idle so the avatar feels alive)
    const hasProceduralBones = !!this._lUpperArm;
    if (this.avatar && (!this.mixer || Object.keys(this._clips).length === 0)) {
      // Subtle body breathing (only if not currently driving a sign)
      if (!this._proceduralActive) {
        this.avatar.rotation.y = (this._baseRotY || 0) + Math.sin(t * 0.15) * 0.025;
        if (this.headGroup && !this.headGroup.name?.startsWith('virtual')) {
          this.headGroup.rotation.x = Math.sin(t * 0.38) * 0.018;
          this.headGroup.rotation.z = Math.sin(t * 0.22) * 0.012;
        }
        if (hasProceduralBones && !this._proceduralActive) {
          this._lUpperArm.rotation.z = 0.22 + Math.sin(t * 0.45) * 0.01;
          this._rUpperArm.rotation.z = -0.22 - Math.sin(t * 0.45) * 0.01;
        }
      }
    } else if (this.avatar && this.mixer && Object.keys(this._clips).length === 0) {
      // GLB with no embedded clips: gentle avatar rotation so it feels alive
      if (!this._proceduralActive) {
        this.avatar.rotation.y = (this._baseRotY || 0) + Math.sin(t * 0.15) * 0.025;
      }
    }

    if (this.mixer && !this._proceduralActive) this.mixer.update(delta);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  get isReady() { return this._ready; }

  /* ─── Facial Expression System ──────────────────────────────────────────── */

  /**
   * Apply an ASL non-manual signal (NMS) to the avatar via procedural bone motion.
   * Supports: nod, shake, tilt_forward, tilt_back, and eyebrow simulation.
   *
   * @param {Object} expr - facial expression object from facial_service
   */
  applyFacialExpression(expr) {
    if (!expr || !this._ready || !this.headGroup) return;
    const { expression, eyebrows, head_movement,
            intensity = 0.5, duration_ms = 600 } = expr;

    const myToken = ++this._exprToken;

    // Special animated movements handled separately
    if (head_movement === 'nod') {
      this._doHeadNod(intensity, myToken); return;
    }
    if (head_movement === 'shake') {
      this._doHeadShake(intensity, myToken); return;
    }

    // Static target rotation:
    // eyebrow 'raised'   → slight backward tilt (looks like brows up)
    // eyebrow 'furrowed' → slight forward tilt  (looks like brows down)
    // head tilt overrides eyebrow effect
    let targetX = 0;
    if      (eyebrows === 'raised')   targetX = -0.10 * intensity;
    else if (eyebrows === 'furrowed') targetX =  0.06 * intensity;
    if      (head_movement === 'tilt_forward') targetX =  0.18 * intensity;
    else if (head_movement === 'tilt_back')    targetX = -0.15 * intensity;

    const t0 = now();
    const blendDur = 250;
    const startX = this.headGroup.rotation.x;
    const holdMs = Math.max(duration_ms - blendDur, 200);

    const tick = () => {
      if (this._exprToken !== myToken) return;
      const el = now() - t0;
      if (el < blendDur) {
        this.headGroup.rotation.x = startX + (targetX - startX) * smooth(el / blendDur);
        requestAnimationFrame(tick);
      } else {
        this.headGroup.rotation.x = targetX;
        setTimeout(() => { if (this._exprToken === myToken) this._returnExprNeutral(myToken); }, holdMs);
      }
    };
    requestAnimationFrame(tick);
  }

  _doHeadNod(intensity, myToken) {
    if (!this.headGroup) return;
    const t0 = now();
    const phaseDur = 180;   // ms per half-nod
    const cycles   = 2;     // number of nod repetitions
    const tick = () => {
      if (this._exprToken !== myToken) return;
      const el = now() - t0;
      if (el < phaseDur * cycles * 2) {
        const phase = el % (phaseDur * 2);
        const t = phase < phaseDur ? phase / phaseDur : 1 - (phase - phaseDur) / phaseDur;
        this.headGroup.rotation.x = -0.22 * intensity * smooth(t);
        requestAnimationFrame(tick);
      } else {
        this._returnExprNeutral(myToken);
      }
    };
    requestAnimationFrame(tick);
  }

  _doHeadShake(intensity, myToken) {
    if (!this.headGroup) return;
    const t0 = now();
    const totalDur = 600;   // ms of shaking
    const freq = 0.018;     // angular frequency
    const tick = () => {
      if (this._exprToken !== myToken) return;
      const el = now() - t0;
      if (el < totalDur) {
        this.headGroup.rotation.y = Math.sin(el * freq) * 0.28 * intensity;
        requestAnimationFrame(tick);
      } else {
        this._returnExprNeutral(myToken);
      }
    };
    requestAnimationFrame(tick);
  }

  _returnExprNeutral(myToken) {
    if (!this.headGroup || this._exprToken !== myToken) return;
    const t0  = now();
    const dur = 300;
    const sx  = this.headGroup.rotation.x;
    const sy  = this.headGroup.rotation.y;
    const tick = () => {
      if (this._exprToken !== myToken) return;
      const el = now() - t0;
      if (el < dur) {
        const t = smooth(el / dur);
        this.headGroup.rotation.x = sx * (1 - t);
        this.headGroup.rotation.y = sy * (1 - t);
        requestAnimationFrame(tick);
      } else {
        this.headGroup.rotation.x = 0;
        this.headGroup.rotation.y = 0;
      }
    };
    requestAnimationFrame(tick);
  }
}

/* ════════════════════════════════════════════════════════════
   REALTIME ANIMATION ENGINE
════════════════════════════════════════════════════════════ */
class RealtimeEngine {
  constructor(avatar) {
    this.avatar   = avatar;
    this._queue   = [];
    this._playing = false;
    this._stop    = false;
    this._speed   = 1.0;
    this._cur     = -1;
    this._onUpdate = null;
  }

  load(items, autoPlay = true) {
    this._stop    = true;
    this._playing = false;
    this._queue   = items.slice();
    this._cur     = -1;
    this.avatar.resetPose(false); // smooth reset for manual translate
    if (autoPlay && items.length) {
      // Wait just long enough for the reset rAF to register first frame
      setTimeout(() => { this._stop = false; this._run(); }, 30);
    }
  }

  interrupt(items) {
    this._stop    = true;
    this._playing = false;
    this._queue   = items.slice();
    this._cur     = -1;
    this.avatar.resetPose(true);
    setTimeout(() => { this._stop = false; this._run(); }, 20);
  }

  append(items) {
    // If not playing and reached end, clear the finished queue first
    if (!this._playing && this._cur >= this._queue.length) {
      this._queue = [];
      this._cur = -1;
    }
    // Append at the end of the queue for smooth sequential playback
    this._queue.push(...items);
    
    if (!this._playing) {
      this._stop = false;
      this._run();
    } else {
      this._fireUpdate(); // refresh UI queue immediately
    }
  }

  play()  { if (!this._playing) { this._stop = false; this._run(); } }
  pause() { this._stop = true; this._playing = false; }
  stop()  { this._stop = true; this._playing = false; this._cur = -1; this.avatar.resetPose(); this._fireUpdate(); }
  setSpeed(s) { this._speed = Math.max(0.25, Math.min(4, s)); }
  onUpdate(cb) { this._onUpdate = cb; }

  get total()    { return this._queue.length; }
  get current()  { return this._cur; }
  get isPlaying(){ return this._playing; }

  async _run() {
    if (this._playing) return; // prevent re-entrant runs
    this._playing = true;
    this._fireUpdate();
    while (!this._stop) {
      this._cur++;
      if (this._cur >= this._queue.length) break;
      if (this._stop) break;
      this._fireUpdate();
      const item = this._queue[this._cur];
      const dur  = Math.round(CFG.SIGN_DURATION / this._speed);
      console.log(`[SignAI] Engine playing [${this._cur}/${this._queue.length - 1}]: '${item.name}'`);
      await this.avatar.playSign(item.name, item.url, this._speed, dur);
      if (!this._stop) await sleep(Math.round(150 / this._speed));
    }
    this._playing = false;
    if (this._cur >= this._queue.length) this._cur = this._queue.length;
    this._fireUpdate();
  }

  _fireUpdate() {
    this._onUpdate?.(this._cur, this._queue.length, this._queue[this._cur]);
  }
}

/* ════════════════════════════════════════════════════════════
   WEBSOCKET CLIENT
════════════════════════════════════════════════════════════ */
class WSClient {
  constructor(url, onMessage, onStatus) {
    this.url       = url;
    this.onMessage = onMessage;
    this.onStatus  = onStatus;
    this._ws       = null;
    this._alive    = false;
    this._retries  = 0;
    this._keepAlive = null;
    this._connecting = false;
    this.connect();
  }

  connect() {
    if (this._connecting) return;
    this._connecting = true;
    try {
      this._ws = new WebSocket(this.url);
      this._ws.onopen = () => {
        this._alive      = true;
        this._retries    = 0;
        this._connecting = false;
        this.onStatus('ws');
        this._startPing();
        console.log('[SignAI] WebSocket connected');
      };
      this._ws.onclose = (e) => {
        this._alive      = false;
        this._connecting = false;
        this._stopPing();
        this.onStatus('offline');
        console.log('[SignAI] WebSocket closed, code:', e.code);
        if (this._retries < 10) {
          const delay = Math.min(1000 * Math.pow(1.5, this._retries), 20000);
          this._retries++;
          setTimeout(() => this.connect(), delay);
        }
      };
      this._ws.onerror = () => {
        this._alive      = false;
        this._connecting = false;
      };
      this._ws.onmessage = e => {
        try { this.onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
      };
    } catch (err) {
      this._connecting = false;
      console.warn('[SignAI] WebSocket constructor failed:', err);
    }
  }

  send(type, payload = {}) {
    if (!this._alive || this._ws?.readyState !== WebSocket.OPEN) return false;
    this._ws.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  sendText(text) { return this.send('text', { text }); }

  _startPing() { this._keepAlive = setInterval(() => { this.send('ping'); }, 20000); }
  _stopPing()  { clearInterval(this._keepAlive); }

  get connected() { return this._alive; }
}

/* ════════════════════════════════════════════════════════════
   REALTIME SPEECH
════════════════════════════════════════════════════════════ */
class RealtimeSpeech {
  constructor({ onInterim, onFinal, onStart, onStop }) {
    this.onInterim = onInterim;
    this.onFinal   = onFinal;
    this.onStart   = onStart;
    this.onStop    = onStop;
    this._rec          = null;
    this._active       = false;
    this._silenceTimer = null;
    this._lastFinal    = '';
    this._supported    = false;
    this._isLive       = false;  // set by setLiveMode()
    this._init();
  }

  /** Call when live mode is toggled so silence timing adjusts automatically */
  setLiveMode(on) {
    this._isLive = on;
    // If switching to live, flush any accumulated text immediately
    if (on && this._lastFinal.trim()) {
      clearTimeout(this._silenceTimer);
      this.onFinal?.(this._lastFinal.trim(), true);
      this._lastFinal = '';
    }
  }

  _init() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { console.warn('[SignAI] Speech API unavailable'); return; }
    const r           = new SR();
    r.continuous      = true;
    r.interimResults  = true;
    r.lang            = 'en-US';
    r.maxAlternatives = 1;
    r.onstart = () => { this._active = true; this.onStart?.(); };
    r.onresult = event => {
      let interim = '', finalPart = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalPart += res[0].transcript + ' ';
        else             interim   += res[0].transcript;
      }
      if (finalPart) {
        this._lastFinal += finalPart;

        if (this._isLive) {
          // Live mode: commit EACH recognised segment immediately (word-by-word)
          // so the avatar starts signing the moment a word is confirmed.
          clearTimeout(this._silenceTimer);
          const chunk = finalPart.trim();
          if (chunk) {
            this.onFinal?.(chunk, true);
            this._lastFinal = '';   // reset accumulator after each live commit
          }
          // Also set a short 200ms fallback in case more words follow
          this._silenceTimer = setTimeout(() => {
            if (this._lastFinal.trim()) {
              this.onFinal?.(this._lastFinal.trim(), true);
              this._lastFinal = '';
            }
          }, 200);
        } else {
          // Normal mode: accumulate and commit after 500ms of silence
          this.onFinal?.(this._lastFinal.trim());
          clearTimeout(this._silenceTimer);
          this._silenceTimer = setTimeout(() => {
            if (this._lastFinal.trim()) {
              this.onFinal?.(this._lastFinal.trim(), true);
              this._lastFinal = '';
            }
          }, 500);
        }
      }
      if (interim) this.onInterim?.(interim);
    };
    r.onend = () => {
      if (this._active) {
        try { r.start(); } catch { setTimeout(() => { try { r.start(); } catch {} }, 300); }
      } else {
        this.onStop?.();
      }
    };
    r.onerror = e => {
      console.warn('[SignAI] SpeechRecognition error:', e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        showToast('Microphone permission denied', 'error');
        this._active = false; this.onStop?.();
      }
    };
    this._rec = r;
    this._supported = true;
  }

  async start() {
    if (!this._supported) { showToast('Speech API not supported (use Chrome/Edge)', 'error'); return; }
    if (this._active) return;
    
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn('[SignAI] getUserMedia failed:', err);
      showToast('Microphone permission denied', 'error');
      return;
    }

    this._lastFinal = '';
    this._active    = true;
    try {
      this._rec.start();
    } catch (e) {
      console.warn('[SignAI] SpeechRec start error:', e);
    }
  }
  stop() {
    this._active = false;
    clearTimeout(this._silenceTimer);
    // Flush any accumulated speech that wasn't committed yet
    if (this._lastFinal.trim()) {
      this.onFinal?.(this._lastFinal.trim(), true);
      this._lastFinal = '';
    }
    try { this._rec?.stop(); } catch {}
  }
  toggle() { this._active ? this.stop() : this.start(); }
  get isActive()    { return this._active; }
  get isSupported() { return this._supported; }
}

/* ════════════════════════════════════════════════════════════
   SESSION LOG
════════════════════════════════════════════════════════════ */
class SessionLog {
  constructor(listId) {
    this.el     = $(listId);
    this._empty = this.el?.querySelector('.log-empty');
  }
  add(text, gloss) {
    if (!this.el) return;
    if (this._empty) { this._empty.remove(); this._empty = null; }
    const d = document.createElement('div');
    d.className = 'log-item';
    d.innerHTML = `
      <div class="log-original">${this._esc(text)}</div>
      <div class="log-gloss">${this._esc(gloss)}</div>
      <div class="log-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;
    this.el.prepend(d);
  }
  _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
}

/* ════════════════════════════════════════════════════════════
   DEMO MODE (offline fallback)
════════════════════════════════════════════════════════════ */
function demoProcess(sentence) {
  const STOP = new Set(['is','am','are','a','an','the','to','of','in','on','at',
    'for','with','and','or','but','if','do','does','have','will','would',
    'could','should','very','really','so','just']);
  const LEMMA = { going:'go',coming:'come',eating:'eat',drinking:'drink',
    running:'run',talking:'talk',helping:'help',learning:'learn',
    loving:'love',liking:'like',sleeping:'sleep' };
  const SPLIT = new Set(['and','but','or','then','because','so']);

  const words = sentence.toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/);
  let cur = [], chunks = [];
  for (const w of words) {
    if (SPLIT.has(w)) { if (cur.length) chunks.push(cur); cur = []; continue; }
    if (STOP.has(w)) continue;
    cur.push(LEMMA[w] || w);
  }
  if (cur.length) chunks.push(cur);
  if (!chunks.length) chunks = [['hello']];

  const all = chunks.flat();
  return {
    chunks:     chunks.map(c => c.join(' ')),
    all_tokens: all,
    animations: all.map(t => `${t}.glb`),
    urls:       all.map(t => `${CFG.API_BASE}/assets/animations/${t}.glb`),
  };
}

/* ════════════════════════════════════════════════════════════
   SIGN AI APP — Main orchestrator
════════════════════════════════════════════════════════════ */
class SignAIApp {
  constructor() {
    this.avatar   = null;
    this.engine   = null;
    this.speech   = null;
    this.ws       = null;
    this.log      = new SessionLog('log-list');
    this.demoMode = false;
    this._liveMode    = false;
    this._pendingText = '';
    this._wsLatency   = 0;
    this._wsSendTime  = 0;
    this._boot();
  }

  async _boot() {
    new ParticleSystem('bg-canvas');
    this.avatar = new AvatarRenderer('avatar-canvas');
    this.engine = new RealtimeEngine(this.avatar);
    this.engine.onUpdate((cur, total, item) => this._onEngineUpdate(cur, total, item));
    this._setupWS();
    this._setupSpeech();
    this._wireUI();
    // Check API health after a moment
    setTimeout(() => this._checkAPI(), 2000);
  }

  // ── WebSocket ─────────────────────────────────────────────
  _setupWS() {
    this.ws = new WSClient(
      CFG.WS_URL,
      msg  => this._onWSMessage(msg),
      stat => this._onWSStatus(stat)
    );
  }

  _onWSMessage(msg) {
    if (msg.type === 'pong') return;
    if (msg.type === 'error') { showToast(`Server: ${msg.detail}`, 'error'); return; }
    if (msg.type === 'animations') {
      this._wsLatency = Math.round(now() - this._wsSendTime);
      const el = $('latency-val');
      if (el) el.textContent = `${this._wsLatency} ms`;
      const row = $('latency-row');
      if (row) row.hidden = false;
      this._applyAnimations(msg);
    }
  }

  _onWSStatus(stat) {
    const el  = $('api-status');
    if (!el) return;
    const lbl = el.querySelector('.status-label');
    el.className = `status-dot ${stat}`;
    if (lbl) {
      if (stat === 'ws')         lbl.textContent = 'WebSocket Live';
      else if (stat === 'online') lbl.textContent = 'API Online';
      else                        lbl.textContent = 'Reconnecting…';
    }
  }

  // ── Speech ────────────────────────────────────────────────
  _setupSpeech() {
    this.speech = new RealtimeSpeech({
      onInterim: text => this._onInterim(text),
      onFinal:   (text, commit) => this._onFinal(text, commit),
      onStart:   () => this._onSpeechStart(),
      onStop:    () => this._onSpeechStop(),
    });
  }

  _onInterim(text) {
    const si = $('subtitle-interim');
    if (si) si.textContent = ' ' + text;
    const ib = $('interim-badge');
    if (ib) ib.hidden = false;
    const sb = $('subtitle-box');
    if (sb) sb.classList.add('active');
    const cb = $('cursor-blink');
    if (cb) cb.hidden = false;
  }

  _onFinal(text, commit = false) {
    const sf = $('subtitle-final');
    const si = $('subtitle-interim');
    const ib = $('interim-badge');
    if (!commit) {
      // Non-committed partial result — show in subtitle but don't translate yet
      if (sf) sf.textContent = text + ' ';
      if (si) si.textContent = '';
      if (ib) ib.hidden = true;
      // Store as pending so Translate button can pick it up
      this._pendingText = text.trim();
    } else {
      // Committed speech result — ALWAYS translate (live mode or not)
      const finalText = text.trim();
      if (sf) {
        // Append or replace the final text and keep it visible
        if (this._liveMode) {
           sf.textContent = sf.textContent ? sf.textContent.trim() + ' ' + finalText : finalText;
        } else {
           sf.textContent = finalText;
        }
      }
      if (si) si.textContent = '';
      if (ib) ib.hidden = true;
      this._pendingText = '';
      if (finalText) {
        // In live mode use interrupt for snappier response; otherwise use load
        this._translate(finalText, this._liveMode);
        showToast(`Signing: "${finalText}"`, 'info', 2000);
      }
      
      // Clear subtitle box after 4 seconds of silence
      clearTimeout(this._subtitleClearTimer);
      this._subtitleClearTimer = setTimeout(() => {
        if (sf) sf.textContent = '';
      }, 4000);
    }
  }

  _onSpeechStart() {
    const mb = $('btn-mic');
    if (mb) mb.classList.add('recording');
    const mh = $('mic-hint');
    if (mh) mh.textContent = 'Listening…';
    const lb = $('listening-bar');
    if (lb) lb.hidden = false;
    const cb = $('cursor-blink');
    if (cb) cb.hidden = false;
  }

  _onSpeechStop() {
    const mb = $('btn-mic');
    if (mb) mb.classList.remove('recording');
    const mh = $('mic-hint');
    if (mh) mh.innerHTML = 'Click to start <strong>continuous</strong> listening';
    const lb = $('listening-bar');
    if (lb) lb.hidden = true;
    const cb = $('cursor-blink');
    if (cb) cb.hidden = true;
    const sb = $('subtitle-box');
    if (sb) sb.classList.remove('active');
    const ib = $('interim-badge');
    if (ib) ib.hidden = true;
  }

  // ── Translation ───────────────────────────────────────────
  /**
   * 3-Tier translation strategy (mirrors backend hybrid_service.py):
   *   1. WebSocket (lowest latency – hybrid result from server)
   *   2. POST /process-text (hybrid: phrase → word → fingerspell)
   *   3. POST /t5-gloss/chunks + /get-animations (T5 transformer fallback)
   *   4. demoProcess() (offline demo with no backend)
   */
  async _translate(text, isLive = false) {
    text = text.trim();
    if (!text) return;

    this._wsSendTime = now();
    let data;

    // ── Tier 1: WebSocket (already connected → hybrid result from server) ────
    if (!this.demoMode && this.ws?.connected) {
      this.ws.sendText(text);
      return;
    }

    if (!this.demoMode) {
      // ── Tier 2: POST /process-text  (hybrid dataset: phrase→word→spell) ───
      try {
        const res = await fetch(`${CFG.API_BASE}/process-text`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();

        // body = { text, animations: ["me.glb",...], urls: ["http://..."], count }
        const animations = body.animations || [];
        const urls       = body.urls       || [];
        // Derive display tokens from filenames (strip .glb)
        const all_tokens = animations.map(f => f.replace(/\.glb$/i, ''));

        data = {
          sentence:   text,
          chunks:     [all_tokens.join(' ')],   // single display chunk
          all_tokens,
          animations,
          urls,
          facial:  body.facial || null,
          _source: 'hybrid',
        };

        console.log(`[SignAI] ✅ Hybrid /process-text → ${animations.length} animations`);

      } catch (hybridErr) {
        console.warn('[SignAI] /process-text failed, trying T5 fallback:', hybridErr.message);

        // ── Tier 3: T5 gloss + animation mapping (original pipeline) ────────
        try {
          const t5Res = await fetch(`${CFG.API_BASE}/t5-gloss/chunks`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ sentence: text }),
          });
          if (!t5Res.ok) throw new Error(`T5 HTTP ${t5Res.status}`);
          const t5Body = await t5Res.json();

          // T5 returns upper-case tokens; normalize for animation lookup
          const all_tokens = (t5Body.all_tokens || []).map(t => t.toLowerCase());

          const animRes = await fetch(`${CFG.API_BASE}/get-animations`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ gloss: all_tokens.join(' ') }),
          });
          if (!animRes.ok) throw new Error(`Anim HTTP ${animRes.status}`);
          const animBody = await animRes.json();

          data = {
            sentence:   text,
            chunks:     (t5Body.chunks || []).map(c => c.gloss || c),
            all_tokens,
            animations: animBody.animations || [],
            urls:       (animBody.urls || []).map(u => `${CFG.API_BASE}${u}`),
            _source: 't5',
          };

          console.log(`[SignAI] ⚙️  T5 fallback → ${data.animations.length} animations`);

        } catch (t5Err) {
          console.warn('[SignAI] T5 API also failed:', t5Err.message);
          showToast('API unreachable – Demo Mode active', 'info');
          this.demoMode = true;
          this._onWSStatus('offline');
        }
      }
    }

    // ── Tier 4: Offline demo mode ─────────────────────────────────────────────
    if (this.demoMode) {
      data = { sentence: text, ...demoProcess(text), _source: 'demo' };
    }

    if (!data) return;

    this._wsLatency = Math.round(now() - this._wsSendTime);
    const lv = $('latency-val'); if (lv) lv.textContent = `${this._wsLatency} ms`;
    const lr = $('latency-row'); if (lr) lr.hidden = false;

    // Show which tier was used
    const src = data._source;
    if (src === 'hybrid') showToast(`✅ Hybrid match (${data.animations?.length} signs)`, 'success', 2500);
    else if (src === 't5') showToast(`⚙️ T5 pipeline (${data.animations?.length} signs)`, 'info', 2000);

    this._applyAnimations({ ...data, sentence: text, isLive });
  }

  _applyAnimations(data) {
    const { sentence, chunks, all_tokens, animations, urls, isLive, facial } = data;

    // Normalize tokens to lowercase
    const tokens = (all_tokens || []).map(t => String(t).toLowerCase());

    if (!tokens.length) {
      showToast('No signable words found.', 'warning');
      return;
    }

    const queue = tokens.map((name, i) => {
      const animFile = animations?.[i] || `${name}.glb`;
      const animUrl  = urls?.[i]
        ? (urls[i].startsWith('http') ? urls[i] : `${CFG.API_BASE}${urls[i]}`)
        : `${CFG.API_BASE}${CFG.ANIM_BASE}${animFile}`;
      return { name, file: animFile, url: animUrl };
    });

    // Render gloss chunks in UI
    const chunkStrs = Array.isArray(chunks)
      ? chunks.map(c => (typeof c === 'string' ? c : (c.gloss || '')))
      : [];
    this._renderChunks(chunkStrs, tokens);

    if (isLive) {
      this.engine.append(queue);
    } else {
      this.engine.load(queue);
    }

    this._setPlaybackEnabled(true);
    if (sentence && chunkStrs.length) this.log.add(sentence, chunkStrs.join(' | '));

    // ── Facial expression (non-manual signals) ────────────────
    if (facial) {
      this.avatar.applyFacialExpression(facial);
      this._renderExpression(facial);
    }

    // Avatar subtitle ribbon
    const subtitleEl  = $('avatar-subtitle');
    const subtitleTxt = $('avatar-subtitle-text');
    if (subtitleTxt) subtitleTxt.textContent = chunkStrs.join(' → ');
    if (subtitleEl) subtitleEl.hidden = false;
    clearTimeout(this._subtitleTimer);
    this._subtitleTimer = setTimeout(() => { if (subtitleEl) subtitleEl.hidden = true; }, 6000);
  }

  /**
   * Update the facial expression HUD badge on the avatar canvas.
   * @param {Object} expr - expression object from facial_service
   */
  _renderExpression(expr) {
    if (!expr) return;
    const hud  = $('expr-hud');
    const icon = $('expr-icon');
    const lbl  = $('expr-label');
    const fill = $('expr-bar-fill');
    if (!hud) return;

    const label = (expr.expression || 'neutral').replace(/_/g, ' ').toUpperCase();
    if (icon) icon.textContent  = expr.icon || '😐';
    if (lbl)  lbl.textContent   = label;
    if (fill) fill.style.width  = `${Math.round((expr.intensity || 0.3) * 100)}%`;

    // Colour-code the HUD border by expression type
    hud.dataset.expr = expr.expression || 'neutral';
    hud.hidden = false;

    // Re-trigger the pop animation
    if (icon) { icon.classList.remove('expr-icon'); void icon.offsetWidth; icon.classList.add('expr-icon'); }

    clearTimeout(this._exprHudTimer);
    const hideAfterMs = (expr.duration_ms || 600) + 2500;
    this._exprHudTimer = setTimeout(() => { if (hud) hud.hidden = true; }, hideAfterMs);
  }

  // ── UI Rendering ──────────────────────────────────────────
  _renderChunks(chunks, tokens) {
    const section = $('gloss-section');
    if (section) section.hidden = false;

    const list = $('chunks-list');
    if (list) {
      list.innerHTML = '';
      chunks.forEach((ch, i) => {
        const row = document.createElement('div');
        row.className = 'chunk-row';
        row.innerHTML = `<span class="chunk-num">#${i + 1}</span>${ch.toUpperCase()}`;
        list.appendChild(row);
      });
    }

    const chips = $('queue-chips');
    if (chips) {
      chips.innerHTML = '';
      tokens.forEach((tok, i) => {
        const c = document.createElement('span');
        c.className = 'chip';
        c.textContent = tok;
        c.id = `chip-${i}`;
        chips.appendChild(c);
      });
    }
  }

  _onEngineUpdate(cur, total, item) {
    const bar  = $('anim-progress');
    const fill = $('anim-progress-fill');
    if (bar)  bar.hidden = (total === 0);
    if (fill && total > 0) fill.style.width = `${Math.min(((cur + 1) / total) * 100, 100)}%`;

    const ac = $('anim-current'); if (ac) ac.textContent = cur >= 0 ? cur + 1 : 0;
    const at = $('anim-total');   if (at) at.textContent = total;

    const np    = $('now-playing');
    const npTxt = $('np-text');
    if (np) {
      if (cur >= 0 && cur < total && item) {
        np.hidden = false;
        if (npTxt) npTxt.textContent = `Signing: ${item.name.toUpperCase()}`;
      } else {
        np.hidden = true;
      }
    }

    document.querySelectorAll('.chip').forEach((ch, i) => {
      ch.classList.toggle('active', i === cur);
      ch.classList.toggle('done',   i < cur);
    });
  }

  // ── API health check ──────────────────────────────────────
  async _checkAPI() {
    try {
      const r = await fetch(`${CFG.API_BASE}/`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        this.demoMode = false;
        if (!this.ws?.connected) this._onWSStatus('online');
        console.log('[SignAI] Backend API reachable');
      } else {
        throw new Error(`HTTP ${r.status}`);
      }
    } catch {
      this.demoMode = true;
      this._onWSStatus('offline');
      showToast('Backend offline – Demo Mode active', 'info', 5000);
      console.warn('[SignAI] Backend unreachable, using Demo Mode');
    }
  }

  // ── UI wiring ─────────────────────────────────────────────
  _wireUI() {
    // Mic button
    $('btn-mic')?.addEventListener('click', () => {
      if (!this.speech.isSupported) { showToast('Mic not supported — use Chrome/Edge', 'error'); return; }
      this.speech.toggle();
    });

    // Live mode toggle
    const liveToggle = $('live-toggle');
    liveToggle?.addEventListener('click', () => {
      this._liveMode = !this._liveMode;
      liveToggle.classList.toggle('active', this._liveMode);
      const ll  = $('live-label');
      const rtb = $('rt-badge');
      if (ll) ll.textContent = this._liveMode ? 'Live Mode ON' : 'Live Mode OFF';
      if (rtb) rtb.hidden = !this._liveMode;

      // Sync speech recogniser timing
      this.speech.setLiveMode(this._liveMode);

      if (this._liveMode) {
        // Turn ON: start mic, flush any pending text right away
        showToast('🎤 Live Mode ON – speak and avatar signs instantly!', 'live', 3000);
        this.speech.start();
        $('btn-mic')?.classList.add('recording');
        $('mic-hint') && ($('mic-hint').textContent = 'Listening…');
        const lb = $('listening-bar'); if (lb) lb.hidden = false;
        console.log('[SignAI] Live Mode ON – silence timer: 200ms per word');
      } else {
        // Turn OFF: stop mic, stop avatar animation queue
        showToast('Live Mode OFF', 'info', 2000);
        this.speech.stop();
        this.engine.stop();
        $('btn-mic')?.classList.remove('recording');
        console.log('[SignAI] Live Mode OFF');
      }
    });

    // Translate button
    $('btn-translate')?.addEventListener('click', () => {
      const manualVal   = ($('manual-input')?.value || '').trim();
      const subtitleVal = ($('subtitle-final')?.textContent || '').trim();
      const interimVal  = ($('subtitle-interim')?.textContent || '').trim();
      // Prefer manual input, then committed subtitle, then pending speech, then interim
      const text = manualVal || subtitleVal || this._pendingText || interimVal;
      if (!text) { showToast('Type or speak something first', 'error'); return; }
      this._translate(text, false);
      const mi = $('manual-input'); if (mi) mi.value = '';
      const sf = $('subtitle-final');   if (sf) sf.textContent = '';
      const si = $('subtitle-interim'); if (si) si.textContent = '';
      this._pendingText = '';
    });

    // Clear button
    $('btn-clear')?.addEventListener('click', () => {
      const mi = $('manual-input'); if (mi) mi.value = '';
      const sf = $('subtitle-final'); if (sf) sf.textContent = '';
      const si = $('subtitle-interim'); if (si) si.textContent = '';
      const gs = $('gloss-section'); if (gs) gs.hidden = true;
      const as = $('avatar-subtitle'); if (as) as.hidden = true;
      this.engine.stop();
      this._setPlaybackEnabled(false);
    });

    // Enter → translate
    $('manual-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') $('btn-translate')?.click();
    });

    // Playback controls
    $('pb-play')?.addEventListener('click',  () => this.engine.play());
    $('pb-pause')?.addEventListener('click', () => { this.engine.isPlaying ? this.engine.pause() : this.engine.play(); });
    $('pb-stop')?.addEventListener('click',  () => { this.engine.stop(); const np = $('now-playing'); if (np) np.hidden = true; });

    // Speed slider
    $('speed-slider')?.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      const sv = $('speed-val'); if (sv) sv.textContent = `${v}×`;
      this.engine.setSpeed(v);
    });

    // Crossfade slider
    $('blend-slider')?.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      const bv = $('blend-val'); if (bv) bv.textContent = `${v}s`;
      this.avatar.setCrossfade(v);
    });

    // Nav pills
    $('nav-demo')?.addEventListener('click', () => {
      this.demoMode = true;
      $('nav-demo')?.classList.add('active');
      $('nav-live')?.classList.remove('active');
      showToast('Demo Mode ON (no backend required)', 'info');
    });
    $('nav-live')?.addEventListener('click', () => {
      this.demoMode = false;
      $('nav-live')?.classList.add('active');
      $('nav-demo')?.classList.remove('active');
      this._checkAPI();
    });
  }

  _setPlaybackEnabled(on) {
    ['pb-play', 'pb-pause', 'pb-stop'].forEach(id => {
      const el = $(id); if (el) el.disabled = !on;
    });
  }
}

/* ── Bootstrap ── */
window.addEventListener('DOMContentLoaded', () => {
  console.log('[SignAI] Booting application…');
  window._signAI = new SignAIApp();
});
