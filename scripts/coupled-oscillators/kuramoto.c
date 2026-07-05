// kuramoto model coupled oscillators represented with sound
// based on https://qri.org/blog/cessation-simulations#coupling-kernels spec.

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define PI 3.14159265358979323846f

#include "kuramoto.h"
#include "util.h"

static inline double wrapPhase(double x)
{
	while (x > 0.5)
		x -= 1.0;
	while (x < -0.5)
		x += 1.0;
	return x;
}

double osc_value(const Synthesizer *synth, float x)
{
	double phase = x * 2.0 * PI;
	double pn = fmod(x, 1.0);

	switch (synth->waveType) {
	case 's':
		return sin(phase);
	case 't':
		return 1.0 - 4.0 * fabs(pn - 0.5);
	case 'w':
		return 2.0 * pn - 1.0;
	case 'q':
		return (pn < 0.5) ? 1.0 : -1.0;
	default:
		return sin(phase);
	}
}

// aggregate oscillator states into single waveform
double synth_audio_output(Synthesizer *synth)
{
	int N = synth->N;
	int w = synth->w;

	switch (synth->mixMode) {
		//----------------------------------------------------------
		// Traditional additive synthesis
		//----------------------------------------------------------

	case MIX_SUM: {
		double out = 0.0;

		for (int i = 0; i < N; i++) {
			double amp = synth->osc[i].amp;

			out += amp * osc_value(synth, synth->osc[i].phase);
		}

		return out / N;
	}

		//----------------------------------------------------------
		// Kuramoto Order Parameter
		//----------------------------------------------------------

	case MIX_ORDER_PARAMETER: {
		double re = 0.0;
		double im = 0.0;

		for (int i = 0; i < N; i++) {
			double p = synth->osc[i].phase * 2.0 * PI;
			re += cos(p);
			im += sin(p);
		}

		re /= N;
		im /= N;

		double R = hypot(re, im);
		double psi = atan2(im, re);

		return R * osc_value(synth, psi / PI / 2.0 + 0.5);
	}

		//----------------------------------------------------------
		// Total Coupling Energy
		//----------------------------------------------------------

	case MIX_COUPLING_ENERGY: {
		double out = 0.0;

		for (int i = 0; i < N; i++) {
			for (int j = 0; j < N; j++) {
				double d = (synth->osc[j].phase - synth->osc[i].phase);

				out += synth->K[i][j] * osc_value(synth, d);
			}
		}

		return out / (N * N);
	}

		//----------------------------------------------------------
		// Spatial disagreement (graph Laplacian)
		//----------------------------------------------------------

	case MIX_LAPLACIAN: {
		double out = 0.0;

		for (int y = 1; y < synth->h - 1; y++) {
			for (int x = 1; x < synth->w - 1; x++) {
				int c = IDX(x, y);

				double energy = 0.0;

				energy += fabs(wrapPhase(synth->osc[IDX(x - 1, y)].phase
										 - synth->osc[c].phase));

				energy += fabs(wrapPhase(synth->osc[IDX(x + 1, y)].phase
										 - synth->osc[c].phase));

				energy += fabs(wrapPhase(synth->osc[IDX(x, y - 1)].phase
										 - synth->osc[c].phase));

				energy += fabs(wrapPhase(synth->osc[IDX(x, y + 1)].phase
										 - synth->osc[c].phase));

				//--------------------------------------------------
				// Weight the oscillator's waveform by how
				// "unsynchronized" it is with its neighbors.
				//--------------------------------------------------

				double phase = synth->osc[c].phase;

				out += energy * osc_value(synth, phase);
			}
		}

		return out / N;
	}

		//----------------------------------------------------------
		// Derivative of the global order parameter
		//----------------------------------------------------------

	case MIX_ORDER_DERIVATIVE: {
		double re = 0.0;
		double im = 0.0;

		for (int i = 0; i < N; i++) {
			double p = synth->osc[i].phase * 2.0 * PI;
			re += cos(p);
			im += sin(p);
		}

		re /= N;
		im /= N;

		double R = hypot(re, im);

		double dR = R - synth->previousOrderParameter;

		synth->previousOrderParameter = R;

		// Gain boost because dR is usually tiny.
		return dR * 2.0;
	}
	}

	return 0.0;
}

