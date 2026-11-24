import { QUAT_IDENTITY, type BodyDescriptor } from '@robosim/core';
import { SceneRenderer, detectRenderCaps, type RenderStats } from '@robosim/render';
import { SimClient, mulberry32, type SimStats } from '@robosim/sim';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

/* ---------------- فحص البيئة ---------------- */
function showEnv(): boolean {
  const caps = detectRenderCaps();
  const checks: Array<[string, boolean]> = [
    ['crossOriginIsolated (COOP/COEP)', self.crossOriginIsolated === true],
    ['SharedArrayBuffer', typeof SharedArrayBuffer !== 'undefined'],
    ['Web Workers', typeof Worker !== 'undefined'],
    ['WebGL2', caps.webgl2],
    ['WebGPU (غير مستخدم بعد)', caps.webgpu],
    ['OffscreenCanvas (غير مستخدم بعد)', caps.offscreenCanvas],
  ];
  $('env').innerHTML =
    '<table>' +
    checks
      .map(([l, ok]) => `<tr><td>${l}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? '✔' : '✘'}</td></tr>`)
      .join('') +
    '</table>';
  return checks[0]?.[1] === true && caps.webgl2;
}

/* ---------------- المشهد التجريبي ---------------- */
const at = (x: number, y: number, z: number) => ({
  position: { x, y, z },
  rotation: { ...QUAT_IDENTITY },
});

async function main(): Promise<void> {
  if (!showEnv()) {
    $('error').textContent =
      'يلزم تفعيل العزل (COOP/COEP) ودعم WebGL2. انظر docs/CLOUDFLARE.md';
    return;
  }

  let sim: SimClient;
  try {
    sim = await SimClient.create({ maxBodies: 2048 });
  } catch (e) {
    $('error').textContent = e instanceof Error ? e.message : String(e);
    return;
  }
  sim.onError = (m) => ($('error').textContent = `خطأ في المحاكاة: ${m}`);
  $('demo').hidden = false;

  const view = new SceneRenderer($<HTMLCanvasElement>('view'), sim.reader, {
    maxBodies: sim.config.maxBodies,
    shadows: true,
  });
  view.start();

  const rand = mulberry32(1234);
  let bodyTotal = 0;
  let firstDynamicSlot: number | null = null;

  async function track(d: BodyDescriptor): Promise<void> {
    const { slot } = await sim.addBody(d);
    view.addBody(slot, d);
    bodyTotal++;
    if (d.type === 'dynamic' && firstDynamicSlot === null) {
      firstDynamicSlot = slot;
      view.followSlot(slot);
    }
  }

  async function addBodies(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      const x = (rand() - 0.5) * 8;
      const y = 2 + rand() * 16;
      const z = (rand() - 0.5) * 8;
      if (rand() < 0.25) {
        await track({
          type: 'dynamic',
          shape: { kind: 'sphere', radius: 0.2 + rand() * 0.25 },
          transform: at(x, y, z),
          mass: 1,
          friction: 0.5,
          restitution: 0.4,
        });
      } else {
        const h = 0.15 + rand() * 0.25;
        await track({
          type: 'dynamic',
          shape: { kind: 'box', halfExtents: { x: h, y: h, z: h } },
          transform: at(x, y, z),
          mass: 1,
          friction: 0.6,
          restitution: 0.1,
        });
      }
    }
  }

  async function buildScene(): Promise<void> {
    view.clear();
    bodyTotal = 0;
    firstDynamicSlot = null;
    await track({
      type: 'static',
      shape: { kind: 'plane' },
      transform: at(0, 0, 0),
      friction: 0.8,
    });
    await addBodies(60);
  }

  await buildScene();

  /* ---------------- الأزرار ---------------- */
  let paused = false;
  $('btn-pause').onclick = () => {
    paused = !paused;
    if (paused) sim.pause(); else sim.resume();
    $('btn-pause').textContent = paused ? 'استئناف' : 'إيقاف مؤقت';
  };
  $('btn-step').onclick = () => sim.stepOnce();
  $<HTMLSelectElement>('sel-speed').onchange = (e) =>
    sim.setSpeed(Number((e.target as HTMLSelectElement).value));
  $('btn-add').onclick = () => void addBodies(50);
  $('btn-reset').onclick = () => {
    sim.reset();
    void buildScene();
  };
  $<HTMLSelectElement>('sel-camera').onchange = (e) =>
    view.setCameraMode((e.target as HTMLSelectElement).value === 'follow' ? 'follow' : 'free');
  $<HTMLSelectElement>('sel-quality').onchange = (e) => {
    const v = (e.target as HTMLSelectElement).value;
    view.setQuality(v === 'auto' ? 'auto' : Number(v));
  };
  $<HTMLInputElement>('chk-shadows').onchange = (e) =>
    view.setShadows((e.target as HTMLInputElement).checked);

  /* ---------------- الإحصاءات ---------------- */
  let simStats: SimStats | null = null;
  let renderStats: RenderStats | null = null;
  const refresh = (): void => {
    const s = simStats;
    const r = renderStats;
    $('stats').textContent =
      `bodies: ${bodyTotal}` +
      (s ? ` | sim: ${s.stepsPerSecond.toFixed(0)} steps/s, ${s.stepMs.toFixed(3)} ms/step, t=${s.time.toFixed(2)}s` : '') +
      (r
        ? ` | render: ${r.fps.toFixed(0)} fps, ${r.drawCalls} draws, ${(r.triangles / 1000).toFixed(1)}k tris, quality ${r.qualityLevel}, pr ${r.pixelRatio}`
        : '');
  };
  sim.onStats = (s) => { simStats = s; refresh(); };
  view.onStats = (r) => { renderStats = r; refresh(); };
}

void main();
