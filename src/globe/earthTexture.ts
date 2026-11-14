import { geoEquirectangular, geoGraticule10, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import world from 'world-atlas/countries-50m.json';

export interface EarthPalette {
  ocean: string;
  land: string;
  border: string;
  coast: string;
  graticule: string;
}

export const LIGHT_EARTH: EarthPalette = {
  ocean: '#e3eaf3',
  land: '#fbfcfe',
  border: '#d3dbe6',
  coast: '#b9c5d4',
  graticule: 'rgba(120, 140, 170, 0.16)',
};

/** Equirectangular canvas texture of the Earth in a flat, light style. */
export function drawEarthTexture(width = 4096, pal: EarthPalette = LIGHT_EARTH): HTMLCanvasElement {
  const height = width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2]);
  const path = geoPath(projection, ctx);

  ctx.fillStyle = pal.ocean;
  ctx.fillRect(0, 0, width, height);

  ctx.beginPath();
  path(geoGraticule10());
  ctx.strokeStyle = pal.graticule;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const topo = world as unknown as Topology<{ countries: GeometryCollection; land: GeometryCollection }>;
  const land = feature(topo, topo.objects.land);
  ctx.beginPath();
  path(land);
  ctx.fillStyle = pal.land;
  ctx.fill();
  ctx.strokeStyle = pal.coast;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.beginPath();
  path(mesh(topo, topo.objects.countries, (a, b) => a !== b));
  ctx.strokeStyle = pal.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  return canvas;
}
