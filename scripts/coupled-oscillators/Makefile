CFLAGS =-Wall -Wextra
LDLIBS =-lm -lncurses -lportaudio

# $ sudo apt install portaudio19-dev

all: kuramoto
kuramoto: kuramoto.o

clean:
	$(RM) kuramoto kuramoto.o

re: clean all
