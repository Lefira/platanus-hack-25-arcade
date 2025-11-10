// Micro Circuito 50K - closed-track top-down micro-racer
const ARCADE={P1L:['a','ArrowLeft'],P1R:['d','ArrowRight'],P1A:['w','ArrowUp'], P1B:['SPACE',' '], P1C:['Z','z'], START1:['Enter']};
const KEYBOARD_TO_ARCADE={};for(const[k,v]of Object.entries(ARCADE))v.forEach(x=>KEYBOARD_TO_ARCADE[x]=k);
const W=800,H=600;
const TRACK_W=2000,TRACK_H=3000;

// minimap / HUD sizing (slightly larger for clarity)
const MAP_WIDTH = 160, MAP_HEIGHT = 120, MAP_Y = 10;
// corner options: 'top-left','top-right','bottom-left','bottom-right','center'
const MINIMAP_CORNER = 'top-right';
// safe area margin for HUD and minimap placement
const SAFE_MARGIN = 30; // Aumentado de 10 a 30 para la zona segura
const DEBUG_CANVAS_SIZE = false; // disable debug overlay by default
const DEBUG_FINISH = false; // set to true to draw finish-crossing debug visuals (world-space)


// game state
let level = 1, lapCount = 0, passedCheckpoint = false;
let score = 0, levelTimeLimit = 45;
let musicTick = 0;
const musicPattern = [220.00, 261.63, 329.63, 261.63];
let hasTurbo = false, isTurboActive = false;
let gameState = 'title'; // 'title' | 'running' | 'summary'
let levelElapsedSec = 0;
let totalRemainingTime = 0;
const REGIONS = [
  // Norte (5)
  'Región de Arica y Parinacota','Región de Tarapacá','Región de Antofagasta','Región de Atacama','Región de Coquimbo',
  // Centro (6)
  'Región de Valparaíso','Región Metropolitana','Región de O\'Higgins','Región del Maule','Región de Ñuble','Región del Biobío',
  // Sur (5)
  'Región de La Araucanía','Región de Los Ríos','Región de Los Lagos','Región de Aysén','Región de Magallanes'
];

