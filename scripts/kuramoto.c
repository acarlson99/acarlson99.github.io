// kuramoto model coupled oscillators represented with sound
// based on https://qri.org/blog/cessation-simulations#coupling-kernels spec.

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define SAMPLE_RATE		 44100
#define DURATION_SECONDS (67)

#define BIG_N 32

#define PI 3.14159265358979323846f

typedef struct {
	// [0..1] range, multiplied by 2PI at the very end
	double phase;
	double freq;
} Oscillator;

typedef struct {
	float radius; // as measured by manhattan distance
	float thickness;
	float strength;
} CouplingRing;

static double randf(double a, double b)
{
	return a + (b - a) * ((double)rand() / (double)RAND_MAX);
}

static void write_wav_header(FILE *f, int sampleRate, int numSamples)
{
	int16_t numChannels = 1;
	int16_t bitsPerSample = 16;

	int byteRate = sampleRate * numChannels * bitsPerSample / 8;
	int blockAlign = numChannels * bitsPerSample / 8;

	int dataSize = numSamples * numChannels * bitsPerSample / 8;
	int chunkSize = 36 + dataSize;

	fwrite("RIFF", 1, 4, f);
	fwrite(&chunkSize, 4, 1, f);
	fwrite("WAVE", 1, 4, f);

	fwrite("fmt ", 1, 4, f);

	int subchunk1Size = 16;
	int16_t audioFormat = 1;

	fwrite(&subchunk1Size, 4, 1, f);
	fwrite(&audioFormat, 2, 1, f);
	fwrite(&numChannels, 2, 1, f);
	fwrite(&sampleRate, 4, 1, f);
	fwrite(&byteRate, 4, 1, f);
	fwrite(&blockAlign, 2, 1, f);
	fwrite(&bitsPerSample, 2, 1, f);

	fwrite("data", 1, 4, f);
	fwrite(&dataSize, 4, 1, f);
}

void usage(char **argv)
{
	printf("usage: %s [N] [mode]\n0 < N < %d\nmode: one of [stwq] for "
		   "sin,tri,saw,square\n",
		   argv[0], BIG_N);
}

float ring_weight(float d, float radius, float thickness)
{
	float x = (d - radius) / thickness;
	return expf(-x * x);
}

