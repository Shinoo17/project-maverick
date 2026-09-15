// Shared GLSL for the training range. Everything is evaluated from world position so the
// ground and cloud patterns stay put while their carrier meshes follow the camera.
const noise = /* glsl */ `
float rangeHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float rangeNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(rangeHash(i), rangeHash(i + vec2(1, 0)), u.x), mix(rangeHash(i + vec2(0, 1)), rangeHash(i + vec2(1, 1)), u.x), u.y);
}
float rangeFbm(vec2 p, int octaves) {
  float v = 0., a = .5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    v += a * rangeNoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= .5;
  }
  return v;
}
vec3 rangeSrgb(vec3 c) { return pow(c, vec3(2.2)); }
`

/*
The dome is drawn behind everything without touching depth, so sky pixels keep depth 1 and
scene.background stays a Color — the condensation composite relies on both. It therefore
bypasses the renderer's tone mapping and applies the same ACES curve itself: the colour it
writes is identical whether it lands on screen directly or passes through the vapor target.
*/
export const skyVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const skyFragment = /* glsl */ `
uniform vec3 zenith, horizon, sunColor, sunDirection;
varying vec3 vWorld;
${noise}
vec3 rangeAces(vec3 color) {
  const mat3 inputMat = mat3(vec3(.59719, .07600, .02840), vec3(.35458, .90834, .13383), vec3(.04823, .01566, .83777));
  const mat3 outputMat = mat3(vec3(1.60475, -.10208, -.00327), vec3(-.53108, 1.10813, -.07276), vec3(-.07367, -.00605, 1.07602));
  color = inputMat * (color / .6);
  vec3 a = color * (color + .0245786) - .000090537, b = color * (.983729 * color + .4329510) + .238081;
  return clamp(outputMat * (a / b), 0., 1.);
}
// Scattered fair-weather cumulus on a flat deck, so they parallax as the aircraft moves.
vec4 cloudDeck(vec3 dir, float base, float scale, float cover) {
  if (dir.y < .012 || cameraPosition.y > base - 60.) return vec4(0);
  float t = (base - cameraPosition.y) / dir.y;
  vec2 p = (cameraPosition.xz + dir.xz * t) / scale;
  // Far away a pixel spans many cells; drop octaves there instead of shimmering.
  int octaves = t > 16000. ? 3 : t > 7000. ? 4 : 5;
  float d = rangeFbm(p + vec2(31.7, -12.3), octaves) - cover;
  float alpha = smoothstep(.01, .17, d) * .92;
  if (alpha <= 0.) return vec4(0);
  float lit = clamp(.55 + (d - (rangeFbm(p + sunDirection.xz * .09 + vec2(31.7, -12.3), octaves) - cover)) * 5., 0., 1.);
  vec3 color = mix(rangeSrgb(vec3(.63, .68, .75)), rangeSrgb(vec3(1.)) * 1.25, lit);
  float haze = 1. - exp(-t / 17000.);
  color = mix(color, horizon, haze);
  alpha *= (1. - haze * .85) * (1. - smoothstep(base - 700., base - 60., cameraPosition.y));
  return vec4(color, alpha);
}
void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  float e = dir.y;
  float mu = max(dot(dir, sunDirection), 0.);
  vec3 sky = mix(horizon, zenith, pow(max(e, 0.), .5));
  sky = mix(sky, horizon * vec3(1.04, 1.01, .96), pow(mu, 3.) * .25 * (1. - max(e, 0.)));
  // Two faint ranges beyond the fog line, keyed to azimuth so they wrap without a seam.
  vec2 ring = normalize(dir.xz + 1e-5);
  float far = .012 + .028 * rangeFbm(ring * 3.1 + 8., 4);
  float near = .004 + .02 * rangeFbm(ring * 6.3 - 3., 4);
  if (e < far) sky = mix(sky, mix(horizon, zenith, .28) * .92, .55 * smoothstep(-.012, .01, e));
  if (e < near) sky = mix(sky, mix(horizon, rangeSrgb(vec3(.45, .53, .56)), .55), .7 * smoothstep(-.012, .008, e));
  vec4 cirrus = vec4(0);
  if (e > .02) {
    float t = 9000. / e;
    vec2 p = (cameraPosition.xz + dir.xz * t) * vec2(1. / 4800., 1. / 1900.);
    float streak = smoothstep(.56, .9, rangeFbm(p + 4., 4)) * .16 * exp(-t / 40000.);
    cirrus = vec4(rangeSrgb(vec3(.97)), streak);
  }
  sky = mix(sky, cirrus.rgb, cirrus.a);
  vec4 cumulus = cloudDeck(dir, 3000., 1500., .6);
  sky = mix(sky, cumulus.rgb, cumulus.a);
  sky += sunColor * (pow(mu, 700.) * 1.4 + pow(mu, 60.) * .16 + smoothstep(.99985, .99993, mu) * 12.) * (1. - cumulus.a * .9);
  gl_FragColor = vec4(rangeAces(sky), 1.);
  #include <colorspace_fragment>
}
`

