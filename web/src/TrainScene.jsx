import { memo, useEffect, useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

// Pixel-art dusk-railway scene, GSAP-driven by the LIVE multiplier. Side-scroller
// "treadmill": the train holds a cruising spot while the WORLD scrolls past
// (track, poles, drifting clouds, parallax hills) so speed reads at a glance. It
// pulls away from the station on departure; wheels roll in sync with the ground;
// smoke trails; a RADIAL ZOOM BLUR (warp-speed) builds above 7x; on crash the
// cars JACKKNIFE off the rails (no explosion).
//
// Geometry + wheel positions must match tools/gen_assets.mjs.
const SCENE = { W: 480, H: 180, TRAIN_Y: 92, RAIL_Y: 146 };
const CAR = { coach: 2, tender: 86, loco: 139 };
const WHEELS = { coach: [16, 28, 64, 76], tender: [12, 24, 42, 54], loco: [40, 60, 80, 104], WY: 47 };
const CRUISE_X = 44, STATION_X0 = 8, TIE_GAP = 12, POLE_GAP = 150;
const CLOUDS = [{ x: 100, y: 38 }, { x: 260, y: 26 }, { x: 400, y: 50 }, { x: 180, y: 62 }];
const mod = (a, n) => ((a % n) + n) % n;
const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });

function drawCar(ctx, body, wheelImg, wheelXs, x, y, rotDeg, wheelAngle) {
  const px = body.width * 0.32, py = body.height;
  ctx.save();
  ctx.translate(x + px, y + py);
  if (rotDeg) ctx.rotate((rotDeg * Math.PI) / 180);
  ctx.translate(-px, -py);
  for (const wx of wheelXs) { ctx.save(); ctx.translate(wx, WHEELS.WY); ctx.rotate(wheelAngle); ctx.drawImage(wheelImg, -9, -9); ctx.restore(); }
  ctx.drawImage(body, 0, 0);
  ctx.restore();
}

