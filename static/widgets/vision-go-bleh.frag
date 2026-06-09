#version 300 es
precision highp float;

/*
This shader is responsible for inducing the waterfall illusion
see https://en.wikipedia.org/wiki/Motion_aftereffect

you can also get some based peripheral drifting if you play your colors right



idk abt licensing, but pls be chill about it

credit me when you feel it is necessary
your heart will know
groove on :)
*/

#define PI 3.14159265358979
#define TAU (2.*PI)

uniform vec2 resolution;
uniform float u_Time;

uniform float u_patternSpeed;
uniform float u_patternPhase;
uniform vec2 u_patternPeriod;

uniform float u_colorSplit;

uniform float [5]u_transforms;
uniform float u_directionSwapPhase; // phaseP[0]
uniform vec2 u_directionSwapPeriod; // phaseP[1,2]

uniform vec2 u_mirror;
uniform vec2 u_flip;
uniform vec2 u_center;
uniform float u_rotation;

uniform float u_lineWidth;
uniform float u_lineBlur;
uniform float u_coordOverlay;

#define rgb(r,g,b) (vec3(r,g,b)/255.)

vec2 cmul(vec2 a, vec2 b)
{
    return vec2(
        a.x*b.x - a.y*b.y,
        a.x*b.y + a.y*b.x
    );
}

vec2 cdiv(vec2 a, vec2 b)
{
    float d = dot(b,b);
    return vec2(
        (a.x*b.x + a.y*b.y)/d,
        (a.y*b.x - a.x*b.y)/d
    );
}

vec2 mobius(vec2 z, vec2 a, vec2 b, vec2 c, vec2 d)
{
    return cdiv(
        cmul(a,z) + b,
        cmul(c,z) + d
    );
}

// not so sure about these ones
vec2 cayleyMap(vec2 z)
{
    return mobius(
        z,
        vec2(1,0),   // a
        vec2(0,-1),  // b = -i
        vec2(1,0),   // c
        vec2(0, 1)   // d = i
    );
}
vec2 hyperbolicMap(vec2 p)
{
    float d1 = length(p - vec2(0.0, 1.0));
    float d2 = length(p - vec2(0.0,-1.0));

    float u = acosh(0.5 * (d1 + d2));
    float v = acos(clamp(0.5 * (d2 - d1), -1.0, 1.0));

    return vec2(u, v);
}


// these are good tho

// https://en.wikipedia.org/wiki/Parabolic_coordinates#Two-dimensional_parabolic_coordinates
vec2 parabolicMap(vec2 p)
{
    float r = length(p);
    return vec2(
        sqrt(max(r - p.y, 0.0)),
        sign(p.x) * sqrt(max(r + p.y, 0.0))
    );
}
// this is its own inverse
// Z = 1/(x+yi)
// 1/Z = x+yi
vec2 complexInverseMap(vec2 p) {
    float d = dot(p,p);
    if (d < 1e-8) return vec2(0.0);
    return vec2(p.x,-p.y)/d;
}

vec2 polarMap(vec2 p) {
	return vec2(length(p), atan(p.y,p.x)/TAU);
}
vec2 inversePolarMap(vec2 p) {
    float theta = p[1] * TAU;
    float r = p[0];
    return vec2(cos(theta),sin(theta))*r;
}

// https://en.wikipedia.org/wiki/Log-polar_coordinates#Definition_and_coordinate_transformations
vec2 logPolarMap(vec2 p) {
	return vec2(log(length(p)), atan(p.y,p.x)/TAU);
}
vec2 inverseLogPolarMap(vec2 p) {
    float theta = p[1] * TAU;
    float r = p[0];
    r = exp(r);
    return vec2(cos(theta),sin(theta))*r;
}

vec2 squareMap(vec2 z)
{
    // (x+yi)^2
    // x^2 - y^2 + 2xyi
    return vec2(
        z.x*z.x - z.y*z.y,
        2.0*z.x*z.y
    );
}

// from https://www.geeksforgeeks.org/maths/square-root-of-complex-numbers/
vec2 sqrtMap(vec2 z) {
    // algebraic form
    float a = z.x;
    float b = z.y;
    return vec2(
        sqrt((a+length(z))/2.),
        sign(b) * sqrt((length(z)-a)/2.)
    );

    // polar form
    // float r = sqrt(length(z));
    // float t = atan(z.y, z.x) * 0.5;
    // return r * vec2(cos(t), sin(t));
}

