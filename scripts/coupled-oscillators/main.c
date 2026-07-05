#include "audio.h"
#include "kuramoto.h"
#include "util.h"

#include <math.h>
#include <ncurses.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define DURATION_SECONDS (20)

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

void renderwav(Synthesizer *synth, int duration)
{
	const int numSamples = SAMPLE_RATE * duration;
	const double dt = 1.0 / SAMPLE_RATE;

	const char *outfile = synth->outfile;

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

		out = synth_postprocess_sound(synth, out);

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

typedef enum { MAIN, FREQ_EDITOR } UIMode;

typedef struct {
	int selY;
	int selX;
	UIMode mode;
	double osc_zoom;
} UIState;

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

void draw_ui(Synthesizer *synth, UIState *state)
{
	int selectedRing = state->selY;
	int selectedField = state->selX;
	erase();

	//----------------------------------------------------------
	// Title
	//----------------------------------------------------------

	mvprintw(0, 0, "Kuramoto Coupling Editor");

	mvprintw(1, 0,
			 "Arrows: Move   +/-: Edit   Enter: Render   Space: Play/Pause "
			 "Audio   q: Quit");
	mvprintw(
		2, 0,
		"Tab: Edit Frequency/Rings   r/s: Randomize/Syncronize Oscillator Phase"
		"   o/O: Oscilloscope Zoom In/Out");
	mvprintw(3, 0, "m: Mute   [/]: Master Volume   x/X: Phase Composition Algorithm");

	//----------------------------------------------------------
	// Ring table
	//----------------------------------------------------------

	int cols[3] = {8, 19, 33};

	mvprintw(5, cols[0], "   Radius");
	mvprintw(5, cols[1], "Thickness");
	mvprintw(5, cols[2], " Strength");

	for (int i = 0; i < N_RINGS; i++) {
		CouplingRing *r = &synth->rings[i];

		mvprintw(6 + i, 0, "%d", i);

		float values[3] = {r->radius, r->thickness, r->strength};

		for (int j = 0; j < 3; j++) {
			if (state->mode == MAIN && i == selectedRing && j == selectedField)
				attron(A_REVERSE);

			mvprintw(6 + i, cols[j], "%7.2f", values[j]);

			if (state->mode == MAIN && i == selectedRing && j == selectedField)
				attroff(A_REVERSE);
		}
	}

	int graphY = 11;
	if (state->mode == FREQ_EDITOR) {
		mvprintw(graphY - 1, 0, "Frequency Editor");

		int w = synth->w;
		// int h = synth->h;
		for (int i = 0; i < synth->N; i++) {
			int x = COL(i);
			int y = ROW(i);
			if (x == state->selX && y == state->selY)
				attron(A_REVERSE);
			// sprintf(s, "%7.2f", synth->osc[i].freq);
			mvprintw(graphY + y, x * 5, "%7.2f", synth->osc[i].freq);
			if (x == state->selX && y == state->selY)
				attroff(A_REVERSE);
		}
	} else {
		//----------------------------------------------------------
		// Coupling profile
		//----------------------------------------------------------

		mvprintw(graphY - 1, 0, "Coupling Kernel");

		int target = synth->N / 3;
		int w = synth->w;
		// int h = synth->h;
		for (int i = 0; i < synth->N; i++) {
			int x = COL(i);
			int y = ROW(i);
			if (i == target)
				mvprintw(graphY + y, x * 5, "  XX");
			else
				mvprintw(graphY + y, x * 5, "%7.2f ", synth->K[target][i]);
		}
	}

	//----------------------------------------------------------
	// Phase field
	//----------------------------------------------------------

	graphY += synth->h + 1;

	mvprintw(graphY, 0, "Phase Field");

	static const char ramp[] = " .:-=+*DHIMAE#%@";
	int nch = sizeof(ramp) / sizeof(*ramp) - 1;

	for (int y = 0; y < synth->h; y++) {
		for (int x = 0; x < synth->w; x++) {
			int idx = y * synth->w + x;

			if (idx >= synth->N)
				continue;

			double p = synth->osc[idx].phase;

			int c = (int)(p * nch);

			if (c < 0)
				c = 0;
			if (c > nch)
				c = nch;

			mvaddch(graphY + 2 + y, x, ramp[c]);
		}
	}

	//----------------------------------------------------------
	// Waveform
	//----------------------------------------------------------

	int waveY = graphY + synth->h + 4;

	mvprintw(waveY, 0, "Output");

	const int waveHeight = 16;
	// const int waveWidth =
	// 	sizeof(synth->last_samples) / sizeof(*synth->last_samples);

	// Draw an 80-column waveform from the circular history buffer.
	{
		float oscAmp = 4.0;
		int waveWidth = 120;
		// Draw center line first.
		int mid = (waveHeight - 1) / 2;

		int visibleSamples = (int)(HISTORY / state->osc_zoom);
		if (visibleSamples < waveWidth)
			visibleSamples = waveWidth;

		int oldest = (synth->_samp_next_i - visibleSamples + HISTORY) % HISTORY;

		for (int x = 0; x < waveWidth; x++)
			mvaddch(waveY + 1 + mid, x, '-');

		float samplesPerColumn = (float)HISTORY / waveWidth / state->osc_zoom;

		for (int x = 0; x < waveWidth; x++) {
			// Compute the sample range represented by this column.
			int begin = (int)(x * samplesPerColumn);
			int end = (int)((x + 1) * samplesPerColumn);

			if (end <= begin)
				end = begin + 1;

			float lo = 1e30f;
			float hi = -1e30f;

			for (int i = begin; i < end; i++) {
				// Oldest sample on left, newest on right.
				int idx = (oldest + i) % HISTORY;

				float s = synth->last_samples[idx];

				if (s > 1.f)
					s = 1.f;
				if (s < -1.f)
					s = -1.f;

				if (s < lo)
					lo = s;
				if (s > hi)
					hi = s;
			}

			int y0 =
				(int)((1.f - (hi * oscAmp + 1.f) * 0.5f) * (waveHeight - 1));
			int y1 =
				(int)((1.f - (lo * oscAmp + 1.f) * 0.5f) * (waveHeight - 1));

			if (y0 > y1) {
				int t = y0;
				y0 = y1;
				y1 = t;
			}

			for (int y = y0; y <= y1; y++) {
				char c;

				if (y0 == y1)
					c = '*';
				else if (y == y0)
					c = '^';
				else if (y == y1)
					c = 'v';
				else
					c = '|';

				mvaddch(waveY + 1 + y, x, c);
			}
		}
	}

	char buf[52] = {0};
	// buf[50] = '>';
	int mvol = synth->master_volume / 2;
	memset(buf, '=', mvol);
	// memset(buf + mvol, ' ', 50 - mvol);
	buf[0] = '8';
	if ((synth->master_volume % 2) == 1)
		buf[synth->master_volume / 2] = 'D';
	else
		buf[synth->master_volume / 2] = ',';
	mvaddstr(waveY - 1, 0, buf);
	mvaddch(waveY - 1, 50, '>');

	refresh();
}

void renderloop(Synthesizer *synth)
{
	AudioDevice *audio = audio_new();

	int w = synth->w;
	// int h = synth->h;

	audio_init(audio, synth_next_sample, synth);

	initscr();
	cbreak();
	noecho();

	keypad(stdscr, TRUE);
	curs_set(0);

	timeout(16); // ~60 fps UI

	UIState state = {0};
	state.osc_zoom = 8;

	while (1) {
		draw_ui(synth, &state);

		int ch = getch();

		switch (ch) {
		case ERR:
			break;

		case 'q':
			endwin();
			// audio_shutdown(&audio);
			// exit(0); // TODO: change this
			return;

		case KEY_UP:
			state.selY--;
			break;
		case KEY_DOWN:
			state.selY++;
			break;
		case KEY_LEFT:
			state.selX--;
			break;
		case KEY_RIGHT:
			state.selX++;
			break;

		case '+':
		case '=':
			if (state.mode == MAIN) {
				updateParameter(synth, state.selY, state.selX, +1);
			} else {
				synth->osc[IDX(state.selX, state.selY)].freq += 1;
			}
			applyChanges(synth);
			break;

		case '-':
			if (state.mode == MAIN) {
				updateParameter(synth, state.selY, state.selX, -1);
			} else {
				synth->osc[IDX(state.selX, state.selY)].freq -= 1;
			}
			applyChanges(synth);
			break;

		case '\n':
		case KEY_ENTER:
			applyChanges(synth);
			renderwav(synth, DURATION_SECONDS);
			break;

		case ' ':
			if (audio_is_playing(audio))
				audio_pause(audio);
			else
				audio_resume(audio);
			break;

		case '\t':
			if (state.mode == MAIN)
				state.mode = FREQ_EDITOR;
			else
				state.mode = MAIN;
			break;

		case 'r':
			oscPhaseRandomize(synth);
			break;

		case 's':
			oscPhaseSet(synth, 0.0);
			break;

		case 'm':
			synth->mute ^= true;
			break;

		case '[':
			synth->master_volume--;
			break;
		case ']':
			synth->master_volume++;
			break;

		case 'o':
			state.osc_zoom += 1;
			break;
		case 'O':
			state.osc_zoom /= 2;
			break;

		case 'x':
			synth->mixMode++;
			break;
		case 'X':
			synth->mixMode--;
			break;
		}

		// clamp xy select values
		int maxx = synth->w - 1;
		int maxy = synth->h - 1;
		if (state.mode == MAIN) {
			maxx = 2;
			maxy = N_RINGS - 1;
		}
		state.selX = clamp(state.selX, 0, maxx);
		state.selY = clamp(state.selY, 0, maxy);

		synth->master_volume = clamp(synth->master_volume, 0, 100);
		synth->mixMode = clamp(synth->mixMode, MIX_SUM, MIX_ORDER_DERIVATIVE);
	}
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

void usage(char **argv)
{
	printf("usage: %s -n[num-oscillators] -v[wave-type] -w[matrix-width] -gui "
		   "-o[filename.wav] -d[recording-duration]\n0 < N < %d\nwave: "
		   "one of Sin,Tri,saW,sQuare\n",
		   argv[0], BIG_N);
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
	bool gui = false;
	int maxWidth = INT32_MAX;

	while ((opt = getopt(argc, argv, "n:v:w:o:d:g:h")) != -1) {
		switch (opt) {

		case 'n':
			N = atoi(optarg);
			break;

		case 'v':
			waveType = wavearg(optarg);
			break;

		case 'w':
			maxWidth = atoi(optarg);
			break;

		case 'o':
			outfile = optarg;
			break;

		case 'd':
			duration = atoi(optarg);
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

	Oscillator osc[BIG_N];
	double K[BIG_N][BIG_N];

#if 1
	int w = floorl(sqrt((double)N));
	w = fmin(w, maxWidth);
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

		osc[i].freq = 110.0 / 2 / 2 * (1.0 + 0.0 * (COL(i) / ((float)w)))
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
									  .K = K,
									  .master_volume = 25,
									  .mute = false,
									  .outfile = outfile,
									  .mixMode = MIX_SUM};

	// printf("w: %d h %d", w, h);
	applyChanges(&synth);

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

	if (gui) {
		renderloop(&synth);
		return 0;
	}

	renderwav(&synth, duration);

	return 0;
}