// simple tone generator for transitions
let _ac = null;
function playTone(freq=880, duration=0.08){
  try{
    if(!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = _ac.createOscillator(); const g = _ac.createGain();
    o.type = 'sine'; o.frequency.value = freq; g.gain.value = 0.001;
    o.connect(g); g.connect(_ac.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.12, _ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, _ac.currentTime + duration);
    o.stop(_ac.currentTime + duration + 0.02);
  }catch(e){ /* audio not available */ }
}

function spawnTurboRows(scene){
  try{
    if(!scene.turboPickups) return;
    scene.turboPickups.clear(true,true);
    const n = TRACK_PATH.length; if(n < 3) return;
    const idxs = [ Math.max(1, Math.floor(n/3)), Math.min(n-2, Math.floor(n*2/3)) ];
    idxs.forEach(idx=>{
      const prev = TRACK_PATH[idx-1]; const curr = TRACK_PATH[idx]; const next = TRACK_PATH[idx+1];
      const tx = next[0]-prev[0], ty = next[1]-prev[1];
      const len = Math.hypot(tx,ty)||1; const nx = ty/len, ny = -tx/len; // normal (perpendicular a la pista)
      const spacing = Math.max(36, Math.round(ROAD_HALF*0.5));
      const offs = [-spacing, 0, spacing];
      offs.forEach(off=>{
        const rx = curr[0] + nx*off; const ry = curr[1] + ny*off;
        scene.turboPickups.create(Math.round(rx), Math.round(ry), 'turboPickup');
      });
    });
  }catch(e){}

  // title screen: Chile colors and instructions
  const boxW = Math.min(560, Math.floor(W*0.85)), boxH = Math.min(380, Math.floor(H*0.8));
  const bx = Math.floor((W - boxW)/2), by = Math.floor((H - boxH)/2);
  this.titleBg = this.add.graphics().setScrollFactor(0).setDepth(3000);
  this.titleBg.fillStyle(0x000000, 0.55);
  this.titleBg.fillRoundedRect(bx-8, by-8, boxW+16, boxH+16, 10);
  this.titleBg.fillStyle(0x0a0a0a, 0.75);
  this.titleBg.fillRoundedRect(bx, by, boxW, boxH, 10);
  // Chile flag-like stripes inside the box top
  const stripeH = 20;
  this.titleBg.fillStyle(0x0033a0, 1); this.titleBg.fillRect(bx+10, by+10, boxW-20, stripeH); // blue
  this.titleBg.fillStyle(0xffffff, 1); this.titleBg.fillRect(bx+10, by+10+stripeH, boxW-20, stripeH); // white
  this.titleBg.fillStyle(0xd52b1e, 1); this.titleBg.fillRect(bx+10, by+10+stripeH*2, boxW-20, stripeH); // red
  // Title
  this.titleTitle = this.add.text(W/2, by + 90, 'Chile Rush', { fontSize:'48px', fill:'#ffffff', stroke:'#001a66', strokeThickness:4, align:'center' }).setOrigin(0.5).setScrollFactor(0).setDepth(3001);
  // Instructions
  const instr = 'Controles:\n- Mover: A/D o Flechas\n- Acelerar: W o Flecha Arriba\n- Freno: S o Flecha Abajo\n- Turbo: Espacio (requiere batería)\n- Derrape: Z\n\nPresiona Enter para comenzar';
  this.titleInstr = this.add.text(W/2, by + 190, instr, { fontSize:'18px', fill:'#ffffff', align:'center' }).setOrigin(0.5).setScrollFactor(0).setDepth(3001);
}

function handleCollectTurbo(player, pickup){
  // REGLA: Solo un turbo a la vez
  try{
    if(hasTurbo || isTurboActive) return;
    hasTurbo = true;
    if(pickup && pickup.disableBody) pickup.disableBody(true,true); else if(pickup && pickup.destroy) pickup.destroy();
    try{ playTone(1200,0.1); }catch(e){}
  }catch(e){}
}

// Spawn exactly 2 random turbo pickups on the road per level
function spawnTwoTurbos(scene){
  try{
    if(!scene.turboPickups) return;
    scene.turboPickups.clear(true,true);
    const n = TRACK_PATH.length;
    if(n < 6) return;
    const chosen = [];
    let attempts = 0;
    while(chosen.length < 2 && attempts < 40){
      attempts++;
      const idx = Phaser.Math.Between(2, n-3);
      // keep pickups sufficiently apart
      if(chosen.every(i => Math.abs(i - idx) > Math.floor(n*0.12))){
        chosen.push(idx);
      }
    }
    chosen.forEach(idx=>{
      const p = TRACK_PATH[idx];
      scene.turboPickups.create(p[0] + Phaser.Math.Between(-8,8), p[1] + Phaser.Math.Between(-8,8), 'turboPickup');
    });
  }catch(e){}
}

// Bananas: 2 collectibles per level that grant +100 score each
function handleCollectBanana(player, banana){
  try{
    if(banana && banana.disableBody) banana.disableBody(true,true); else if(banana && banana.destroy) banana.destroy();
    score += 100; if(typeof scoreText !== 'undefined') scoreText.setText('Score: ' + score);
    try{ playTone(880,0.08); }catch(e){}
  }catch(e){}
}

function spawnBananas(scene){
  try{
    if(!scene.bananas) return;
    scene.bananas.clear(true,true);
    const n = TRACK_PATH.length;
    if(n < 6) return;
    const chosen = [];
    let attempts = 0;
    while(chosen.length < 2 && attempts < 40){
      attempts++;
      const idx = Phaser.Math.Between(2, n-3);
      // keep bananas sufficiently apart
      if(chosen.every(i => Math.abs(i - idx) > Math.floor(n*0.12))){
        chosen.push(idx);
      }
    }
    chosen.forEach(idx=>{
      const p = TRACK_PATH[idx];
      // ensure bananas are on the road by limiting offset to a fraction of ROAD_HALF
      const maxOffset = Math.min(30, Math.round(ROAD_HALF * 0.4));
      scene.bananas.create(p[0] + Phaser.Math.Between(-maxOffset, maxOffset), p[1] + Phaser.Math.Between(-maxOffset, maxOffset), 'banana');
    });
  }catch(e){}
}

// startMusic() eliminado; la música se programa en create() con un TimerEvent constante

// track polyline (curvy line with start at index 0 (bottom) and finish at last index (top))
let TRACK_PATH = [
  [1000,1400],[900,1000],[800,700],[900,350],[1000,120]
];
let ROAD_HALF = 150;
function preload(){
  // create small procedural textures: car, rock, finish line
  const g = this.add.graphics();
  // car: simple rectangle with windshield
  g.fillStyle(0x1565c0,1); g.fillRoundedRect(4,4,16,40,4);
  g.fillStyle(0xeeeeee,1); g.fillRect(8,8,8,10);
  g.generateTexture('car',24,48); g.clear();

  // rock: small irregular polygon
  g.fillStyle(0x666666,1);
  g.beginPath(); g.moveTo(12,4); g.lineTo(28,12); g.lineTo(24,28); g.lineTo(8,32); g.lineTo(2,18); g.closePath(); g.fillPath();
  g.generateTexture('rock',30,36); g.clear();

  // finish line texture (smaller horizontal stripe)
  g.fillStyle(0xffffff,1); g.fillRect(0,0,300,8); g.generateTexture('finishLine',300,8); g.clear();

  // turbo pickup: cyan battery cylinder
  g.fillStyle(0x00aaff,1); g.fillRoundedRect(0,5,20,30,8);
  g.fillStyle(0xeeeeee,1); g.fillRect(0,3,20,5);
  g.generateTexture('turboPickup',20,36); g.clear();

  // banana: yellow crescent (larger)
  g.fillStyle(0xffeb3b,1);
  g.beginPath();
  g.arc(20,20,14,0.3,Math.PI-0.3);
  g.arc(20,20,9,Math.PI-0.3,0.3,true);
  g.closePath();
  g.fillPath();
  g.lineStyle(3,0xffc107,1);
  g.strokePath();
  g.generateTexture('banana',40,40); g.clear();

  g.destroy();
}

function generateTrack(scene,level){
  // generate a new TRACK_PATH bottom->top with more points as level rises
  const pts = [];
  // Curvas controladas: entre 3 y 6 según el nivel (pista más larga pero con pocas curvas)
  const cols = Phaser.Math.Clamp(3 + Math.floor(level/4), 3, 6);
  const margin = 150;
  // start near bottom center
  const startX = TRACK_W/2 + Phaser.Math.Between(-40,40);
  pts.push([startX, TRACK_H - 80]);
  // add a second point directly above to make the initial segment vertical
  pts.push([startX, TRACK_H - 220]);
  for(let i=1;i<=cols;i++){
    const t = i/(cols+1);
    // elige X con variación moderada para evitar curvas muy cerradas
    const prevX = pts[pts.length-1][0];
    const maxShift = Math.round(TRACK_W * 0.25);
    const targetX = Phaser.Math.Clamp(prevX + Phaser.Math.Between(-maxShift, maxShift), margin, TRACK_W - margin);
    const y = TRACK_H - Math.round(t * (TRACK_H - 160)) - 80;
    pts.push([targetX, y]);
  }
  // end near top center -- ensure final segment is vertical by using same x for penultimate
  const endX = TRACK_W/2 + Phaser.Math.Between(-40,40);
  pts.push([endX, 160]);
  pts.push([endX, 80]);
  TRACK_PATH = pts;
  // draw to canvas
  if(scene.textures.exists('trackTexture')) scene.textures.remove('trackTexture');
  const t = scene.textures.createCanvas('trackTexture', TRACK_W, TRACK_H);
  const ctx = t.getContext(); scene.trackContext = ctx;
  // Background theming per region group
  try{
    const idx = (level-1) % REGIONS.length;
    const zone = (idx < 5) ? 'north' : (idx < 11 ? 'center' : 'south');
    if(zone === 'north') ctx.fillStyle = '#c9b07a'; // arena/café claro
    else if(zone === 'south') ctx.fillStyle = '#eef5fb'; // nieve blanca/azulada
    else ctx.fillStyle = '#1f6b2f'; // centro verde
  }catch(e){ ctx.fillStyle = '#1f6b2f'; }
  ctx.fillRect(0,0,TRACK_W,TRACK_H);
  // Narrower road and smoother curves
  ctx.strokeStyle = '#333333'; const roadW = 120 + Math.min(30, level*3); ctx.lineWidth = roadW; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ROAD_HALF = roadW/2;
  // Quadratic smoothing between points
  ctx.beginPath();
  ctx.moveTo(TRACK_PATH[0][0], TRACK_PATH[0][1]);
  for(let i=1;i<TRACK_PATH.length-1;i++){
    const c = TRACK_PATH[i];
    const n = TRACK_PATH[i+1];
    const mx = (c[0]+n[0])/2, my = (c[1]+n[1])/2;
    ctx.quadraticCurveTo(c[0], c[1], mx, my);
  }
  // last segment to end point
  const last = TRACK_PATH[TRACK_PATH.length-1];
  ctx.lineTo(last[0], last[1]);
  ctx.stroke(); t.refresh();
}

function getTimeLimitForLevel(lvl){
  // tiempo base decrece con el nivel, con piso mínimo
  const base = 65 - 3.5 * Math.max(1, lvl); // mucho más estricto
  return Math.max(9, Math.round(base));
}

function create(){
  try{ document.title = 'Chile Rush'; }catch(e){}
  // World bounds to match track
  this.physics.world.setBounds(0,0,TRACK_W,TRACK_H);
  // generate initial track and add image
  generateTrack(this, level);
  this.trackImage = this.add.image(0,0,'trackTexture').setOrigin(0);

  // static rocks
  this.rocks = this.physics.add.staticGroup();
  const rockPositions = [
    [700,750],[1100,700],[900,1000],[400,900],[1400,1100],[1600,600],[300,300],[1200,300]
  ];
  rockPositions.forEach(p=> this.rocks.create(p[0],p[1],'rock'));

  // sensors for lap counting
  this.sensors = this.physics.add.staticGroup();
  const startPt = TRACK_PATH[0]; const endPt = TRACK_PATH[TRACK_PATH.length-1];
  // enforce vertical start angle for player placement
  const startAngle = -Math.PI/2; // up (player faces up initially)
  // place checkpoint roughly mid-path and create robust circular sensors for checkpoint and finish
  const midIndex = Math.floor(TRACK_PATH.length/2);
  const midPt = TRACK_PATH[midIndex];
  // create sensors as static images then set circular bodies larger than the lane so overlaps are reliable
  this.checkpointSensor = this.physics.add.staticImage(midPt[0], midPt[1], 'finishLine').setVisible(false);
  this.finishLineSensor = this.physics.add.staticImage(endPt[0], endPt[1], 'finishLine').setVisible(false);
  // set circular bodies using ROAD_HALF (set smaller than road half so it sits on the road edge)
  const sensorRadius = Math.max(40, Math.round(ROAD_HALF * 0.7));
  if(this.checkpointSensor.body){ this.checkpointSensor.body.setCircle(sensorRadius); this.checkpointSensor.body.setOffset(-sensorRadius + (this.checkpointSensor.width/2), -sensorRadius + (this.checkpointSensor.height/2)); }
  if(this.finishLineSensor.body){ this.finishLineSensor.body.setCircle(sensorRadius); this.finishLineSensor.body.setOffset(-sensorRadius + (this.finishLineSensor.width/2), -sensorRadius + (this.finishLineSensor.height/2)); }
  // visible finish line: horizontal stripe (user requested horizontal finish)
  this.finishImage = this.add.image(endPt[0],endPt[1],'finishLine').setDepth(3).setOrigin(0.5,0.5);
  this.finishImage.rotation = 0; // horizontal line
  // finish segment matches visible line width for precise crossing
  const finishLen = Math.max(80, Math.round(this.finishImage.displayWidth || 120));
  this.finishSeg = { x1: endPt[0] - finishLen/2, y: endPt[1], x2: endPt[0] + finishLen/2, y: endPt[1] };

  // HUD (use safe margin)
  const margin = SAFE_MARGIN; // Aumentado de 10 a 30 para la zona segura
  levelText = this.add.text(margin, margin+28,'Level: 1',{ fontSize: '24px', fill: '#000000', stroke:'#ffffff', strokeThickness:3 }).setScrollFactor(0);
  scoreText = this.add.text(margin, margin+56,'Score: 0',{ fontSize: '20px', fill: '#000000', stroke:'#ffffff', strokeThickness:3 }).setScrollFactor(0);
  timerText = this.add.text(margin, margin+78,'Time: 45',{ fontSize: '20px', fill: '#000000', stroke:'#ffffff', strokeThickness:3 }).setScrollFactor(0);
  this.regionText = this.add.text(W/2, SAFE_MARGIN, REGIONS[(level-1)%REGIONS.length]||'', { fontSize:'20px', fill:'#000000', stroke:'#ffffff', strokeThickness:3}).setOrigin(0.5,0).setScrollFactor(0);

  // set initial time limit based on difficulty
  try{ levelTimeLimit = getTimeLimitForLevel(level); if(typeof timerText !== 'undefined') timerText.setText('Time: ' + Math.ceil(levelTimeLimit)); }catch(e){}

  // player placed slightly behind start point along vertical start
  const startPos = startPt; const nx = Math.cos(startAngle); const ny = Math.sin(startAngle);
  this.player = this.physics.add.sprite(startPos[0] - nx*80, startPos[1] - ny*80,'car').setDepth(2);
  this.player.setCollideWorldBounds(true);
  this.player.body.setSize(14,34,true);
  this.player.setDamping(true);
  this.player.setDrag(0.95);
  this.playerSpeedMax = 300; this.baseSpeedMax = this.playerSpeedMax;
  this.playerSpeed = 0; // current speed (px/sec)
  this.maxReverse = -120;
  // track previous position for crossing detection
  this._prevPos = { x: this.player.x, y: this.player.y };
  this._finishing = false;

  // collider with static rocks
  this.physics.add.collider(this.player, this.rocks);

  // overlaps for lap logic (player exists now)
  this.physics.add.overlap(this.player, this.checkpointSensor, handleCheckpoint, null, this);
  this.physics.add.overlap(this.player, this.finishLineSensor, handleFinishLine, null, this);

  // turbo pickups group and indicator
  this.turboPickups = this.physics.add.group();
  this.physics.add.overlap(this.player, this.turboPickups, handleCollectTurbo, null, this);
  this.turboIndicator = this.add.graphics().setScrollFactor(0).setDepth(1000);
  // bananas collectibles
  this.bananas = this.physics.add.group();
  this.physics.add.overlap(this.player, this.bananas, handleCollectBanana, null, this);
  // initial turbos and bananas: exactly 2 random pickups each
  try{ spawnTwoTurbos(this); spawnBananas(this); }catch(e){}

  // camera follow
  this.cameras.main.startFollow(this.player,true,0.1,0.1);
  this.cameras.main.setZoom(1.0);
  // keep camera inside the world so it never shows outside (black) areas
  this.cameras.main.setBounds(0,0,TRACK_W,TRACK_H);

  // input
  this.cursors = this.input.keyboard.createCursorKeys();
  this.aKey = this.input.keyboard.addKey('A'); this.dKey = this.input.keyboard.addKey('D'); this.wKey = this.input.keyboard.addKey('W');
  this.sKey = this.input.keyboard.addKey('S');
  // explicit turbo/drift keys to guarantee detection
  this.spaceKey = this.input.keyboard.addKey('SPACE');
  this.zKey = this.input.keyboard.addKey('Z');

  // minimap
  createMinimap(this);
  // debug graphics for finish crossing (world-space so it follows camera)
  if(DEBUG_FINISH){ if(this._debugGraphics) this._debugGraphics.destroy(); this._debugGraphics = this.add.graphics().setDepth(2000); }
  if(DEBUG_FINISH){ if(this._debugText) this._debugText.destroy(); this._debugText = this.add.text(8,80,'',{ fontSize:'14px', fill:'#ffffff', backgroundColor:'rgba(0,0,0,0.6)', padding:{x:6,y:6} }).setScrollFactor(0).setDepth(2001); }
  // recompute minimap on resize so it stays anchored
  this.scale.on('resize', ()=> createMinimap(this));
  // also handle window resize (some hosts resize canvas differently)
  window.addEventListener('resize', ()=> createMinimap(this));
  // procedural music: fast-paced racing game style with driving bass and melody
  try{
    // Bass line (lower octave, steady rhythm)
    this.time.addEvent({
      delay: 300, // faster tempo for racing feel
      loop: true,
      callback: ()=>{
        const bassPattern = [110, 110, 146.83, 146.83]; // A2, A2, D3, D3
        const note = bassPattern[musicTick % bassPattern.length];
        try{ playTone(note, 0.12); }catch(e){}
        musicTick++;
      }
    });
    // Melody line (higher octave, energetic)
    let melodyTick = 0;
    this.time.addEvent({
      delay: 150, // double speed for melody
      loop: true,
      callback: ()=>{
        const melodyPattern = [440, 523.25, 587.33, 659.25, 587.33, 523.25]; // A4, C5, D5, E5, D5, C5
        if(melodyTick % 2 === 0){ // play every other beat
          const note = melodyPattern[(melodyTick/2) % melodyPattern.length];
          try{ playTone(note, 0.08); }catch(e){}
        }
        melodyTick++;
      }
    });
  }catch(e){}
  try{
    if(!_ac) _ac = new (window.AudioContext||window.webkitAudioContext)();
    this.engineOsc = _ac.createOscillator(); this.engineGain = _ac.createGain();
    this.engineOsc.type = 'triangle'; this.engineOsc.frequency.value = 80;
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineGain); this.engineGain.connect(_ac.destination);
    this.engineOsc.start();
  }catch(e){}
}