// credit to @krisselden for this one
// https://fragcoord.xyz/s/b4wyoqv5
vec2 bipolarMap(vec2 p) {
    // p *= 3.;
    float p_length_squared = dot(p, p);
    float tau = atanh(2.0 * p.x / (p_length_squared + 1.))/TAU;
    float sigma = atan(2.0 * p.y, p_length_squared - 1.);
    return vec2(tau,sigma);
}

vec2 coordMap(vec2 p) {
    for (int i=0; i<u_transforms.length(); i++) {
        int idx = int(u_transforms[i]);
        // if (idx==0) return p;
        switch (idx) {
        case 0: break;
        case 1:
            p = polarMap(p);
            break;
        case 2:
            p = inversePolarMap(p);
            break;
        case 3:
            p = logPolarMap(p);
            break;
        case 4:
            p = inverseLogPolarMap(p);
            break;
        case 5:
            // 1/p
            p = complexInverseMap(p);
            break;
        case 6:
            // p^2
            p = squareMap(p);
            break;
        case 7:
            p = sqrtMap(p);
            break;
        case 8:
            p = parabolicMap(p);
            break;
        case 9:
            p = bipolarMap(p);
            break;
        case 10:
            p.xy = sqrt(abs(p.xy));
        }
    }
    return p;
}

float sum(vec2 p){return p.x+p.y;}

in vec2 uv;

out vec4 fragColor;

vec2 mirrorTile2x2(vec2 uv)
{
    uv *= 2.0;

    vec2 tile = floor(uv);
    vec2 p    = fract(uv);

    if (mod(tile.x, 2.0) > 0.5) p.x = 1.0 - p.x;
    if (mod(tile.y, 2.0) > 0.5) p.y = 1.0 - p.y;

    return p;
}

void main()
{
	// vec4 color = vec4(1.0);

	// vec2 res = uTD2DInfos[0].res.xy;
	vec2 center = vec2(.5);
    // center = vec2(0.);
    center = u_center;
	// center = vec2(.45,.91);

    vec2 p = uv;
    p = mix(p, mirrorTile2x2(p), u_mirror.xy);
    if (u_flip.x>.5) p.x = 1.-p.x;
    if (u_flip.y>.5) p.y = 1.-p.y;

	p = p-center;

    p.yx *= u_mirror.xy+1.;
	p.x *= resolution.x/resolution.y;

    float theta = u_rotation*TAU;
    p *= mat2(
        cos(theta),-sin(theta),
        sin(theta),cos(theta)
    );

	// vec2 q = vec2((length(p)), atan(p.y,p.x)/3.14/2.);
	vec2 q = coordMap(p*2.);

	// float blur = 0.5;
	// float m = 0.;
    float m = -u_lineWidth; // invert so it makes more sense
    float blur = u_lineBlur;
#if 0
	// vec4 color = texture(sTD2DInputs[0], uv.st);
    vec4 color = vec4(sin(uv.x*TAU+sin(uv.y*2.*TAU)));
    // texture overlay stuff has been stripped for the web version
	vec3 targetC = rgb(138, 107, 119);
	float phaseDir;// = ((length(color.rgb-targetC))>0.5) ? 1. : -.5;
	float phasePeriod = length(color.rgb-targetC)*colorP[2];
	phasePeriod += q.x;
	phaseDir = sign(sin((PERIOD(phaseP)[0]*phasePeriod+PHASE(phaseP))*3.14*2.));
	// float phaseDir = length(color.rgb-targetC);
	float phase = phaseDir*PHASE(lineP);
	color.rgb = smoothstep(m-blur,m+blur,sin((vec3(0.,1.,2.)/3.*colorP[1]+color.rgr*colorP[0]+phase+sum(q.xy*PERIOD(lineP).xy))*3.14*2.));
	// fragColor = TDOutputSwizzle(color);
    fragColor = vec4(color);
#else
    float phaseDirection = sign(sin(sum(TAU*(polarMap(p.xy)*u_directionSwapPeriod + u_directionSwapPhase))));
	float phase = u_patternPhase + u_Time*u_patternSpeed*phaseDirection;
	vec3 color = smoothstep(m-blur,m+blur,sin((vec3(0.,1.,2.)/3.*u_colorSplit+phase+sum(q.xy*(u_patternPeriod)))*3.14*2.));

    color.rg = mix(color.rg, fract(q.xy), u_coordOverlay);

    fragColor = vec4(color,1.);
#endif
}
