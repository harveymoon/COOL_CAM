import { useEffect, useRef, useState } from 'react';
import { heightmapToMesh, placementFor, stockBounds, uid, IDENTITY_PLACEMENT } from '@cool-cam/core';
import type { GrayImage, Model } from '@cool-cam/core';
import { Modal } from '../Modal';
import { Num, Check } from '../Fields';
import { useUi } from '../ui';
import { showPanel } from '../layout';

export function HeightmapModal({ file }: { file: File }) {
  const ui = useUi();
  const [img, setImg] = useState<GrayImage | null>(null); const [url, setUrl] = useState<string>('');
  const [width, setWidth] = useState<number | undefined>(100); const [depth, setDepth] = useState<number | undefined>(5); const [base, setBase] = useState<number | undefined>(1);
  const [invert, setInvert] = useState(false); const [blur, setBlur] = useState<number | undefined>(1); const [columns, setColumns] = useState<number | undefined>(160);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file); setUrl(u);
    const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); const max = 1024; const k = Math.min(1, max / Math.max(im.width, im.height)); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); const g = c.getContext('2d')!; g.drawImage(im, 0, 0, c.width, c.height); const d = g.getImageData(0, 0, c.width, c.height).data; const data = new Float32Array(c.width * c.height); for (let i = 0; i < data.length; i++) data[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255; setImg({ width: c.width, height: c.height, data }); }; im.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const add = () => {
    if (!img || !ui.job) return;
    const mesh = heightmapToMesh(img, { width: width ?? 100, depth: depth ?? 5, invert, blur, columns, base });
    const model: Model = { id: uid('relief'), name: file.name, positions: Array.from(mesh.positions, v => Math.round(v * 1000) / 1000), placement: { ...IDENTITY_PLACEMENT } };
    ui.setJob(j => { const b = stockBounds(j.stock); model.placement = placementFor(model, { centerX: (b.x0 + b.x1) / 2, centerY: (b.y0 + b.y1) / 2, top: b.top }); return { ...j, models: [...(j.models ?? []), model] }; });
    ui.setSelectedModel(model.id); ui.closeModal(); const api = ui.dockRef.current; if (api) showPanel(api, 'models');
  };
  const h = img && width ? (width * img.height) / img.width : 0;
  return (
    <Modal title={`Image → relief: ${file.name}`} onClose={ui.closeModal} width={560} footer={<><span className="muted">{img ? `${img.width}×${img.height} px → ${columns ?? 160} cols, ${(((columns ?? 160) * ((columns ?? 160) * (img.height / img.width))) * 2 / 1000).toFixed(0)}k triangles` : 'loading…'}</span><span className="spacer" /><button onClick={ui.closeModal}>Cancel</button><button className="primary" onClick={add} disabled={!img}>Add model</button></>}>
      <div className="form">
        <div style={{ display: 'flex', gap: 12 }}>
          {url && <img src={url} alt="" style={{ width: 180, height: 'auto', filter: invert ? 'invert(1)' : 'none', border: '1px solid var(--border)' }} />}
          <div style={{ flex: 1 }}>
            <div className="grid3">
              <Num label="width mm" value={width} step={5} onChange={setWidth} />
              <div className="row"><span className="lbl">height mm</span><span className="mono">{h.toFixed(1)}</span></div>
              <Num label="relief mm" value={depth} step={0.5} hint="height between black and white" onChange={setDepth} />
            </div>
            <div className="grid3">
              <Num label="base mm" value={base} step={0.5} hint="solid plate under the relief" onChange={setBase} />
              <Num label="blur px" value={blur} step={1} onChange={setBlur} />
              <Num label="columns" value={columns} step={20} hint="grid resolution (max 512)" onChange={setColumns} />
            </div>
            <Check label="invert (white = low)" value={invert} onChange={setInvert} />
          </div>
        </div>
        <div className="muted">White pixels become the highest surface. The model lands centred on the stock with its top at Z0; rough it with a flat endmill and finish with a ball nose (stepover ~10% of diameter).</div>
      </div>
    </Modal>
  );
}