function createMinimap(scene){
  // compute minimap position from camera so it stays visible
  const margin = SAFE_MARGIN;
  // prefer the actual displayed canvas client size if available (handles CSS/iframe scaling)
  const canvas = scene.sys && scene.sys.game && scene.sys.game.canvas;
  const clientW = canvas && canvas.clientWidth ? canvas.clientWidth : 0;
  const clientH = canvas && canvas.clientHeight ? canvas.clientHeight : 0;
  // use client sizes if they look valid, otherwise fallback to Phaser scale sizes
  const vw = (clientW && clientW > 10) ? clientW : scene.scale.width;
  const vh = (clientH && clientH > 10) ? clientH : scene.scale.height;
  // choose corner placement
  let mapX = Math.round((vw - MAP_WIDTH) / 2);
  let mapY = Math.round((vh - MAP_HEIGHT) / 2);
  switch(MINIMAP_CORNER){
    case 'top-left': mapX = margin; mapY = margin; break;
  case 'top-right': mapX = Math.round(vw - MAP_WIDTH - margin); mapY = margin; break;
    case 'bottom-left': mapX = margin; mapY = Math.round(vh - MAP_HEIGHT - margin); break;
  case 'bottom-right': mapX = Math.round(vw - MAP_WIDTH - margin); mapY = Math.round(vh - MAP_HEIGHT - margin); break;
    default: /* center already set */ break;
  }
  // clamp to margins in case of very small canvases
  if(mapX < margin) mapX = margin;
  if(mapX + MAP_WIDTH + margin > vw) mapX = Math.max(margin, vw - MAP_WIDTH - margin);
  if(mapY < margin) mapY = margin;
  if(mapY + MAP_HEIGHT + margin > vh) mapY = Math.max(margin, vh - MAP_HEIGHT - margin);
  // recompute scale to fit current constants
  const scaleX = MAP_WIDTH / TRACK_W;
  const scaleY = MAP_HEIGHT / TRACK_H;
  scene._minimap = { MAP_X: mapX, MAP_Y: mapY, MAP_WIDTH, MAP_HEIGHT, SCALE_X: scaleX, SCALE_Y: scaleY };
  // small debug overlay to show canvas sizes (helps diagnose "only corner visible" issues)
  if(DEBUG_CANVAS_SIZE){
    const info = `canvas:${scene.scale.width}x${scene.scale.height}` + (clientW?` (client ${clientW}x${clientH})`:'');
    if(!scene._debugSizeText) {
      scene._debugSizeText = scene.add.text(vw/2, vh/2, info, { fontSize:'14px', fill:'#fff', backgroundColor:'rgba(0,0,0,0.6)', padding:{x:8,y:6} }).setScrollFactor(0).setDepth(2000).setOrigin(0.5);
    } else {
      scene._debugSizeText.setText(info);
      scene._debugSizeText.setPosition(Math.round(vw/2), Math.round(vh/2));
    }
  } else {
    if(scene._debugSizeText){ scene._debugSizeText.destroy(); scene._debugSizeText = null; }
  }
  // create or reuse graphics objects
  if(!scene.minimapBg) scene.minimapBg = scene.add.graphics().setScrollFactor(0).setDepth(1000);
  if(!scene.minimapStatic) scene.minimapStatic = scene.add.graphics().setScrollFactor(0).setDepth(1001);
  if(!scene.playerMapDot) scene.playerMapDot = scene.add.graphics().setScrollFactor(0).setDepth(1002);

  // redraw statics: background, border, path, rocks
  scene.minimapBg.clear(); scene.minimapStatic.clear();
  // subtle shadow / rounded background
  scene.minimapBg.fillStyle(0x000000,0.55);
  scene.minimapBg.fillRoundedRect(mapX-4,mapY-4,MAP_WIDTH+8,MAP_HEIGHT+8,6);
  scene.minimapBg.fillStyle(0x0a0a0a,0.7); scene.minimapBg.fillRoundedRect(mapX,mapY,MAP_WIDTH,MAP_HEIGHT,6);
  // white border
  scene.minimapBg.lineStyle(2,0xffffff,0.9); scene.minimapBg.strokeRoundedRect(mapX,mapY,MAP_WIDTH,MAP_HEIGHT,6);

  // draw track path scaled
  const pts = TRACK_PATH.map(p=>[ mapX + p[0]*scaleX, mapY + p[1]*scaleY ]);
  scene.minimapStatic.lineStyle(5,0x444444,1);
  scene.minimapStatic.beginPath(); scene.minimapStatic.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++) scene.minimapStatic.lineTo(pts[i][0],pts[i][1]);
  scene.minimapStatic.strokePath();

  // rocks as small white dots
  scene.rocks.getChildren().forEach(r=>{
    const sx = mapX + r.x * scaleX; const sy = mapY + r.y * scaleY;
    scene.minimapStatic.fillStyle(0xffffff,1); scene.minimapStatic.fillRect(Math.round(sx)-1,Math.round(sy)-1,3,3);
  });

  // position HUD fixed at safe area top-left (sin Lap)
  try{
    if(typeof levelText !== 'undefined' && levelText){ levelText.setPosition(SAFE_MARGIN, SAFE_MARGIN + 28); levelText.setScrollFactor(0); }
    if(typeof scoreText !== 'undefined' && scoreText){ scoreText.setPosition(SAFE_MARGIN, SAFE_MARGIN + 56); scoreText.setScrollFactor(0); }
    if(typeof timerText !== 'undefined' && timerText){ timerText.setPosition(SAFE_MARGIN, SAFE_MARGIN + 78); timerText.setScrollFactor(0); }
  }catch(e){}
}