function TrainSceneBase({ multiplierRef, phase, roundId, reduced = false }) {
  const root = useRef(null);
  const canvasRef = useRef(null);
  const phaseRef = useRef(phase);
  const reduce = useRef(false);
  const st = useRef({ scroll: 0, stationX: STATION_X0, wheelAngle: 0, shake: 0, flash: 0, carRot: [0, 0, 0], carDY: [0, 0, 0], carDX: [0, 0, 0], smoke: [], spawn: 0 });
  const imgs = useRef(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  // Honor both the OS setting AND the in-app Settings toggle, kept in sync.
  useEffect(() => { reduce.current = reduced || window.matchMedia('(prefers-reduced-motion: reduce)').matches; }, [reduced]);

  useGSAP(() => {
    reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = canvasRef.current.getContext('2d'); // visible
    const buf = document.createElement('canvas'); buf.width = SCENE.W; buf.height = SCENE.H;
    const b = buf.getContext('2d'); b.imageSmoothingEnabled = false; // background drawn here first
    const trainBuf = document.createElement('canvas'); trainBuf.width = SCENE.W; trainBuf.height = SCENE.H;
    const tb = trainBuf.getContext('2d'); tb.imageSmoothingEnabled = false; // train drawn here
    Promise.all(['sky', 'hills-far', 'hills-near', 'cloud', 'station', 'loco', 'tender', 'coach', 'wheel'].map((n) => loadImg(`/assets/${n}.png`))).then(
      ([sky, hillsFar, hillsNear, cloud, station, loco, tender, coach, wheel]) => { imgs.current = { sky, hillsFar, hillsNear, cloud, station, loco, tender, coach, wheel }; },
    );

    const draw = () => {
      const I = imgs.current;
      if (!I) return;
      const s = st.current;
      const m = multiplierRef.current || 1;
      const ph = phaseRef.current;
      const running = ph === 'running';
      const dr = gsap.ticker.deltaRatio();
      const speed = running ? gsap.utils.clamp(0, 1, (m - 1) / 8) : 0;
      const scrollSpeed = running ? 2 + speed * 11 : 0;

      s.scroll += scrollSpeed * dr;
      if (running) s.stationX -= scrollSpeed * dr;
      s.wheelAngle += (scrollSpeed / 7) * dr; // roll without slipping (r=7)
      if (ph !== 'crashed') s.shake += (((running && !reduce.current ? gsap.utils.clamp(0, 3, (m - 1) * 0.25) : 0) - s.shake) * 0.1);

      s.spawn -= dr;
      if (s.spawn <= 0 && ph !== 'crashed') { s.spawn = running ? 5 - speed * 3 : 12; s.smoke.push({ x: CRUISE_X + 233, y: SCENE.TRAIN_Y + 11, life: 0, max: 44 + Math.random() * 20 }); }
      for (const p of s.smoke) { p.life += dr; p.y -= 0.5 * dr; p.x -= (0.4 + scrollSpeed * 0.5) * dr; }
      s.smoke = s.smoke.filter((p) => p.life < p.max);

      // ---- background (everything but the train) into the offscreen buffer ----
      const shx = Math.round((Math.random() - 0.5) * s.shake), shy = Math.round((Math.random() - 0.5) * s.shake * 0.6);
      b.clearRect(0, 0, SCENE.W, SCENE.H);
      b.save();
      b.translate(shx, shy);
      b.drawImage(I.sky, 0, 0);
      const hf = mod(s.scroll * 0.18, SCENE.W);
      b.drawImage(I.hillsFar, Math.round(-hf), 0); b.drawImage(I.hillsFar, Math.round(SCENE.W - hf), 0);
      const hn = mod(s.scroll * 0.4, SCENE.W);
      b.drawImage(I.hillsNear, Math.round(-hn), 0); b.drawImage(I.hillsNear, Math.round(SCENE.W - hn), 0);
      const cspan = SCENE.W + 72;
      for (const cl of CLOUDS) b.drawImage(I.cloud, Math.round(mod(cl.x - s.scroll * 0.12, cspan) - 36), cl.y);

      b.fillStyle = '#1e2a21'; b.fillRect(0, SCENE.RAIL_Y - 4, SCENE.W, 12); // ballast
      b.fillStyle = '#151d17'; // ties
      const tieOff = mod(s.scroll, TIE_GAP);
      for (let x = -TIE_GAP; x < SCENE.W + TIE_GAP; x += TIE_GAP) b.fillRect(Math.round(x - tieOff), SCENE.RAIL_Y - 2, 4, 8);
      b.fillStyle = '#786c48'; b.fillRect(0, SCENE.RAIL_Y - 1, SCENE.W, 2);
      b.fillStyle = '#3a3426'; b.fillRect(0, SCENE.RAIL_Y + 4, SCENE.W, 1);

      b.fillStyle = '#2c281e'; // poles
      const poleOff = mod(s.scroll * 1.15, POLE_GAP);
      for (let x = -POLE_GAP; x < SCENE.W + POLE_GAP; x += POLE_GAP) { const px = Math.round(x - poleOff); b.fillRect(px, 100, 2, 26); b.fillRect(px - 6, 104, 14, 2); b.fillRect(px - 6, 108, 14, 2); }

      if (s.stationX > -72) b.drawImage(I.station, Math.round(s.stationX), SCENE.RAIL_Y - 48); // departing station

      for (const p of s.smoke) { const a = 1 - p.life / p.max; b.globalAlpha = 0.5 * a; b.fillStyle = '#ded2bc'; b.beginPath(); b.arc(Math.round(p.x), Math.round(p.y), Math.round(2 + p.life * 0.07), 0, 7); b.fill(); }
      b.globalAlpha = 1;
      b.restore();

      // ---- present the BACKGROUND, radial zoom-blurred above 7x; the train stays sharp ----
      const blur = running ? gsap.utils.clamp(0, 1, (m - 7) * 0.16) : 0; // warp speed above 7x
      if (blur > 0.05) {
        const N = 10, maxZoom = 0.04 + blur * 0.09;
        const cx = CRUISE_X + 140, cy = SCENE.TRAIN_Y + 28; // blur radiates from behind the train
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, SCENE.W, SCENE.H);
        for (let i = 0; i < N; i++) {
          const sc = 1 + maxZoom * (i / (N - 1));
          ctx.globalAlpha = 1 / N;
          ctx.save();
          ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy);
          ctx.drawImage(buf, 0, 0);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(buf, 0, 0);
      }

      // ---- the train: drawn to its own buffer, composited with a LIGHT zoom blur
      // (a fraction of the background's) so it reads as the focus but isn't a hard
      // cut-out pasted on top ----
      const y = SCENE.TRAIN_Y;
      tb.clearRect(0, 0, SCENE.W, SCENE.H);
      drawCar(tb, I.coach, I.wheel, WHEELS.coach, CRUISE_X + CAR.coach + s.carDX[0], y + s.carDY[0], s.carRot[0], s.wheelAngle);
      drawCar(tb, I.tender, I.wheel, WHEELS.tender, CRUISE_X + CAR.tender + s.carDX[1], y + s.carDY[1], s.carRot[1], s.wheelAngle);
      drawCar(tb, I.loco, I.wheel, WHEELS.loco, CRUISE_X + CAR.loco + s.carDX[2], y + s.carDY[2], s.carRot[2], s.wheelAngle);
      ctx.save();
      ctx.translate(shx, shy);
      if (blur > 0.05) {
        const N = 5, mz = 0.012 + blur * 0.035; // ~1/4 of the background smear
        const cx = CRUISE_X + 140, cy = SCENE.TRAIN_Y + 28;
        ctx.imageSmoothingEnabled = true;
        for (let i = 0; i < N; i++) { const sc = 1 + mz * (i / (N - 1)); ctx.globalAlpha = 1 / N; ctx.save(); ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy); ctx.drawImage(trainBuf, 0, 0); ctx.restore(); }
        ctx.globalAlpha = 1;
      } else {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(trainBuf, 0, 0);
      }
      ctx.restore();

      // ---- crash tint (only while actually derailed, so it can never bleed into a run) ----
      if (s.flash > 0 && ph === 'crashed') { ctx.globalAlpha = s.flash; ctx.fillStyle = '#c0472e'; ctx.fillRect(0, 0, SCENE.W, SCENE.H); ctx.globalAlpha = 1; }
    };
    gsap.ticker.add(draw);
    return () => gsap.ticker.remove(draw);
  }, { scope: root });

  // derail (jackknife) on crash, reset on a new round. Plain useEffect — NOT
  // useGSAP — because useGSAP's auto-revert was restoring the stale jackknife
  // pose mid-run (loco "broke" while still running). `running` also hard-resets
  // the cars as a belt-and-suspenders guarantee they're coupled + upright.
  useEffect(() => {
    const s = st.current;
    gsap.killTweensOf([s.carRot, s.carDY, s.carDX, s]);
    const setArr = (a, v) => { a[0] = a[1] = a[2] = v; };
    if (phase === 'crashed') {
      const k = reduce.current ? 0.35 : 1;
      gsap.timeline()
        .to(s.carRot, { 0: 8 * k, 1: -13 * k, 2: 22 * k, duration: 0.5, ease: 'power3.in' }, 0)
        .to(s.carDY, { 0: 10 * k, 1: 4 * k, 2: 16 * k, duration: 0.6, ease: 'bounce.out' }, 0.1)
        .to(s.carDX, { 0: -8 * k, 1: -3 * k, 2: 12 * k, duration: 0.5, ease: 'power2.out' }, 0)
        .fromTo(s, { shake: 12 * k }, { shake: 0, duration: 0.8, ease: 'power2.out' }, 0)
        .fromTo(s, { flash: 0.5 * k }, { flash: 0, duration: 0.8, ease: 'power2.out' }, 0.05);
    } else if (phase === 'betting') {
      s.stationX = STATION_X0; s.flash = 0; s.shake = 0; // station returns; clear any crash residue
      gsap.to(s.carRot, { 0: 0, 1: 0, 2: 0, duration: 0.6, ease: 'power2.out' });
      gsap.to(s.carDY, { 0: 0, 1: 0, 2: 0, duration: 0.6, ease: 'power2.out' });
      gsap.to(s.carDX, { 0: 0, 1: 0, 2: 0, duration: 0.6, ease: 'power2.out' });
    } else {
      setArr(s.carRot, 0); setArr(s.carDY, 0); setArr(s.carDX, 0); // running: never broken
      s.flash = 0;
    }
  }, [phase, roundId]);

  return (
    <div className="train-scene" ref={root} aria-hidden="true">
      <canvas ref={canvasRef} width={SCENE.W} height={SCENE.H} />
    </div>
  );
}

export const TrainScene = memo(TrainSceneBase, (a, b) => a.phase === b.phase && a.roundId === b.roundId && a.reduced === b.reduced);
