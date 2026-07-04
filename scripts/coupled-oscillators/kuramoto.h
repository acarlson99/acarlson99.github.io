#pragma once

#define SAMPLE_RATE (44100 / 4)

#define BIG_N 64

typedef struct {
	// [0..1] range, multiplied by 2PI at the very end
	double phase;
	double freq;
	double amp;
} Oscillator;

typedef struct {
	float radius; // as measured by manhattan distance
	float thickness;
	float strength;
} CouplingRing;

typedef enum {
	MIX_SUM,
	MIX_ORDER_PARAMETER,
	MIX_COUPLING_ENERGY, // no good
	MIX_LAPLACIAN,		 // no good
	MIX_ORDER_DERIVATIVE,
} MixMode;

typedef struct {
	char waveType; // one of [stqw]
	Oscillator *osc;
	int N;

	int w;
	int h;

	double (*K)[BIG_N]; // size BIG_NxBIG_N
	CouplingRing *rings;

	int master_volume; // [0 .. 100]
	bool mute;

	char *outfile;

	double previousOrderParameter;
	MixMode mixMode;
} Synthesizer;

double step(Synthesizer *synth, float dt);
