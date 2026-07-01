#pragma once

typedef double (*AudioCallback)(void *);

typedef struct AudioDevice AudioDevice;

struct AudioDevice {
	ma_device device;

	AudioCallback callback;

	void *userdata;

	int playing;
};

int audio_init(AudioDevice *audio, AudioCallback callback, void *userdata);

void audio_shutdown(AudioDevice *audio);

void audio_pause(AudioDevice *audio);

void audio_resume(AudioDevice *audio);

int audio_is_playing(AudioDevice *audio);
