CFLAGS =-Wall -Wextra
LDLIBS =-lm -lncurses -ldl -lpthread

all: kuramoto
kuramoto: kuramoto.o audio.o

debug: CFLAGS += -g
debug: kuramoto

clean:
	$(RM) kuramoto kuramoto.o audio.o

re: clean all