// steps oscillators one step based on `dt`
// outputs a value [-1..1] representing the sound wave at that timestep
double step(Synthesizer *synth, float dt)
{
	int N = synth->N;
	Oscillator *osc = synth->osc;
	double(*K)[BIG_N] = synth->K;
	double phaseDelta[N];

	//----------------------------------------------
	// Kuramoto update
	//----------------------------------------------

	for (int i = 0; i < N; i++) {
		double dtheta = osc[i].freq;
		double coupling = 0.0;
		for (int j = 0; j < N; j++) {
			coupling += K[i][j] * sin((osc[j].phase - osc[i].phase) * PI * 2.0);
		}

		dtheta += coupling / (double)N;

		phaseDelta[i] = dtheta;
	}

	//----------------------------------------------
	// Integrate
	//----------------------------------------------

	for (int i = 0; i < N; i++) {

		osc[i].phase += phaseDelta[i] * dt;

		if (osc[i].phase < 0.0)
			osc[i].phase += 1.0;
		if (osc[i].phase > 1.0)
			osc[i].phase = fmod(osc[i].phase, 1.0);
	}

	//----------------------------------------------
	// Audio output
	//----------------------------------------------
	double out = synth_audio_output(synth);

	return out;
}

double synth_postprocess_sound(Synthesizer *s, double x)
{
	if (s->mute)
		return 0.0;
	return tanh(x * 3.0) * ((double)s->master_volume) / 100.0;
}

double synth_next_sample(void *userdata)
{
	Synthesizer *s = userdata;

	double x = step(s, 1.0 / SAMPLE_RATE);

	// new section
	if (s->_samp_next_i > sizeof(s->last_samples) / sizeof(*s->last_samples))
		s->_samp_next_i = 0;
	s->last_samples[s->_samp_next_i++] = x;

	return synth_postprocess_sound(s, x);
}

double distance(int i, int j, int w, int h)
{
	// float d = fabs((double)(i - j));
	// d = fmin(d,N-d);

	int x1 = COL(i);
	int y1 = ROW(i);

	int x2 = COL(j);
	int y2 = ROW(j);

	// d = sqrt(pow(x2-x1,2.0) + pow(y2-y1,2.0)); // length (no
	// wrapping)

	// manhattan distance
	int dx = abs(x2 - x1);
	int dy = abs(y2 - y1);
	dx = (dx > w / 2) ? (w - dx) : dx;
	dy = (dy > h / 2) ? (h - dy) : dy;
	float d = (float)(dx + dy);
	return d;
}

double ring_weight(CouplingRing ring, double dist)
{
	double x = fabs(dist - ring.radius);
	if (x > ring.thickness)
		return 0.0;

	return ring.strength * (1.0f - x / ring.thickness);
}

void populateCouplingMatrix(Synthesizer *synth)
{
	int N = synth->N;
	for (int i = 0; i < N; i++) {
		for (int j = 0; j < N; j++) {
			if (i == j) {
				synth->K[i][j] = 0.0;
			} else {

				float k = 0.0;

				double dist = distance(i, j, synth->w, synth->h);
				for (int r = 0; r < N_RINGS; r++) {
					k += ring_weight(synth->rings[r], dist);
				}

				synth->K[i][j] = k;
			}
		}
	}
}

void applyChanges(Synthesizer *synth) { populateCouplingMatrix(synth); }

void oscPhaseSet(Synthesizer *synth, double phase)
{
	Oscillator *osc = synth->osc;
	for (int i = 0; i < synth->N; i++) {
		osc[i].phase = phase;
	}
}
void oscPhaseRandomize(Synthesizer *synth)
{
	Oscillator *osc = synth->osc;
	for (int i = 0; i < synth->N; i++) {
		osc[i].phase = randf(0.0, 1.0);
	}
}
