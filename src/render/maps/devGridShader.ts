// GLSL for the dev-grid placeholder maps (DevGridMap.tsx). Like the training range, the pattern
// is evaluated from world position, so it stays put while the ground plane follows the camera.
export const devGridVertexPars = /* glsl */ `varying vec3 vDevWorld;\n`
export const devGridVertex = /* glsl */ `#include <project_vertex>\nvDevWorld = (modelMatrix * vec4(transformed, 1.)).xyz;\n`

// A flat "relief map": smooth noise stands in for height and picks one of four colour bands
// (low, mid, high, peak). Over it, a checker of 500 m cells, 100 m and 1 km grid lines one
// pixel wide at any distance, and the red range boundary.
export const devGridFragmentPars = /* glsl */ `
varying vec3 vDevWorld;
uniform float devRadius, devScale;
uniform vec3 devLow, devMid, devHigh, devPeak, devLine, devLevels;
float devHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float devNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(devHash(i), devHash(i + vec2(1, 0)), u.x), mix(devHash(i + vec2(0, 1)), devHash(i + vec2(1, 1)), u.x), u.y);
}
float devHeight(vec2 p) {
  float v = 0., a = .5;
  for (int i = 0; i < 4; i++) { v += a * devNoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= .5; }
  return v / .9375;
}
vec3 devGround(vec2 p) {
  vec2 fwp = max(fwidth(p), vec2(.001));
  float fw = length(fwp);
  float h = devHeight(p / devScale + 17.);
  // Hard band edges, softened by one pixel so they do not crawl.
  float soft = clamp(fw / devScale * 3., .002, .05);
  vec3 color = mix(devLow, devMid, smoothstep(devLevels.x - soft, devLevels.x + soft, h));
  color = mix(color, devHigh, smoothstep(devLevels.y - soft, devLevels.y + soft, h));
  color = mix(color, devPeak, smoothstep(devLevels.z - soft, devLevels.z + soft, h));
  // 500 m checker, fading out where a cell is only a few pixels.
  vec2 cell = floor(p / 500.);
  float checker = mod(cell.x + cell.y, 2.);
  color *= mix(1., .88 + .12 * checker, 1. - smoothstep(40., 160., fw));
  vec2 minor = abs(fract(p / 100. - .5) - .5) * 100. / fwp;
  vec2 major = abs(fract(p / 1000. - .5) - .5) * 1000. / fwp;
  float grid = (1. - min(min(minor.x, minor.y), 1.)) * .35 * (1. - smoothstep(3., 16., fw));
  grid = max(grid, (1. - min(min(major.x, major.y) * .6, 1.)) * .6 * (1. - smoothstep(14., 70., fw)));
  float radius = length(p);
  color = mix(color, devLine, grid * (1. - step(devRadius, radius)));
  // Range edge: a dashed red line, the ground beyond it muted.
  color = mix(color, color * .7, smoothstep(devRadius, devRadius + 200., radius));
  float boundary = (1. - smoothstep(-fw, fw, abs(radius - devRadius) - 14.)) * step(.35, fract(atan(p.y, p.x) * 180. / 3.14159265));
  return mix(color, vec3(.75, .08, .05), boundary * .85);
}
`
