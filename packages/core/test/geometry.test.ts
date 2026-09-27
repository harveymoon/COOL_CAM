import { describe, it, expect } from 'vitest';
import { rect, circleShape, normalize, offsetPolygons, signedArea, chain, parseSvg, parseDxf, bbox, area } from '../src/index.js';

describe('geometry', () => {
  it('normalize orients outers CCW and holes CW', () => {
    const r = normalize([rect(0, 0, 100, 50), circleShape(50, 25, 20)]);
    expect(r).toHaveLength(2);
    const outer = r.find(p => signedArea(p) > 0)!; const hole = r.find(p => signedArea(p) < 0)!;
    expect(Math.abs(signedArea(outer) - 5000)).toBeLessThan(1);
    expect(Math.abs(signedArea(hole) + Math.PI * 100)).toBeLessThan(2);
  });
  it('offset inward shrinks and outward grows', () => {
    const r = normalize([rect(0, 0, 100, 50)]);
    const inn = offsetPolygons(r, -5); const out = offsetPolygons(r, 5);
    expect(area(inn)).toBeCloseTo(90 * 40, 0);
    expect(area(out)).toBeGreaterThan(5000);
    expect(bbox(out).minX).toBeCloseTo(-5, 2);
  });
  it('offset too far yields nothing', () => {
    expect(offsetPolygons(normalize([rect(0, 0, 10, 10)]), -6)).toHaveLength(0);
  });
  it('chains open segments into a closed loop', () => {
    const segs = [
      { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false },
      { points: [{ x: 10, y: 10 }, { x: 10, y: 0 }], closed: false },
      { points: [{ x: 0, y: 10 }, { x: 10, y: 10 }], closed: false },
      { points: [{ x: 0, y: 10 }, { x: 0, y: 0 }], closed: false },
    ];
    const c = chain(segs);
    expect(c).toHaveLength(1); expect(c[0].closed).toBe(true); expect(c[0].points).toHaveLength(4);
  });
});

describe('importers', () => {
  it('parses svg with physical units and flips Y', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50"><rect x="5" y="5" width="40" height="30"/><circle cx="70" cy="25" r="10"/></svg>`;
    const s = parseSvg(svg);
    expect(s).toHaveLength(2);
    const b = bbox(s[0]);
    expect(b.minX).toBeCloseTo(5); expect(b.maxX).toBeCloseTo(45);
    expect(b.minY).toBeCloseTo(15); expect(b.maxY).toBeCloseTo(45); // flipped about the 50 mm page height
  });
  it('parses svg path arcs and transforms', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(10,0)"><path d="M0 0 H 20 A 10 10 0 0 1 20 20 H 0 Z"/></g></svg>`;
    const s = parseSvg(svg, { flipY: false });
    expect(s).toHaveLength(1); expect(s[0].closed).toBe(true);
    const b = bbox(s[0]); const mm = 25.4 / 96;
    expect(b.minX).toBeCloseTo(10 * mm, 3); expect(b.maxX).toBeCloseTo(40 * mm, 1);
  });
  it('parses dxf lwpolyline with bulge, circle and inch units', () => {
    const dxf = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\n0\n90\n2\n70\n1\n10\n0\n20\n0\n42\n1\n10\n2\n20\n0\n42\n1\n0\nCIRCLE\n8\n0\n10\n1\n20\n0\n40\n0.5\n0\nENDSEC\n0\nEOF\n`;
    const s = parseDxf(dxf);
    expect(s).toHaveLength(2);
    const b = bbox(s[0]); // two semicircle bulges → a circle of radius 1 inch
    expect(b.minX).toBeCloseTo(0, 1); expect(b.maxX).toBeCloseTo(50.8, 1); expect(b.maxY).toBeCloseTo(25.4, 1);
  });
});