function update(_t,dt){
  // Title / Summary flow
  const enterDown = this.input.keyboard.addKey('ENTER').isDown;
  const spaceDown = this.input.keyboard.addKey('SPACE').isDown;
  if(gameState === 'title'){
    // Create title screen UI if not already present
    if(!this.titleCreated){
      this.titleCreated = true;
      const boxW = Math.min(600, Math.floor(W*0.9)), boxH = Math.min(420, Math.floor(H*0.85));
      const bx = Math.floor((W - boxW)/2), by = Math.floor((H - boxH)/2);
      // Background
      this.titleBg = this.add.graphics().setScrollFactor(0).setDepth(3000);
      this.titleBg.fillStyle(0x000000, 0.6);
      this.titleBg.fillRoundedRect(bx-10, by-10, boxW+20, boxH+20, 12);
      this.titleBg.fillStyle(0x0a0a0a, 0.85);
      this.titleBg.fillRoundedRect(bx, by, boxW, boxH, 12);
      // Chile flag at top (official design, compact height)
      const flagW = boxW - 24, flagH = 50; // same width as before, short height
      const flagX = bx + 12, flagY = by + 12;
      
      // Blue square (top-left, 1/3 of width, full height of top stripe)
      const blueW = Math.round(flagW / 3);
      const blueH = Math.round(flagH / 2);
      this.titleBg.fillStyle(0x0039a6, 1); // official blue
      this.titleBg.fillRect(flagX, flagY, blueW, blueH);
      
      // White stripe (top half, from blue square to right edge)
      this.titleBg.fillStyle(0xffffff, 1);
      this.titleBg.fillRect(flagX + blueW, flagY, flagW - blueW, blueH);
      
      // Red stripe (bottom half, full width)
      this.titleBg.fillStyle(0xd52b1e, 1); // official red
      this.titleBg.fillRect(flagX, flagY + blueH, flagW, blueH);
      
      // White star in blue square (5-pointed star)
      const starCx = flagX + blueW/2, starCy = flagY + blueH/2;
      const starR = blueH * 0.3; // outer radius
      const starInnerR = starR * 0.382; // inner radius (golden ratio)
      this.titleBg.fillStyle(0xffffff, 1);
      this.titleBg.beginPath();
      for(let i=0; i<10; i++){
        const angle = (i * Math.PI / 5) - Math.PI/2;
        const r = (i % 2 === 0) ? starR : starInnerR;
        const x = starCx + Math.cos(angle) * r;
        const y = starCy + Math.sin(angle) * r;
        if(i===0) this.titleBg.moveTo(x, y); else this.titleBg.lineTo(x, y);
      }
      this.titleBg.closePath();
      this.titleBg.fillPath();
      // Title with Chile flag colors (blue, white, red gradient effect via multiple texts)
      const titleY = by + flagH + 20; // position right below flag
      // Create title with gradient-like effect using shadows/layers
      this.titleTitle = this.add.text(W/2, titleY, 'CHILE RUSH', { fontSize:'56px', fill:'#0039a6', align:'center', fontStyle:'bold' }).setOrigin(0.5).setScrollFactor(0).setDepth(3001);
      this.titleTitle2 = this.add.text(W/2, titleY, 'CHILE RUSH', { fontSize:'56px', fill:'#ffffff', stroke:'#d52b1e', strokeThickness:4, align:'center', fontStyle:'bold' }).setOrigin(0.5).setScrollFactor(0).setDepth(3002);
      // Instructions
      const instr = 'INSTRUCCIONES:\n\nMover: A/D, Flechas o P1L/P1R (Arcade)\nAcelerar: W, Flecha Arriba o P1A (Arcade)\nFreno: S o Flecha Abajo\nTurbo: Espacio o P1B (Arcade) - requiere batería\nDerrape: Z o P1C (Arcade)\n\nRecoge bananas para sumar puntos!\n\nPresiona ENTER, ESPACIO o START1 para comenzar';
      const instrY = titleY + 150; // move instructions much further down
      this.titleInstr = this.add.text(W/2, instrY, instr, { fontSize:'18px', fill:'#ffffff', align:'center', lineSpacing:4 }).setOrigin(0.5).setScrollFactor(0).setDepth(3001);
    }
    // wait for enter or space to start
    if(enterDown || spaceDown){
      gameState = 'running'; levelElapsedSec = 0;
      if(this.overlay){ this.overlay.destroy(); this.overlay=null; }
      try{ if(this.titleBg){ this.titleBg.destroy(); this.titleBg=null; } }catch(e){}
      try{ if(this.titleTitle){ this.titleTitle.destroy(); this.titleTitle=null; } }catch(e){}
      try{ if(this.titleTitle2){ this.titleTitle2.destroy(); this.titleTitle2=null; } }catch(e){}
      try{ if(this.titleInstr){ this.titleInstr.destroy(); this.titleInstr=null; } }catch(e){}
      this.titleCreated = false;
    }
    return;
  }
  if(gameState === 'summary'){
    if(enterDown){
      // check if final level completed
      if(level >= REGIONS.length){
        // return to title screen
        level = 0; score = 0; totalRemainingTime = 0;
        passedCheckpoint = false; levelElapsedSec = 0;
        if(this.overlay){ this.overlay.destroy(); this.overlay=null; }
        gameState = 'title';
        this.titleCreated = false; // force recreation of title screen
        try{ this.physics.world.resume(); }catch(e){}
        startNextLevel(this, true); // reset to level 1
      } else {
        // go next level
        passedCheckpoint = false; levelElapsedSec = 0;
        if(this.overlay){ this.overlay.destroy(); this.overlay=null; }
        try{ this.physics.world.resume(); }catch(e){}
        gameState = 'running';
        startNextLevel(this, false);
      }
    }
    return;
  }
  // controls helper: check ARCADE mapping
  const controls = { isDown: (code)=>{
    const keys = ARCADE[code]; if(!keys) return false;
    for(const k of keys){ const keyObj = this.input.keyboard.addKey(k); if(keyObj.isDown) return true; }
    return false;
  }};

  // improved vehicle handling
  const dtSec = dt/1000;
  const accel = 420; const brake = 600; const friction = 220;
  const left = controls.isDown('P1L'); const right = controls.isDown('P1R');
  const accelDown = controls.isDown('P1A'); const brakeDown = this.cursors.down.isDown || this.sKey.isDown;
  const turboDown = (this.spaceKey && this.spaceKey.isDown) || controls.isDown('P1B');
  const driftDown = (this.zKey && this.zKey.isDown) || controls.isDown('P1C');
  try{ if(this.engineGain) this.engineGain.gain.setTargetAtTime(accelDown?0.03:0.0, (_ac?_ac.currentTime:0), 0.02); }catch(e){}
  // speed integration
  if(accelDown) this.playerSpeed = Math.min(this.playerSpeed + accel*dtSec, this.playerSpeedMax);
  else if(brakeDown) this.playerSpeed = Math.max(this.playerSpeed - brake*dtSec, this.maxReverse);
  else {
    if(this.playerSpeed > 0) this.playerSpeed = Math.max(0, this.playerSpeed - friction*dtSec);
    else this.playerSpeed = Math.min(0, this.playerSpeed + friction*dtSec);
  }
  // turning scaled by speed (more responsive at speed, gentle at low speed)
  const spFactor = Math.min(1, Math.abs(this.playerSpeed) / (this.playerSpeedMax*0.7));
  let turnRate = (2.2 * spFactor + 0.4); // radians/sec
  if(driftDown && this.playerSpeed > 100){
    turnRate *= 1.8;
    this.playerSpeed = Math.max(this.playerSpeed - (600 * 0.5) * (dt/1000), 100);
  }
  if(left) this.player.rotation -= turnRate * dtSec;
  if(right) this.player.rotation += turnRate * dtSec;
  // apply velocity along heading (sprite points up -> rotation - PI/2)
  this.physics.velocityFromRotation(this.player.rotation - Math.PI/2, this.playerSpeed, this.player.body.velocity);

  // Turbo activation and speed limits (with grass slowdown when not turboing)
  if(turboDown && hasTurbo && !isTurboActive){
    isTurboActive = true; hasTurbo = false; try{ playTone(440,0.5); }catch(e){}
    try{ this.time.delayedCall(1500, ()=>{ isTurboActive = false; }); }catch(e){ isTurboActive = false; }
  }
  try{
    if(this.trackContext){
      const px = (this.player.x|0), py = (this.player.y|0);
      const d = this.trackContext.getImageData(px,py,1,1).data;
      // robust road detection: compare color distance to road stroke (#333333)
      const r = d[0], g = d[1], b = d[2];
      const distRoad = Math.hypot(r-51, g-51, b-51);
      const onRoad = distRoad < 40; // near road color => on road
      const baseMax = (this.baseSpeedMax||300);
      // cut turbo if we enter slowdown zone (offroad)
      if(!onRoad && isTurboActive){ isTurboActive = false; }
      if(isTurboActive) this.playerSpeedMax = Math.round(baseMax * 1.8);
      else this.playerSpeedMax = onRoad ? baseMax : 150;
    }
  }catch(e){}

  // level timer (elapsed and remaining)
  levelElapsedSec += dt/1000;
  levelTimeLimit -= dt/1000; if(levelTimeLimit < 0) levelTimeLimit = 0;
  try{ if(typeof timerText !== 'undefined') timerText.setText('Time: ' + Math.ceil(levelTimeLimit)); }catch(e){}
  const mm = this._minimap;
  if(mm){
    // only clear the player dot (statics drawn once)
    this.playerMapDot.clear();
    const px = mm.MAP_X + this.player.x * mm.SCALE_X; const py = mm.MAP_Y + this.player.y * mm.SCALE_Y;
    // draw orientation arrow (triangle) pointing in player's heading
    const heading = this.player.rotation - Math.PI/2;
    const size = 6;
    const p1x = px + Math.cos(heading) * size;
    const p1y = py + Math.sin(heading) * size;
    const left = heading + Math.PI * 0.6;
    const right = heading - Math.PI * 0.6;
    const p2x = px + Math.cos(left) * (size*0.8);
    const p2y = py + Math.sin(left) * (size*0.8);
    const p3x = px + Math.cos(right) * (size*0.8);
    const p3y = py + Math.sin(right) * (size*0.8);
    this.playerMapDot.fillStyle(0xff0000,1);
    this.playerMapDot.beginPath();
    this.playerMapDot.moveTo(p1x,p1y);
    this.playerMapDot.lineTo(p2x,p2y);
    this.playerMapDot.lineTo(p3x,p3y);
    this.playerMapDot.closePath();
    this.playerMapDot.fillPath();
  }

  // Turbo bar (bottom-right), only one charge: full when hasTurbo or active
  try{
    if(this.turboIndicator){
      this.turboIndicator.clear();
      const col = isTurboActive ? 0xffaa00 : (hasTurbo ? 0x00aaff : 0x555555);
      this.turboIndicator.fillStyle(col,1);
      this.turboIndicator.fillRect(W - (SAFE_MARGIN + 60), H - (SAFE_MARGIN + 14), 60, 10);
      this.turboIndicator.lineStyle(1,0x222222,1);
      this.turboIndicator.strokeRect(W - (SAFE_MARGIN + 60), H - (SAFE_MARGIN + 14), 60, 10);
    }
  }catch(e){}

  // crossing detection: check if the player's movement segment crossed the horizontal finish segment
  try {
    const prev = this._prevPos || { x: this.player.x, y: this.player.y };
    const curr = { x: this.player.x, y: this.player.y };
    const seg = this.finishSeg;
    if (seg && !this._finishing) {
      // small helper: segment intersection
      const intersects = (ax,ay,bx,by,cx,cy,dx,dy)=>{
        const orient = (px,py,qx,qy,rx,ry)=> (qx-px)*(ry-py) - (qy-py)*(rx-px);
        const o1 = orient(ax,ay,bx,by,cx,cy);
        const o2 = orient(ax,ay,bx,by,dx,dy);
        const o3 = orient(cx,cy,dx,dy,ax,ay);
        const o4 = orient(cx,cy,dx,dy,bx,by);
        if(o1===0 && o2===0 && o3===0 && o4===0){
          // collinear: bounding-box overlap
          const minAx = Math.min(ax,bx), maxAx = Math.max(ax,bx);
          const minAy = Math.min(ay,by), maxAy = Math.max(ay,by);
          const minCx = Math.min(cx,dx), maxCx = Math.max(cx,dx);
          const minCy = Math.min(cy,dy), maxCy = Math.max(cy,dy);
          return !(maxAx < minCx || maxCx < minAx || maxAy < minCy || maxCy < minAy);
        }
        return (o1*o2 <= 0) && (o3*o4 <= 0);
      };

  // helper: shortest distance between two segments
      const segSegDist = (ax,ay,bx,by, cx,cy,dx,dy) => {
        const ux = bx - ax, uy = by - ay;
        const vx = dx - cx, vy = dy - cy;
        const wx = ax - cx, wy = ay - cy;
        const a = ux*ux + uy*uy; const b = ux*vx + uy*vy; const c = vx*vx + vy*vy;
        const d = ux*wx + uy*wy; const e = vx*wx + vy*wy;
        let D = a*c - b*b; let sc, sN, sD = D; let tc, tN, tD = D;
        const EPS = 1e-9;
        if(D < EPS){ sN = 0.0; sD = 1.0; tN = e; tD = c; }
        else { sN = (b*e - c*d); tN = (a*e - b*d);
          if(sN < 0){ sN = 0; tN = e; tD = c; }
          else if(sN > sD){ sN = sD; tN = e + b; tD = c; }
        }
        if(tN < 0){ tN = 0; if(-d < 0) sN = 0; else if(-d > a) sN = sD; else { sN = -d; sD = a; } }
        else if(tN > tD){ tN = tD; if((-d + b) < 0) sN = 0; else if((-d + b) > a) sN = sD; else { sN = (-d + b); sD = a; } }
        sc = (Math.abs(sN) < EPS) ? 0 : sN / sD;
        tc = (Math.abs(tN) < EPS) ? 0 : tN / tD;
        const dx_ = wx + sc * ux - tc * vx; const dy_ = wy + sc * uy - tc * vy;
        return Math.hypot(dx_, dy_);
      };

      // helper: project point onto seg and return proj coords and distance
      const pxToSeg = (x,y,x1,y1,x2,y2)=>{
        const A = x - x1, B = y - y1, C = x2 - x1, D = y2 - y1;
        const dot = A*C + B*D; const len2 = C*C + D*D;
        const t = Math.max(0, Math.min(1, len2 ? dot/len2 : 0));
        const projx = x1 + t*C; const projy = y1 + t*D; const dx = x - projx, dy = y - projy;
        return { x: projx, y: projy, t, dist: Math.hypot(dx,dy) };
      };

      // Strict finish-line crossing detection (horizontal line),
      // only count when coming from BELOW to ABOVE to avoid triggers por acercamiento lateral.
      let did = false;
      let debugCross = null;
      if(curr.y !== prev.y){
        // require vertical direction upwards through the line
        if(prev.y > seg.y && curr.y <= seg.y){
          const t = (seg.y - prev.y) / (curr.y - prev.y);
          if(Number.isFinite(t)){
            const xCross = prev.x + t * (curr.x - prev.x);
            const minX = Math.min(seg.x1, seg.x2);
            const maxX = Math.max(seg.x1, seg.x2);
            const xTol = 4; // ventana X apretada
            if(xCross >= (minX - xTol) && xCross <= (maxX + xTol)){
              did = true; debugCross = { x: xCross, y: seg.y };
            }
          }
        }
      }

      // debug draw (world-space)
      try{
        if(DEBUG_FINISH && this._debugGraphics){
          const g = this._debugGraphics; g.clear();
          g.lineStyle(6,0xffffff,0.95); g.lineBetween(seg.x1, seg.y, seg.x2, seg.y);
          g.lineStyle(2,0xffff00,0.9); g.strokeRect(Math.min(seg.x1,seg.x2)-4, seg.y-6, (Math.abs(seg.x2-seg.x1)+8), 12);
          g.lineStyle(2,0x00ffff,0.9); g.lineBetween(prev.x, prev.y, curr.x, curr.y);
          const pr = (this.player && this.player.body) ? Math.max(this.player.body.width, this.player.body.height)*0.5 : 18;
          g.lineStyle(1,0x00ff00,0.9); g.strokeCircle(prev.x, prev.y, pr); g.strokeCircle(curr.x, curr.y, pr);
          if(debugCross){ g.fillStyle(did?0xff0000:0xffff00,1); g.fillCircle(debugCross.x, debugCross.y, 6); }
        }
      }catch(e){ /* ignore debug drawing errors */ }

      if(did){
        // show summary overlay and wait Enter
        gameState = 'summary';
        totalRemainingTime += Math.max(0, Math.ceil(levelTimeLimit));
        const regionName = REGIONS[(level-1)%REGIONS.length]||('Nivel '+level);
        const isFinal = (level === REGIONS.length);
        const summary = isFinal
          ? `Felicitaciones! Has completado Chile Rush\nRegión final: ${regionName}\nPuntaje total: ${score}\nTiempo total sobrante: ${totalRemainingTime}s\n\nPresiona Enter para reiniciar`
          : `Nivel completado: ${regionName}\nPuntaje: ${score}\nTiempo del nivel: ${levelElapsedSec.toFixed(1)}s\nTiempo sobrante: ${Math.ceil(levelTimeLimit)}s\n\nPresiona Enter para continuar`;
        if(this.overlay) this.overlay.destroy();
        const style = isFinal
          ? { fontSize:'28px', fill:'#ffff66', stroke:'#000000', strokeThickness:5, align:'center', backgroundColor:'rgba(0,0,0,0.75)', padding:{x:14,y:12}, wordWrap: { width: Math.floor(W*0.9) } }
          : { fontSize:'24px', fill:'#ffffff', align:'center', backgroundColor:'rgba(0,0,0,0.5)', padding:{x:12,y:10}, wordWrap: { width: Math.floor(W*0.9) } };
        this.overlay = this.add.text(W/2, H/2, summary, style).setOrigin(0.5).setScrollFactor(0).setDepth(3000);
        try{ this.physics.world.pause(); this.player.setVelocity(0,0); }catch(e){}
        return;
      }
    }
  } catch(e){ /* ignore */ }

  // save prev pos for next frame
  this._prevPos.x = this.player.x; this._prevPos.y = this.player.y;
}

