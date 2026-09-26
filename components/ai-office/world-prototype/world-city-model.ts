/** Original fictional metropolitan district. Coordinates are metres relative to floor 50. */
export type CityBox = {
  position: [number, number, number];
  size: [number, number, number];
  shade: number;
  style: number;
};
export const STREET_Y = -200;
export const CITY_BLOCK = 66;
export function cityRandom(x: number, z: number, salt = 0) {
  const v = Math.sin(x * 127.1 + z * 311.7 + salt * 73.3) * 43758.5453;
  return v - Math.floor(v);
}
export function cityBuildings(detailed: boolean): {
  facades: CityBox[];
  roofs: CityBox[];
  crowns: CityBox[];
} {
  const facades: CityBox[] = [],
    roofs: CityBox[] = [],
    crowns: CityBox[] = [];
  for (let gx = -13; gx <= 13; gx++)
    for (let gz = -13; gz <= 13; gz++) {
      if (gx === 0 && gz === 0) continue;
      const r = Math.hypot(gx, gz),
        seed = cityRandom(gx, gz);
      if (r > 14 || (!detailed && r > 6 && seed < 0.52) || seed < 0.035)
        continue;
      const x = gx * CITY_BLOCK + (cityRandom(gx, gz, 1) - 0.5) * 10,
        z = gz * CITY_BLOCK + (cityRandom(gx, gz, 2) - 0.5) * 10;
      let height = r < 2.4 ? 65 + seed * 80 : 45 + Math.pow(seed, 1.5) * 205;
      if (
        (gx === -3 && gz === -4) ||
        (gx === 4 && gz === -5) ||
        (gx === -4 && gz === 3)
      )
        height = 305 + seed * 50;
      const w = 20 + cityRandom(gx, gz, 3) * 20,
        d = 20 + cityRandom(gx, gz, 4) * 22,
        style = Math.floor(cityRandom(gx, gz, 5) * 3),
        shade = 0.72 + cityRandom(gx, gz, 6) * 0.28;
      const tiers = seed > 0.64 ? 3 : seed > 0.29 ? 2 : 1;
      let y = STREET_Y;
      for (let tier = 0; tier < tiers; tier++) {
        const h =
            height *
            (tiers === 1 ? 1 : tier === 0 ? 0.67 : tiers === 2 ? 0.33 : 0.165),
          scale = 1 - tier * 0.15;
        facades.push({
          position: [x, y + h / 2, z],
          size: [w * scale, h, d * scale],
          shade,
          style,
        });
        roofs.push({
          position: [x, y + h + 0.22, z],
          size: [w * scale + 0.5, 0.45, d * scale + 0.5],
          shade: 0.75,
          style,
        });
        y += h;
      }
      if (detailed || r < 5) {
        crowns.push({
          position: [x - w * 0.12, y + 1.8, z + d * 0.1],
          size: [w * 0.24, 3.6, d * 0.3],
          shade: 0.7,
          style: 0,
        });
        crowns.push({
          position: [x + w * 0.18, y + 0.6, z - d * 0.17],
          size: [w * 0.21, 1.2, d * 0.21],
          shade: 0.55,
          style: 0,
        });
        if (height > 260)
          crowns.push({
            position: [x, y + 13, z],
            size: [0.65, 26, 0.65],
            shade: 0.9,
            style: 0,
          });
      }
    }
  return { facades, roofs, crowns };
}
