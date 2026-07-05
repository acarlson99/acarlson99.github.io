CFLAGS =-Wall -Wextra
LDLIBS =-lm -lncurses -ldl -lpthread

OFILES = kuramoto.o audio.o main.o util.o

all: kuramoto
kuramoto: ${OFILES}

debug: CFLAGS += -g
debug: kuramoto

clean:
	$(RM) kuramoto ${OFILES}

re: clean all
