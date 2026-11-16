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
  ocean: '#E3E7F0',
  land: '#FBFAF7',
  border: '#D9DCE6',
  coast: '#A9B0C6',
  graticule: 'rgba(20, 39, 94, 0.10)',
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

/**
 * Coastlines and borders as [lon, lat] polylines (degrees), drawn as 3D lines on the globe so
 * they stay sharp at any zoom; the canvas texture only supplies the fill.
 */
export function earthOutlines(): { coast: number[][][]; borders: number[][][] } {
  const topo = world as unknown as Topology<{ countries: GeometryCollection; land: GeometryCollection }>;
  const coast = mesh(topo, topo.objects.land).coordinates as number[][][];
  const borders = mesh(topo, topo.objects.countries, (a, b) => a !== b).coordinates as number[][][];
  return { coast, borders };
}