function handleCheckpoint(player, checkpoint){
  // directional checkpoint: only set passedCheckpoint if the player crosses the checkpoint
  // plane in the forward direction along the track. This avoids accidental overlaps on spawn.
  try{
    const prev = this._prevPos || { x: player.x, y: player.y };
    const curr = { x: player.x, y: player.y };
    const cx = checkpoint.x, cy = checkpoint.y;
    // find nearest index in TRACK_PATH for this checkpoint position (fallback to mid)
    let idx = -1;
    for(let i=0;i<TRACK_PATH.length;i++){
      const p = TRACK_PATH[i]; if(Math.abs(p[0]-cx) < 1 && Math.abs(p[1]-cy) < 1){ idx = i; break; }
    }
    if(idx === -1) idx = Math.floor(TRACK_PATH.length/2);
    const p0 = TRACK_PATH[Math.max(0, idx-1)];
    const p1 = TRACK_PATH[Math.min(TRACK_PATH.length-1, idx+1)];
    // tangent from p0 -> p1
    const tx = p1[0] - p0[0], ty = p1[1] - p0[1];
    const tlen = Math.hypot(tx,ty) || 1; const ux = tx / tlen, uy = ty / tlen;
    // project prev and curr onto tangent relative to checkpoint position
    const dp = (prev.x - cx) * ux + (prev.y - cy) * uy;
    const dc = (curr.x - cx) * ux + (curr.y - cy) * uy;
    // crossing forward if dp < 0 and dc >= 0 (allow small tolerance)
    if(dp < 0 && dc >= 0){ passedCheckpoint = true; }
  }catch(e){ passedCheckpoint = true; }
}

