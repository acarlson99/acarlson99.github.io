#define PI 3.141592653589

uniform vec2 u_mv;          // move morie
uniform float u_scroll;     // scroll pattern (accepts negative inputs)
uniform float u_width;      // [0 .. 1] width of lines
uniform float u_scale;      // scale pattern
uniform bool u_colInv0;     // invert colors of texture 0
uniform bool u_colInv1;     // invert colors of texture 1
uniform float u_ra;         // rotate pattern by radians
uniform float u_mode;       // 1 or 2
uniform bool u_timescroll;  // use time to scroll pattern
uniform float u_smoothness; // [0 .. 1] smooth lines

uniform float u_tPhase;
uniform float u_timeMod;

uniform float u_tmxa; // [0 .. 1] mix texture0 into texture1
uniform float u_tmxb; // [0 .. 1] mix texture1 into texture0

mat2 rot(float theta) {
  float s = sin(theta);
  float c = cos(theta);
  return mat2(c, -s, s, c);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float w = u_width;
  float sc = u_scale;
  vec2 mv = u_mv;
  float scroll = u_scroll * (u_timescroll ? iTime : 0.);
  float ra = u_ra;
  bool ci0 = u_colInv0;
  // ci0 = sin(iTime*u_scroll *2.*PI*u_timeMod + u_tPhase*2.*PI) < 0.;
  bool ci1 = u_colInv1;
  // w = 0.75;
  // sc = 10.;
  // mv = vec2(iTime);
  // mv = vec2(0.);
  // scroll = iTime;
  // ra = iTime;

  // Normalized pixel coordinates (from 0 to 1)
  vec2 uv0 = fragCoord / iResolution.xy;
  vec2 uv = (fragCoord - .5 * iResolution.xy) / iResolution.y;
  uv *= rot(ra * PI);

  float th = uv.x * sc * 2. * PI + mv.x * 2. * PI + scroll * 2. * PI;
  if (abs(u_mode - 2.) < .1)
    th = scroll * 2. * PI + length(uv * sc + mv) * 2. * PI;
  float s = sin(th) * .5 + .5;
  // TODO: make this a smoothstep using fwidth
  // float wav = step(w, s);
  float fw = fwidth(s) + u_smoothness;
  float wav = smoothstep(clamp(w - fw, 0., 1.), clamp(w, 0., 1.), s);

  // float wav = step(w, fract(uv*sc+mv+scroll).x);
  // if (abs(u_mode-2.) < .1) wav = step(w,fract(scroll + length(uv*sc+mv)));

  vec4 c0 = texture(iChannel0, uv0);
  if (ci0)
    c0.rgb = 1. - c0.rgb;
  vec4 c1 = texture(iChannel1, uv0);
  if (ci1)
    c1.rgb = 1. - c1.rgb;

  // c0 = mix(c0,c1, u_tmxa);
  // c1 = mix(c1,c0, u_tmxb);

  vec4 C = mix(mix(c0, c1, u_tmxa), mix(c1, c0, u_tmxb), wav);
  // vec4 C = mix(c0,c1, wav);

  // Output to screen
  fragColor = C;
}
