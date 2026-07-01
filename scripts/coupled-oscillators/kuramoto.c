// kuramoto model coupled oscillators represented with sound
// based on https://qri.org/blog/cessation-simulations#coupling-kernels spec.

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include <ncurses.h>

#define DURATION_SECONDS (20)

#define BITDEPTH 16

#define N_RINGS (3)

#define PI	   3.14159265358979323846f
#define COL(I) ((I) % w)
#define ROW(I) ((I) / w)

#include "audio.h"
#include "kuramoto.h"

char *g_outfile;

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

char downcase(char c)
{
	if (c >= 'A' && c <= 'Z')
		return c + 'a' - 'A';
	return c;
}

void usage(char **argv)
{
	printf("usage: %s -n[N] -w[wave-type] -o[filename.wav]\n0 < N < %d\nwave: "
		   "one of Sin,Tri,saW,sQuare\n",
		   argv[0], BIG_N);
}

double ring_weight(double d, CouplingRing ring)
{
#if 1
	double x = fabs(d - ring.radius);
	if (x > ring.thickness)
		return 0.0;

	return ring.strength * (1.0f - x / ring.thickness);
#else
	double x = (d - radius) / thickness;
	return expf(-x * x);
#endif
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

	double out = 0.0;

	for (int i = 0; i < N; i++) {
		double phase = osc[i].phase * PI * 2.0;
		double pn = fmod(osc[i].phase, 1.0);
		double amp = osc[i].amp; // * sin(phase);

		double v = 0.0;
		switch (synth->waveType) {
			// sin,tri,saw,square
		case 's': // sin
			v = sin(phase);
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
		out += v * amp;
	}

	out /= (double)N;

	return out;
}

double synth_next_sample(void *userdata)
{
	Synthesizer *s = userdata;

	double x = step(s, 1.0 / SAMPLE_RATE);

	return tanh(x * 3.0);
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
					k += ring_weight(dist, synth->rings[r]);
				}

				synth->K[i][j] = k;
			}
		}
	}
}

void resetOscillators(Synthesizer *synth)
{
	Oscillator *osc = synth->osc;
	for (int i = 0; i < synth->N; i++) {
		osc[i].phase = randf(0.0, 1.0);
	}
}

void renderwav(Synthesizer *synth, const char *outfile, int duration)
{
	const int numSamples = SAMPLE_RATE * duration;
	const double dt = 1.0 / SAMPLE_RATE;

	FILE *f = fopen(outfile, "wb");

	if (!f) {
		perror(outfile);
		return;
	}

	write_wav_header(f, SAMPLE_RATE, numSamples);

	time_t startTime = time(NULL);

	for (int sample = 0; sample < numSamples; sample++) {

		if (sample % (SAMPLE_RATE * 10) == 0)
			printf("processing sample %d / %d : %.1f%%\n", sample, numSamples,
				   100.0 * sample / numSamples);

		double out = step(synth, dt);

		out = tanh(out * 3.0);

#if BITDEPTH == 32
		int32_t s = (int32_t)(INT32_MAX * out);
		fwrite(&s, sizeof(s), 1, f);
#else
		int16_t s = (int16_t)(INT16_MAX * out);
		fwrite(&s, sizeof(s), 1, f);
#endif
	}

	fclose(f);

	printf("\nWrote %s\n", outfile);

	time_t endTime = time(NULL);
	printf("Time elapsed: %lds\n", endTime - startTime);
}

char wavearg(char *s)
{
	if (strcmp(s, "sin") == 0)
		return 's';
	if (strcmp(s, "tri") == 0)
		return 't';
	if (strcmp(s, "saw") == 0)
		return 'w';
	if (strcmp(s, "square") == 0)
		return 'q';
	return downcase(s[0]);
}

void draw_ui(Synthesizer *synth, int selectedRing, int selectedField)
{
	erase();

	//----------------------------------------------------------
	// Title
	//----------------------------------------------------------

	mvprintw(0, 0, "Kuramoto Coupling Editor");

	mvprintw(1, 0, "Arrows: Move   +/-: Edit   Enter: Render   q: Quit");

	//----------------------------------------------------------
	// Ring table
	//----------------------------------------------------------

	int cols[3] = {8, 19, 33};

	// mvprintw(3, 2, "Radius   Thickness   Strength");
	mvprintw(3, cols[0], "   Radius");
	mvprintw(3, cols[1], "Thickness");
	mvprintw(3, cols[2], " Strength");

	for (int i = 0; i < N_RINGS; i++) {
		CouplingRing *r = &synth->rings[i];

		mvprintw(5 + i, 0, "%d", i);

		float values[3] = {r->radius, r->thickness, r->strength};

		for (int j = 0; j < 3; j++) {
			if (i == selectedRing && j == selectedField)
				attron(A_REVERSE);

			mvprintw(5 + i, cols[j], "%8.2f", values[j]);

			if (i == selectedRing && j == selectedField)
				attroff(A_REVERSE);
		}
	}

	//----------------------------------------------------------
	// Coupling profile
	//----------------------------------------------------------

	int graphY = 11;

	mvprintw(graphY, 0, "Coupling Kernel");

#if 1
	int target = synth->N / 3;
	char s[10];
	int w = synth->w;
	// int h = synth->h;
	for (int i = 0; i < synth->N; i++) {
		int x = COL(i);
		int y = ROW(i);
		// if (i > 0 && x == 0)
		// 	printf("\n");
		if (i == target)
			sprintf(s, "%s", "  XX");
		else
			sprintf(s, "%7.2f ", synth->K[target][i]);
		mvprintw(graphY + y, x * 5, s);
	}
	// printf("\n");

#else
	const int graphWidth = 40;

	for (int x = 0; x < graphWidth; x++) {
		float d = x * (float)(synth->w + synth->h) / (graphWidth - 1);

		float y = 0;

		for (int r = 0; r < N_RINGS; r++)
			y += ring_weight(d, synth->rings[r]);

		int h = (int)(fabs(y) / 10.0f);

		if (h > 8)
			h = 8;

		char c = '-';

		if (y > 0)
			c = " .:-=+*#@"[h];
		else if (y < 0)
			c = " .,:;xX#@"[h];

		mvaddch(graphY + 2, x, c);
	}
#endif

	//----------------------------------------------------------
	// Phase field
	//----------------------------------------------------------

#if 0
		graphY += 5;

		mvprintw(graphY, 0, "Phase Field");

		static const char ramp[] = " .:-=+*#%@";

		for (int y = 0; y < synth->h; y++) {
			for (int x = 0; x < synth->w; x++) {
				int idx = y * synth->w + x;

				if (idx >= synth->N)
					continue;

				double p = synth->osc[idx].phase;

				int c = (int)(p * 9.999);

				if (c < 0)
					c = 0;
				if (c > 9)
					c = 9;

				mvaddch(graphY + 2 + y, x, ramp[c]);
			}
		}
#endif

	refresh();
}

