import type { ReactElement } from 'react';
import type { Tool } from '@cool-cam/core';

/**
 * A side-on drawing of a cutter built from its parameters: shank, flutes with a helix hint per flute, and the tip geometry
 * (flat, ball, V at the real included angle, drill point, keyhole head). Diameters and flute lengths are to a shared scale so a
 * 1/16" bit reads as small next to a 1/4". A tool with an `image` shows that picture instead.
 */
export function ToolGlyph({ tool, size = 96 }: { tool: Tool; size?: number }) {
  if (tool.image) return <img src={tool.image} alt={tool.name} style={{ width: size, height: size * 1.5, objectFit: 'contain', background: '#0d0f13' }} />;
  const W = 100, H = 160;                          // viewBox
  const pxPerMm = 4.2;                              // 12.7 mm bit → ~53 px wide
  const d = Math.max(2.5, tool.diameter * pxPerMm);
  const shankD = Math.max(2.5, (tool.shankDiameter ?? (tool.type === 'keyhole' ? tool.diameter * 0.45 : Math.min(tool.diameter, 6.35))) * pxPerMm);
  const fluteLen = Math.min(90, Math.max(18, (tool.fluteLength ?? tool.diameter * 3) * 3.2));
  const cx = W / 2; const shankTop = 8; const shankLen = 44; const fluteTop = shankTop + shankLen;
  const half = ((tool.tipAngle ?? (tool.type === 'drill' ? 118 : 90)) * Math.PI) / 360;
  const steel = '#b6bdc9', dark = '#7c8493', edge = '#2a2f3a', stripe = '#3a4150';
  const parts: ReactElement[] = [];
  // shank with the collet zone hinted
  parts.push(<rect key="shank" x={cx - shankD / 2} y={shankTop} width={shankD} height={shankLen} fill={dark} stroke={edge} />);
  parts.push(<rect key="collet" x={cx - shankD / 2} y={shankTop} width={shankD} height={10} fill="#5a6170" stroke={edge} />);
  const helix = (top: number, len: number, width: number, n: number) => {
    const out: ReactElement[] = [];
    const count = Math.max(1, Math.min(6, n));
    for (let k = 0; k < count; k++) {
      const dx = (k / count) * width;
      out.push(<path key={`h${k}`} d={`M ${cx - width / 2 + dx} ${top} q ${width * 0.6} ${len * 0.5} ${width * 0.15} ${len}`} fill="none" stroke={stripe} strokeWidth={1.2} />);
    }
    return out;
  };
  if (tool.type === 'endmill') {
    parts.push(<rect key="fl" x={cx - d / 2} y={fluteTop} width={d} height={fluteLen} fill={steel} stroke={edge} />);
    parts.push(...helix(fluteTop, fluteLen, d, tool.flutes));
    parts.push(<line key="tip" x1={cx - d / 2} y1={fluteTop + fluteLen} x2={cx + d / 2} y2={fluteTop + fluteLen} stroke="#e6ebf2" strokeWidth={1.5} />);
  } else if (tool.type === 'ballnose') {
    const r = d / 2; const straight = Math.max(4, fluteLen - r);
    parts.push(<path key="fl" d={`M ${cx - r} ${fluteTop} v ${straight} a ${r} ${r} 0 0 0 ${d} 0 v ${-straight} z`} fill={steel} stroke={edge} />);
    parts.push(...helix(fluteTop, straight, d, tool.flutes));
  } else if (tool.type === 'vbit') {
    const coneH = Math.min(fluteLen, (d / 2) / Math.tan(half));
    const body = Math.max(0, Math.min(14, fluteLen - coneH));
    parts.push(<path key="fl" d={`M ${cx - d / 2} ${fluteTop} v ${body} L ${cx} ${fluteTop + body + coneH} L ${cx + d / 2} ${fluteTop + body} v ${-body} z`} fill={steel} stroke={edge} />);
    parts.push(<line key="edge" x1={cx} y1={fluteTop} x2={cx} y2={fluteTop + body + coneH} stroke={stripe} strokeWidth={1} />);
    parts.push(<text key="ang" x={cx} y={fluteTop + body + coneH + 12} textAnchor="middle" fontSize={10} fill="#8a919e" fontFamily="monospace">{tool.tipAngle ?? 90}°</text>);
  } else if (tool.type === 'drill') {
    const pointH = (d / 2) / Math.tan(half);
    const body = Math.max(6, fluteLen - pointH);
    parts.push(<path key="fl" d={`M ${cx - d / 2} ${fluteTop} v ${body} L ${cx} ${fluteTop + body + pointH} L ${cx + d / 2} ${fluteTop + body} v ${-body} z`} fill={steel} stroke={edge} />);
    parts.push(...helix(fluteTop, body, d, 2));
  } else { // keyhole: thin neck then a wide head
    const neck = Math.max(10, fluteLen * 0.55); const head = Math.max(8, fluteLen - neck);
    parts.push(<rect key="neck" x={cx - shankD / 2} y={fluteTop} width={shankD} height={neck} fill={steel} stroke={edge} />);
    parts.push(<rect key="head" x={cx - d / 2} y={fluteTop + neck} width={d} height={head} fill={steel} stroke={edge} />);
    parts.push(<line key="tip" x1={cx - d / 2} y1={fluteTop + neck + head} x2={cx + d / 2} y2={fluteTop + neck + head} stroke="#e6ebf2" strokeWidth={1.5} />);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={size} height={size * 1.6} style={{ display: 'block', background: '#0d0f13' }} aria-label={tool.name}>
      <line x1={cx} y1={0} x2={cx} y2={H} stroke="#1a1e26" strokeDasharray="2 3" />
      {parts}
      <text x={4} y={H - 5} fontSize={10} fill="#8a919e" fontFamily="monospace">{tool.diameter} mm</text>
      <text x={W - 4} y={H - 5} fontSize={10} fill="#8a919e" fontFamily="monospace" textAnchor="end">{tool.type === 'vbit' ? `${tool.tipAngle ?? 90}° V` : `${tool.flutes} fl`}</text>
    </svg>
  );
}
