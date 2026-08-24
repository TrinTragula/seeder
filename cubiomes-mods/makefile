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
release: CFLAGS += -O3 -flto
release: libcubiomes
native: CFLAGS += -O3 -march=native -ffast-math
native: libcubiomes

libcubiomes: noise.o biomes.o layers.o biomenoise.o terrainnoise.o generator.o finders.o carver.o util.o quadbase.o stronghold.o end_city.o fortress.o ore.o
	$(AR) $(ARFLAGS) libcubiomes.a $^

finders.o: ../cubiomes/finders.c ../cubiomes/finders.h
	$(CC) -c $(CFLAGS) $<

carver.o: ../cubiomes/carver.c ../cubiomes/carver.h
	$(CC) -c $(CFLAGS) $<

terrainnoise.o: ../cubiomes/terrainnoise.c ../cubiomes/terrainnoise.h
	$(CC) -c $(CFLAGS) $<

generator.o: ../cubiomes/generator.c ../cubiomes/generator.h
	$(CC) -c $(CFLAGS) $<

biomenoise.o: ../cubiomes/biomenoise.c
	$(CC) -c $(CFLAGS) $<

layers.o: ../cubiomes/layers.c ../cubiomes/layers.h
	$(CC) -c $(CFLAGS) $<

biomes.o: ../cubiomes/biomes.c ../cubiomes/biomes.h
	$(CC) -c $(CFLAGS) $<

noise.o: ../cubiomes/noise.c ../cubiomes/noise.h
	$(CC) -c $(CFLAGS) $<

util.o: ../cubiomes/util.c ../cubiomes/util.h
	$(CC) -c $(CFLAGS) $<

quadbase.o: ../cubiomes/quadbase.c ../cubiomes/quadbase.h
	$(CC) -c $(CFLAGS) $<

stronghold.o: ../cubiomes/features/stronghold.c ../cubiomes/features/stronghold.h
	$(CC) -c $(CFLAGS) $<

end_city.o: ../cubiomes/features/end_city.c ../cubiomes/features/end_city.h
	$(CC) -c $(CFLAGS) $<

fortress.o: ../cubiomes/features/fortress.c ../cubiomes/features/fortress.h
	$(CC) -c $(CFLAGS) $<

ore.o: ../cubiomes/features/ore.c ../cubiomes/features/ore.h
	$(CC) -c $(CFLAGS) $<

clean:
	$(RM) *.o *.a ../cubiomes/*.o ../cubiomes/*.a