function handleFinishLine(player, finishLine){
  // ignore overlap triggers while we're already finishing/transitioning
  if(this._finishing) return;
  // If called due to overlap and time already expired, show timeout summary
  if(levelTimeLimit<=0){
    try{ lapCount = 0; if(typeof lapText !== 'undefined') lapText.setText('Lap: 0'); }catch(e){}
    gameState = 'summary';
    const regionName = REGIONS[(level-1)%REGIONS.length]||('Nivel '+level);
    const summary = `Tiempo agotado\nRegión: ${regionName}\nPuntaje: ${score}\n\nPresiona Enter para continuar`;
    if(this.overlay) this.overlay.destroy();
    this.overlay = this.add.text(W/2, H/2, summary, { fontSize:'24px', fill:'#ffffff', align:'center', backgroundColor:'rgba(0,0,0,0.5)', padding:{x:12,y:10} }).setOrigin(0.5).setScrollFactor(0).setDepth(3000);
    try{ this.physics.world.pause(); this.player.setVelocity(0,0); }catch(e){}
    return;
  }
  // Normal finish summary (mirror update())
  gameState = 'summary';
  totalRemainingTime += Math.max(0, Math.ceil(levelTimeLimit));
  const regionName = REGIONS[(level-1)%REGIONS.length]||('Nivel '+level);
  const isFinal = (level === REGIONS.length);
  const summary = isFinal
    ? `🎉 Felicitaciones! Has completado Chile Rush 🎉\nRegión final: ${regionName}\nPuntaje total: ${score}\nTiempo total sobrante: ${totalRemainingTime}s\n\nPresiona Enter para continuar`
    : `Nivel completado: ${regionName}\nPuntaje: ${score}\nTiempo del nivel: ${levelElapsedSec.toFixed(1)}s\nTiempo sobrante: ${Math.ceil(levelTimeLimit)}s\n\nPresiona Enter para continuar`;
  if(this.overlay) this.overlay.destroy();
  const style = isFinal
    ? { fontSize:'28px', fill:'#ffff66', stroke:'#000000', strokeThickness:5, align:'center', backgroundColor:'rgba(0,0,0,0.75)', padding:{x:14,y:12}, wordWrap: { width: Math.floor(W*0.9) } }
    : { fontSize:'24px', fill:'#ffffff', align:'center', backgroundColor:'rgba(0,0,0,0.5)', padding:{x:12,y:10}, wordWrap: { width: Math.floor(W*0.9) } };
  this.overlay = this.add.text(W/2, H/2, summary, style).setOrigin(0.5).setScrollFactor(0).setDepth(3000);
  try{ this.physics.world.pause(); this.player.setVelocity(0,0); }catch(e){}
}

