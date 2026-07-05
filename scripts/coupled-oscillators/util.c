#include "util.h"
#include <stdlib.h>
#include <math.h>

double randf(double a, double b)
{
	return a + (b - a) * ((double)rand() / (double)RAND_MAX);
}

char downcase(char c)
{
	if (c >= 'A' && c <= 'Z')
		return c + 'a' - 'A';
	return c;
}

int clamp(int x, int a, int b) { return fmin(fmax(x, a), b); }