export const groundVertexPars = /* glsl */ `varying vec3 vRangeWorld;\n`
export const groundVertex = /* glsl */ `#include <project_vertex>\nvRangeWorld = (modelMatrix * vec4(transformed, 1.)).xyz;\n`

// Patchwork farmland, forest, a river and roads around the runway, with the survey grid kept
// as the distance cue. Fine detail fades by metres-per-pixel so the far field does not crawl.
export const groundFragmentPars = /* glsl */ `
varying vec3 vRangeWorld;
uniform float rangeRadius;
${noise}
float rangeFill(float d, float fw) { return 1. - smoothstep(-fw, fw, d); }
float rangeBox(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return max(d.x, d.y); }
vec3 rangeField(vec2 p, float fw) {
  const float angle = .21;
  vec2 q = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * p;
  vec2 size = vec2(430., 270.);
  float row = floor(q.y / size.y);
  q.x += rangeHash(vec2(row, 7.)) * size.x;
  vec2 cell = floor(q / size), local = (fract(q / size) - .5) * size;
  // Some plots are split along their long side, so field sizes do not read as a checkerboard.
  if (rangeHash(cell + 41.) > .55) {
    float side = sign(local.x + 1e-3);
    cell += vec2(side * .25, 0.); local.x -= side * size.x * .25; size.x *= .5;
  }
  float h = rangeHash(cell);
  vec3 color = h < .26 ? vec3(.45, .53, .30) : h < .44 ? vec3(.37, .46, .27) : h < .58 ? vec3(.51, .54, .34)
    : h < .67 ? vec3(.63, .59, .43) : h < .78 ? vec3(.49, .43, .33) : h < .92 ? vec3(.54, .59, .38) : vec3(.42, .50, .31);
  color = rangeSrgb(color) * .92;
  float detail = 1. - smoothstep(2., 9., fw);
  // Crop rows run along each field's long side.
  float rows = sin((h > .5 ? local.x : local.y) * 1.6) * .5 + .5;
  color *= 1. + (rows - .5) * .08 * detail;
  color *= .9 + .2 * rangeFbm(p / 70., 3);
  // Hedgerows between fields.
  vec2 edge = size * .5 - abs(local);
  float hedge = rangeFill(min(edge.x, edge.y) - 3.5, fw) * (1. - smoothstep(6., 22., fw));
  return mix(color, rangeSrgb(vec3(.33, .40, .24)), hedge * .75);
}
vec3 rangeGround(vec2 p) {
  float fw = max(length(fwidth(p)), .001);
  vec3 color = rangeField(p, fw);
  // Broad tonal drift keeps the patchwork from reading as a repeated tile.
  float drift = rangeFbm(p / 2600., 3);
  color *= mix(vec3(.92, .95, .9), vec3(1.07, 1.02, .95), drift);
  vec2 runway = vec2(600., 0.);
  float nearBase = rangeBox(p, runway, vec2(900., 320.));
  float forest = smoothstep(.6, .66, rangeFbm(p / 1500. + 17., 4)) * smoothstep(80., 400., nearBase);
  vec3 trees = rangeSrgb(vec3(.24, .33, .20)) * (.8 + .35 * rangeFbm(p / 18., 3) * (1. - smoothstep(1., 6., fw)) + .1 * rangeNoise(p / 90.));
  color = mix(color, trees, forest);
  float roadA = abs(p.x - (720. + 260. * sin(p.y / 1900.))) - 4.;
  float roadB = abs(p.y - (2600. + 180. * sin(p.x / 2300.))) - 4.;
  float road = rangeFill(min(roadA, roadB), fw) * step(150., p.y) * (1. - smoothstep(10., 30., fw));
  color = mix(color, rangeSrgb(vec3(.62, .61, .56)), road * .85);
  float riverZ = -2300. + 850. * sin(p.x / 2600. + .7) + 840. * (rangeNoise(vec2(p.x / 3200., 3.)) - .5);
  float river = abs(p.y - riverZ) * .82, width = 36. + 16. * rangeNoise(vec2(p.x / 900., 9.));
  float banks = 1. - smoothstep(width, width + 70. + 60. * rangeNoise(p / 60.), river);
  color = mix(color, rangeSrgb(vec3(.27, .37, .22)), banks * .8);
  color = mix(color, rangeSrgb(vec3(.64, .60, .46)), rangeFill(river - width - 7., fw));
  color = mix(color, mix(rangeSrgb(vec3(.24, .37, .43)), rangeSrgb(vec3(.36, .50, .55)), rangeNoise(p / 40.)), rangeFill(river - width, fw));
  // Airfield: apron, taxiways, shoulder, runway and markings.
  float concrete = min(min(rangeBox(p, vec2(550., 112.), vec2(320., 45.)), rangeBox(p, vec2(350., 55.), vec2(10., 25.))), rangeBox(p, vec2(750., 55.), vec2(10., 25.)));
  concrete = min(concrete, rangeBox(p, runway, vec2(760., 46.)));
  color = mix(color, rangeSrgb(vec3(.58, .58, .55)), rangeFill(concrete, fw));
  vec3 asphalt = rangeSrgb(vec3(.25, .27, .27)) * (.92 + .12 * rangeNoise(p / 3.) * (1. - smoothstep(.5, 3., fw)));
  color = mix(color, asphalt, rangeFill(rangeBox(p, runway, vec2(700., 32.5)), fw));
  float marks = rangeBox(p, runway, vec2(697., 30.5));
  marks = max(marks, -rangeBox(p, runway, vec2(695., 28.5)));
  float dash = abs(mod(p.x + 35., 70.) - 35.) - 17.5;
  marks = min(marks, max(max(dash, abs(p.y) - .9), max(-p.x - 17.5, p.x - 1207.5)));
  float keys = max(abs(mod(p.y, 3.6) - 1.8) - .9, abs(p.y) - 26.);
  keys = max(keys, 2.4 - abs(p.y));
  marks = min(marks, max(keys, min(abs(p.x + 75.) - 15., abs(p.x - 1275.) - 15.)));
  float touchdown = max(abs(abs(p.y) - 9.5) - 1.6, min(abs(p.x - 95.) - 15., abs(p.x - 1105.) - 15.));
  marks = min(marks, touchdown);
  color = mix(color, rangeSrgb(vec3(.9, .89, .84)), rangeFill(marks, fw) * (1. - smoothstep(1.5, 6., fw)));
  float radius = length(p);
  // Survey grid: 100 m and 1 km lines inside the range, one pixel wide at any distance.
  vec2 minor = abs(fract(p / 100. - .5) - .5) * 100. / max(fwidth(p), vec2(.001));
  vec2 major = abs(fract(p / 1000. - .5) - .5) * 1000. / max(fwidth(p), vec2(.001));
  float inside = 1. - step(rangeRadius, radius);
  float grid = (1. - min(min(minor.x, minor.y), 1.)) * .06 * (1. - smoothstep(3., 16., fw));
  grid = max(grid, (1. - min(min(major.x, major.y) * .7, 1.)) * .15 * (1. - smoothstep(12., 60., fw)));
  color = mix(color, rangeSrgb(vec3(.93, .93, .86)), grid * inside);
  // Range edge: a warm boundary line, with the country beyond it slightly muted.
  color = mix(color, color * vec3(.86, .85, .88), smoothstep(rangeRadius, rangeRadius + 200., radius));
  float boundary = rangeFill(abs(radius - rangeRadius) - 12., fw) * step(.35, fract(atan(p.y, p.x) * 180. / 3.14159265));
  color = mix(color, rangeSrgb(vec3(.78, .42, .26)), boundary * .7);
  return color;
}
`