int main(int argc, char **argv)
{
	srand(7);

	int N = BIG_N;
	if (argc > 1)
		N = atoi(argv[1]);
	char mode = 's'; // sin,tri,saw,square
	if (argc > 2)
		mode = argv[2][0];

	int badMode = !(mode == 's' || mode == 't' || mode == 'w' || mode == 'q');

	if (badMode || N < 1 || N > BIG_N) {
		usage(argv);
		return 1;
	}

	const int numSamples = SAMPLE_RATE * DURATION_SECONDS;
	const double dt = 1.0f / SAMPLE_RATE;

	FILE *f = fopen("kuramoto.wav", "wb");

	if (!f) {
		printf("failed to open file\n");
		return 1;
	}

	write_wav_header(f, SAMPLE_RATE, numSamples);

	Oscillator osc[N];
	double K[N][N];

	//--------------------------------------------------
	// Oscillators
	//--------------------------------------------------

	for (int i = 0; i < N; i++) {

		osc[i].phase = randf(0.0, 1.0);

		// osc[i].freq = randf(435.0f, 445.0f);
		// osc[i].freq = randf(439.0, 441.0);
		osc[i].freq = 440.0;

		printf("osc %2d  freq=%7.3f\n", i, osc[i].freq);
	}

	//--------------------------------------------------
	// Distance-based coupling
	//--------------------------------------------------

#if 0
	const double globalK = 200.0f * 10;
	const double falloff = 8.0f;

	for (int i = 0; i < N; i++) {
		for (int j = 0; j < N; j++) {
			if (i == j) {
				K[i][j] = 0.0f;
			} else {

				double d = fabs((double)(i - j));

				K[i][j] = globalK * expf(-d / falloff)
						  * (sin(i - j) < 0.0 ? -1.0 : 1.0)
						  * sin((i + j) / 4.0);

				// Optional tiny asymmetry
				K[i][j] *= randf(0.9f, 1.1f);
			}
		}
	}
#else
	CouplingRing rings[3] = {0};
	rings[0] = (CouplingRing){.radius = 1, .thickness = 1, .strength = 1};
	rings[1] = (CouplingRing){.radius = 4, .thickness = 3, .strength = 0};
	rings[2] = (CouplingRing){.radius = 8, .thickness = 3, .strength = 0};

    int w = floorl(sqrt((double)N))/2;
	int h = N/w;

	for (int i = 0; i < N; i++) {
		for (int j = 0; j < N; j++) {
			if (i == j) {
				K[i][j] = 0.0f;
			} else {
				// float d = fabs((double)(i - j));
                // d = fmin(d,N-d);

				// make this logic wrap vertically and horizontally
                int x1 = i % w;
                int y1 = i / w;

                int x2 = j % w;
                int y2 = j / w;

                // d = sqrt(pow(x2-x1,2.0) + pow(y2-y1,2.0)); // length (no wrapping)

				// manhattan distance
				int dx = abs(x2 - x1);
				int dy = abs(y2 - y1);
				dx = (dx > w/2) ? (w - dx) : dx;
				dy = (dy > h/2) ? (h - dy) : dy;
				float d = (float)(dx + dy);
				// TODO: this distance runs into mad rounding errors-- should be reworked

				float k = 0.0f;

				for (int r = 0; r < 3; r++) {
					k += rings[r].strength
						 * ring_weight(d, rings[r].radius, rings[r].thickness);
				}

				K[i][j] = k; // TODO: convert from 1D to 2D pairings
			}
		}
	}
#endif

	printf("\nCoupling matrix:\n");
	for (int i = 0; i < N; i++) {
		for (int j = 0; j < N; j++) {
			printf("%7.2f ", K[i][j]);
		}
		printf("\n");
	}

	//--------------------------------------------------
	// Main synthesis loop
	//--------------------------------------------------

	for (int sample = 0; sample < numSamples; sample++) {
		if (sample % (SAMPLE_RATE*10) == 0) printf("processing sample %d / %d : %f%%\n", sample, numSamples, 100*((float)sample)/((float)numSamples));
		double phaseDelta[N];

		//----------------------------------------------
		// Kuramoto update
		//----------------------------------------------

		for (int i = 0; i < N; i++) {
			double dtheta = osc[i].freq;
			double coupling = 0.0f;
			for (int j = 0; j < N; j++) {
				coupling += K[i][j] * sinf(osc[j].phase - osc[i].phase);
			}

			dtheta += coupling / (double)N;

			phaseDelta[i] = dtheta;
		}

		//----------------------------------------------
		// Integrate
		//----------------------------------------------

		for (int i = 0; i < N; i++) {

			osc[i].phase += phaseDelta[i] * dt;

			if (osc[i].phase > 1.0)
				osc[i].phase = fmodf(osc[i].phase, 1.0);
		}

		//----------------------------------------------
		// Audio output
		//----------------------------------------------

		double out = 0.0f;

		for (int i = 0; i < N; i++) {
			float phase = osc[i].phase * PI * 2.0;
			float pn = fmod(osc[i].phase, 1.0);

			float v = 0.0;
			switch (mode) {
			// sin,tri,saw,square
			case 's': // sin
				v = sinf(phase);
				break;
			case 't': // tri
				v = 1.0 - 4.0 * fabs(pn - 0.5);
				break;
			case 'w': // saw
				v = pn * 2.0 - 1.0;
				break;
			case 'q': // square
				v = (pn < 0.5) ? 1.0 : -1.0;
				break;
			}
			out += v;
		}

		out /= (double)N;

		//----------------------------------------------
		// Saturation
		//----------------------------------------------

		out = tanhf(out * 3.0f);

		int16_t s = (int16_t)(INT16_MAX * out);

		fwrite(&s, sizeof(int16_t), 1, f);
	}

	fclose(f);

	printf("\nwrote kuramoto.wav\n");

	return 0;
}