function startNextLevel(scene, keepLevel){
  // guard re-entrancy: if already finishing, ignore
  if(scene._finishing) return;
  scene._finishing = true;
  if(!keepLevel){ level++; }
  scene.level = level;
  if(typeof levelText !== 'undefined') levelText.setText('Level: ' + level);
  scene.cameras.main.flash(300,255,255,150);
  scene.cameras.main.shake(200,0.01);
  // increase difficulty slightly
  scene.playerSpeedMax = Math.min(600, (scene.baseSpeedMax||300) + (keepLevel?0:40)); scene.baseSpeedMax = scene.playerSpeedMax;
  // regenerate track for this level
  generateTrack(scene, level);
  if(scene.trackImage) scene.trackImage.setTexture('trackTexture');
  try{ if(scene.regionText) scene.regionText.setText(REGIONS[(level-1)%REGIONS.length]||''); }catch(e){}
  // reposition sensors and finish image
  if(scene.finishImage && scene.finishLineSensor && scene.checkpointSensor){
    const endPt = TRACK_PATH[TRACK_PATH.length-1];
    const midPt = TRACK_PATH[Math.floor(TRACK_PATH.length/2)];
    scene.finishLineSensor.setPosition(endPt[0], endPt[1]);
    scene.checkpointSensor.setPosition(midPt[0], midPt[1]);
    scene.finishImage.setPosition(endPt[0], endPt[1]);
    // update sensor circle sizes to match new ROAD_HALF
    const sensorRadius = Math.max(40, Math.round(ROAD_HALF * 0.7));
    if(scene.checkpointSensor.body){ scene.checkpointSensor.body.setCircle(sensorRadius); scene.checkpointSensor.body.setOffset(-sensorRadius + (scene.checkpointSensor.width/2), -sensorRadius + (scene.checkpointSensor.height/2)); }
    if(scene.finishLineSensor.body){ scene.finishLineSensor.body.setCircle(sensorRadius); scene.finishLineSensor.body.setOffset(-sensorRadius + (scene.finishLineSensor.width/2), -sensorRadius + (scene.finishLineSensor.height/2)); }
    // update finish segment for crossing detection
    const finishLen = Math.max(80, Math.round(scene.finishImage.displayWidth || 120));
    scene.finishSeg = { x1: endPt[0] - finishLen/2, y: endPt[1], x2: endPt[0] + finishLen/2, y: endPt[1] };
    // also refresh the minimap to reflect new track/rocks
    try{ createMinimap(scene); }catch(e){}
  }
  // respawn rocks near edges of the road
  scene.rocks.clear(true,true);
  // spawn exactly 2 random turbos and 2 bananas per level
  try{ spawnTwoTurbos(scene); spawnBananas(scene); }catch(e){}
  const count = 6 + level*2;
  for(let i=0;i<count;i++){
    const idx = Phaser.Math.Between(0, TRACK_PATH.length-2);
    const p0 = TRACK_PATH[idx]; const p1 = TRACK_PATH[idx+1];
    const t = Math.random();
    const px = Phaser.Math.Interpolation.Linear([p0[0], p1[0]], t);
    const py = Phaser.Math.Interpolation.Linear([p0[1], p1[1]], t);
    const nx = p1[1] - p0[1]; const ny = -(p1[0] - p0[0]);
    const len = Math.hypot(nx, ny) || 1; const ux = nx/len; const uy = ny/len;
    const side = Math.random() < 0.5 ? 1 : -1;
    const margin = 30 + level*4;
    const dist = ROAD_HALF + margin;
    const rx = px + ux * dist * side + Phaser.Math.Between(-20,20);
    const ry = py + uy * dist * side + Phaser.Math.Between(-20,20);
    scene.rocks.create(rx,ry,'rock');
  }
  // reset player to just behind new start
  const startPt = TRACK_PATH[0]; const dx = TRACK_PATH[1][0]-startPt[0]; const dy = TRACK_PATH[1][1]-startPt[1];
  const ang = Math.atan2(dy,dx); const nx2 = Math.cos(ang); const ny2 = Math.sin(ang);
  scene.player.setPosition(startPt[0] - nx2*80, startPt[1] - ny2*80);
  scene.player.setVelocity(0,0);
  scene.playerSpeed = 0;
  passedCheckpoint = false;
  levelTimeLimit = getTimeLimitForLevel(level);
  levelElapsedSec = 0;

  // short tone
  if(typeof playTone === 'function') playTone(880,0.07);
  // allow future finishes after a short transition
  try{ scene.time.delayedCall(600, ()=> { scene._finishing = false; }); }catch(e){ scene._finishing = false; }
}

// Phaser config and game bootstrap
const config = {
  type: Phaser.AUTO,
  width: W, height: H,
  backgroundColor: '#1f6b2f',
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: { preload, create, update }
};

const game = new Phaser.Game(config);
