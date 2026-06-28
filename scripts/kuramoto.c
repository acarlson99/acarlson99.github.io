// kuramoto model coupled oscillators represented with sound
// based on https://qri.org/blog/cessation-simulations#coupling-kernels spec.

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>

#define SAMPLE_RATE		 44100
#define DURATION_SECONDS (20)

#define BITDEPTH 16

#define BIG_N 64
#define N_RINGS (3)

#define PI 3.14159265358979323846f
#define COL(I) ((I) % w)
#define ROW(I) ((I) / w)

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
	int16_t bitsPerSample = BITDEPTH;

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

char downcase(char c) {
	if (c >= 'A' && c <= 'Z') return c + 'a'-'A';
	return c;
}

void usage(char **argv)
{
	printf("usage: %s -n[N] -w[wave-type] -o[filename.wav]\n0 < N < %d\nwave: one of Sin,Tri,saW,sQuare\n",
		   argv[0], BIG_N);
}

double ring_weight(double d, double radius, double thickness)
{
#if 1
	double x = fabs(floor(d - radius));
	if (x > thickness)
		return 0.0f;

	return 1.0f - x / thickness;
#else
	double x = (d - radius) / thickness;
	return expf(-x * x);
#endif
}

// steps oscillators one step based on `dt`
// outputs a value [-1..1] representing the sound wave at that timestep
double step(Oscillator osc[BIG_N], double K[BIG_N][BIG_N], int N, float dt, char waveType) {
	double phaseDelta[N];

	//----------------------------------------------
	// Kuramoto update
	//----------------------------------------------

	for (int i = 0; i < N; i++) {
		double dtheta = osc[i].freq;
		double coupling = 0.0f;
		for (int j = 0; j < N; j++) {
			coupling += K[i][j] * sinf((osc[j].phase - osc[i].phase)*PI*2.0);
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
			osc[i].phase = fmod(osc[i].phase, 1.0);
	}

	//----------------------------------------------
	// Audio output
	//----------------------------------------------

	double out = 0.0f;

	for (int i = 0; i < N; i++) {
		float phase = osc[i].phase * PI * 2.0;
		float pn = fmod(osc[i].phase, 1.0);

		float v = 0.0;
		switch (waveType) {
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

	return out;
}

void populateCouplingMatrix(CouplingRing rings[], double K[BIG_N][BIG_N], int N, int w, int h) {
	for (int i = 0; i < N; i++) {
		for (int j = 0; j < N; j++) {
			if (i == j) {
				K[i][j] = 0.0f;
			} else {
				// float d = fabs((double)(i - j));
				// d = fmin(d,N-d);

				int x1 = ROW(i);
				int y1 = COL(i);

				int x2 = ROW(j);
				int y2 = COL(j);

				// d = sqrt(pow(x2-x1,2.0) + pow(y2-y1,2.0)); // length (no
				// wrapping)

				// manhattan distance
				int dx = abs(x2 - x1);
				int dy = abs(y2 - y1);
				dx = (dx > w / 2) ? (w - dx) : dx;
				dy = (dy > h / 2) ? (h - dy) : dy;
				float d = (float)(dx + dy);

				float k = 0.0f;

				for (int r = 0; r < N_RINGS; r++) {
					k += rings[r].strength
						* ring_weight(d, rings[r].radius, rings[r].thickness);
				}

				K[i][j] = k;
			}
		}
	}
}

char wavearg(char *s) {
	if (strcmp(s, "sin")==0) return 's';
	if (strcmp(s, "tri")==0) return 't';
	if (strcmp(s, "saw")==0) return 'w';
	if (strcmp(s, "square")==0) return 'q';
	return downcase(s[0]);
}

int main(int argc, char **argv)
{
	srand(7);

	int N = BIG_N;
	char waveType = 's'; // sin,tri,saw,square
	char *outfile = "kuramoto.wav";

	int opt;
	int duration = DURATION_SECONDS;

	while ((opt = getopt(argc, argv, "n:w:d:h")) != -1) {
		switch (opt) {

		case 'n':
			N = atoi(optarg);
			break;

		case 'w':
			waveType = downcase(optarg[0]);
			break;

		case 'd':
			duration = atoi(optarg);
			break;

		case 'o':
			outfile = optarg;
			break;

		case 'h':
			usage(argv);
			return 0;

		default:
			usage(argv);
			return 1;
		}
	}

	int badWaveType = !(waveType == 's' || waveType == 't' || waveType == 'w' || waveType == 'q');

	if (badWaveType || N < 1 || N > BIG_N) {
		usage(argv);
		return 1;
	}

	const int numSamples = SAMPLE_RATE * duration;
	const double dt = 1.0f / SAMPLE_RATE;

	FILE *f = fopen(outfile, "wb");

	if (!f) {
		printf("failed to open file\n");
		return 1;
	}

	write_wav_header(f, SAMPLE_RATE, numSamples);

	Oscillator osc[BIG_N];
	double K[BIG_N][BIG_N];

	int w = floorl(sqrt((double)N));
	int h = N / w;

	//--------------------------------------------------
	// Oscillators
	//--------------------------------------------------

	for (int i = 0; i < N; i++) {

		osc[i].phase = randf(0.0, 1.0);

		// osc[i].freq = randf(435.0f, 445.0f);
		// osc[i].freq = randf(439.0, 441.0);
		// osc[i].freq = (i+1) / N * 880.0;

		osc[i].freq = 110.0*(1.0 + 0*(COL(i)/((float)w))) * pow(2.0, (float)(ROW(i)));
		// osc[i].freq = 440.0+randf(-0.5,0.5);

		printf("osc %2d  freq=%7.3f\n", i, osc[i].freq);
	}

	//--------------------------------------------------
	// Distance-based coupling
	//--------------------------------------------------
	CouplingRing rings[N_RINGS] = {0};
	rings[0] = (CouplingRing){.radius = 1, .thickness = 1, .strength = 67};
	rings[1] = (CouplingRing){.radius = 2, .thickness = 2, .strength = 20};
	rings[2] = (CouplingRing){.radius = 3, .thickness = 1, .strength = -77};

//	rings[0] = (CouplingRing){.radius=0, .thickness=2, .strength=-90};

	populateCouplingMatrix(rings,  K, N,  w,  h);

	// print coupling of single oscillator
	int target = N / 3;
	for (int i = 0; i < N; i++) {
		int x = i % w;
		if (i > 0 && x == 0)
			printf("\n");
		if (i == target)
			printf("%7.2s", "XXXX");
		else
			printf("%7.2f ", K[target][i]);
	}
	printf("\n");

#if 0
	printf("\nCoupling matrix:\n");
	for (int i = 0; i < N; i++) {
		for (int j = 0; j < N; j++) {
			printf("%7.2f ", K[j][i]);
		}
		printf("\n");
	}
#endif

	//--------------------------------------------------
	// Main synthesis loop
	//--------------------------------------------------

	for (int sample = 0; sample < numSamples; sample++) {

		// status
		if (sample % (SAMPLE_RATE * 10) == 0)
			printf("processing sample %d / %d : %f%%\n", sample, numSamples,
				   100 * ((float)sample) / ((float)numSamples));

		float out = step(osc, K, N, dt, waveType) * sin((float)sample * PI*2.0 / SAMPLE_RATE);

		// Saturation
		out = tanhf(out * 3.0f);

#if BITDEPTH==32
		int32_t s = (int32_t)(INT32_MAX * out);
		fwrite(&s, sizeof(int32_t), 1, f);
#else
		int16_t s = (int16_t)(INT16_MAX * out);
		fwrite(&s, sizeof(int16_t), 1, f);
#endif
	}

	fclose(f);

	printf("\nwrote %s\n", outfile);

	return 0;
}
