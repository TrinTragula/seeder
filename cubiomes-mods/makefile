CC      = emcc
AR      = emar
ARFLAGS = cr
override LDFLAGS = -lm
override CFLAGS += -Wall -Wextra -fwrapv

override LDFLAGS += -pthread
#RM = rm

.PHONY : all debug release native libcubiomes clean

all: release

debug: CFLAGS += -DDEBUG -O0 -ggdb3
debug: libcubiomes
release: CFLAGS += -O3 -g3
release: libcubiomes
native: CFLAGS += -O3 -march=native
native: libcubiomes

libcubiomes: noise.o biome_tree.o layers.o generator.o finders.o util.o
	$(AR) $(ARFLAGS) libcubiomes.a $^


finders.o: ../cubiomes/finders.c ../cubiomes/finders.h
	$(CC) -c $(CFLAGS) $<

generator.o: ../cubiomes/generator.c ../cubiomes/generator.h
	$(CC) -c $(CFLAGS) $<

layers.o: ../cubiomes/layers.c ../cubiomes/layers.h
	$(CC) -c $(CFLAGS) $<

biome_tree.o: ../cubiomes/biome_tree.c
	$(CC) -c $(CFLAGS) $<

noise.o: ../cubiomes/noise.c ../cubiomes/noise.h
	$(CC) -c $(CFLAGS) $<

util.o: ../cubiomes/util.c ../cubiomes/util.h
	$(CC) -c $(CFLAGS) $<

clean:
	$(RM) ../cubiomes/*.o ../cubiomes/libcubiomes.a