void applyChanges(Synthesizer *synth) { populateCouplingMatrix(synth); }

void updateParameter(Synthesizer *synth, int ring, int field, float delta)
{
	CouplingRing *r = &synth->rings[ring];

	switch (field) {
	case 0:
		r->radius += delta;
		if (r->radius < 0)
			r->radius = 0;
		break;

	case 1:
		r->thickness += delta;
		if (r->thickness < 1)
			r->thickness = 1;
		break;

	case 2:
		r->strength += delta * 5;
		break;
	}
}

enum { UI_RENDER, UI_QUIT };

void renderloop(Synthesizer *synth)
{
	AudioDevice *audio = audio_new();

	audio_init(audio, synth_next_sample, synth);

	initscr();
	cbreak();
	noecho();

	keypad(stdscr, TRUE);
	curs_set(0);

	timeout(16); // ~60 fps UI

	int ring = 0;
	int field = 0;

	while (1) {
		draw_ui(synth, ring, field);

		int ch = getch();

		switch (ch) {
		case ERR:
			break;

		case 'q':
			endwin();
			// audio_shutdown(&audio);
			exit(0); // TODO: change this
			return;

		case KEY_UP:
			if (ring > 0)
				ring--;
			break;

		case KEY_DOWN:
			if (ring < N_RINGS - 1)
				ring++;
			break;

		case KEY_LEFT:
			if (field > 0)
				field--;
			break;

		case KEY_RIGHT:
			if (field < 2)
				field++;
			break;

		case '+':
		case '=':
			applyChanges(synth);
			updateParameter(synth, ring, field, +1);
			break;

		case '-':
			applyChanges(synth);
			updateParameter(synth, ring, field, -1);
			break;

		case '\n':
		case KEY_ENTER:
			applyChanges(synth);
			renderwav(synth, g_outfile, DURATION_SECONDS);
			break;

		case ' ':

			// audio->playing = !audio->playing;

			break;

		case 'r':

			resetOscillators(synth);
			break;
		}
	}
}

int main(int argc, char **argv)
{
	srand(7);

	// argparse
	int N = BIG_N;
	char waveType = 's'; // sin,tri,saw,square
	char *outfile = "kuramoto.wav";

	int opt;
	int duration = DURATION_SECONDS;
	bool gui;

	while ((opt = getopt(argc, argv, "n:w:d:o:g:h")) != -1) {
		switch (opt) {

		case 'n':
			N = atoi(optarg);
			break;

		case 'w':
			waveType = wavearg(optarg);
			break;

		case 'd':
			duration = atoi(optarg);
			break;

		case 'o':
			outfile = optarg;
			break;

		case 'g':
			gui = true;
			break;

		case 'h':
			usage(argv);
			return 0;

		default:
			usage(argv);
			return 1;
		}
	}
	int badWaveType = !(waveType == 's' || waveType == 't' || waveType == 'w'
						|| waveType == 'q');
	if (badWaveType || N < 1 || N > BIG_N) {
		usage(argv);
		return 1;
	}
	g_outfile = outfile;

	Oscillator osc[BIG_N];
	double K[BIG_N][BIG_N];

#if 1
	int w = floorl(sqrt((double)N));
	int h = N / w;
#else
	int w = ceil(sqrt(N));
	int h = ceil((double)N / w);
#endif

	//--------------------------------------------------
	// Oscillators
	//--------------------------------------------------

	for (int i = 0; i < N; i++) {

		osc[i].amp = 0.25; // 1.0;
		osc[i].phase = randf(0.0, 1.0);

		// osc[i].freq = randf(435.0f, 445.0f);
		// osc[i].freq = randf(439.0, 441.0);
		// osc[i].freq = (i+1) / N * 880.0;

		osc[i].freq = 110.0 * (1.0 + 0.0 * (COL(i) / ((float)w)))
					  * pow(2.0, (float)(ROW(i)));
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

	Synthesizer synth = (Synthesizer){.rings = rings,
									  .waveType = waveType,
									  .osc = osc,
									  .N = N,
									  .w = w,
									  .h = h,
									  .K = K};

	populateCouplingMatrix(&synth);

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

	while (gui) {
		renderloop(&synth);
	}

	renderwav(&synth, outfile, duration);

	return 0;
}
