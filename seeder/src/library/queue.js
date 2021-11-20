export class QueueManager {
    constructor(path, numberOfWorkers) {
        this.path = path;
        this.numberOfWorkers = numberOfWorkers ?? navigator.hardwareConcurrency ?? 1;
        this.workers = [];
        this.workerCounter = 0;
        this.COLORS = null;
        this.drawCache = {};
        this.seedUpdateCallback = null;
        this._spawnWorkers();
        this.getColors();
    }

    draw(mcVersion, seed, startX, startY, widthX, widthY, dimension, yHeight, callback) {
        const cacheKey = mcVersion + "-" + seed + "-" + startX + "-" + startY + "-" + widthX + "-" + widthY + "-" + dimension + "-" + yHeight;
        const cachedColors = this.drawCache[cacheKey];
        if (cachedColors) {
            callback(cachedColors);
            return;
        } else {
            for (let worker of this.workers) {
                if (!worker.busy) {
                    worker.busy = true;
                    worker.callback = callback;
                    worker.postMessage({
                        kind: "GET_AREA",
                        data: { mcVersion, seed, startX, startY, widthX, widthY, dimension, yHeight }
                    });
                    return;
                }
            }
        }
        setTimeout(() => this.draw(mcVersion, seed, startX, startY, widthX, widthY, dimension, yHeight, callback), 33);
    }

    findBiomes(mcVersion, biomes, x, z, widthX, widthZ, startingSeed, dimension, yHeight, threads, callback) {
        startingSeed = startingSeed ?? 0;
        for (let worker of this.workers) {
            if (!worker.busy && threads !== 0) {
                worker.busy = true;
                worker.callback = (seed) => {
                    for (const worker of this.workers) {
                        worker.terminate();
                    }
                    this.workers = [];
                    this._spawnWorkers();
                    callback(seed);
                };
                worker.postMessage({
                    kind: "GET_BIOMES",
                    data: { mcVersion, biomes, x, z, widthX, widthZ, startingSeed, dimension, yHeight }
                });
                startingSeed += 1000000;
                threads--;
            }
        }
    }

    findSpawn(mcVersion, seed, callback) {
        for (let worker of this.workers) {
            if (!worker.busy) {
                worker.busy = true;
                worker.callback = callback;
                worker.postMessage({
                    kind: "GET_SPAWN",
                    data: { mcVersion, seed }
                });
                return;
            }
        }
        setTimeout(() => this.findSpawn(mcVersion, seed, callback), 33);
    }

    findStrongholds(mcVersion, seed, howMany, callback) {
        for (let worker of this.workers) {
            if (!worker.busy) {
                worker.busy = true;
                worker.callback = callback;
                worker.postMessage({
                    kind: "GET_STRONGHOLDS",
                    data: { mcVersion, seed, howMany }
                });
                return;
            }
        }
        setTimeout(() => this.findStrongholds(mcVersion, seed, howMany, callback), 33);
    }

    findStructures(mcVersion, structType, x, z, range, startingSeed, threads, callback) {
        startingSeed = startingSeed ?? 0;
        for (let worker of this.workers) {
            if (!worker.busy && threads !== 0) {
                worker.busy = true;
                worker.callback = (seed) => {
                    for (const worker of this.workers) {
                        worker.terminate();
                    }
                    this.workers = [];
                    this._spawnWorkers();
                    callback(seed);
                };
                worker.postMessage({
                    kind: "FIND_STRUCTURES",
                    data: { mcVersion, structType, x, z, range, startingSeed }
                });
                startingSeed += 1000000;
                threads--;
            }
        }
    }

    findBiomesWithStructures(mcVersion, structType, biomes, x, z, range, startingSeed, threads, callback) {
        startingSeed = startingSeed ?? 0;
        for (let worker of this.workers) {
            if (!worker.busy && threads !== 0) {
                worker.busy = true;
                worker.callback = (seed) => {
                    for (const worker of this.workers) {
                        worker.terminate();
                    }
                    this.workers = [];
                    this._spawnWorkers();
                    callback(seed);
                };
                worker.postMessage({
                    kind: "GET_BIOMES_WITH_STRUCTURES",
                    data: { mcVersion, structType, biomes, x, z, range, startingSeed }
                });
                startingSeed += 1000000;
                threads--;
            }
        }
    }

    getStructuresInRegions(mcVersion, structType, seed, regionsRange, callback) {
        for (let worker of this.workers) {
            if (!worker.busy) {
                worker.busy = true;
                worker.callback = callback;
                worker.postMessage({
                    kind: "GET_STRUCTURES_IN_REGIONS",
                    data: { mcVersion, structType, seed, regionsRange }
                });
                return;
            }
        }
        setTimeout(() => this.getStructuresInRegions(mcVersion, structType, seed, regionsRange, callback), 33);
    }

    getColors() {
        for (let worker of this.workers) {
            if (!worker.busy) {
                worker.busy = true;
                worker.postMessage({
                    kind: "GET_COLORS",
                });
                return;
            }
        }
        setTimeout(() => this.getColors(), 33);
    }

    printStatus() {
        console.log("Total workers: " + this.workers.length + " -  Busy: " + this.workers.filter(w => w.busy).length);
    }

    killAll() {
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
    }

    restartAll() {
        this.killAll();
        this._spawnWorkers();
    }

    _spawnWorkers() {
        for (let i = 0; i < this.numberOfWorkers; i++) {
            this._spawnWorker((w) => {
                this.workers.push(w);
            });
        }
    }

    _spawnWorker(callback) {
        const worker = new Worker(this.path);
        worker.name = "Worker_" + this.workerCounter++;
        worker.busy = true;
        worker.addEventListener('message', (e) => this._commonListener(e, worker, callback));
    }

    _commonListener(e, worker, callback) {
        if (e.data.kind === "DONE_LOADING") {
            worker.busy = false;
            callback(worker);
        }
        else if (e.data.kind === "DONE_GET_AREA") {
            const data = e.data.data;
            const cacheKey = data.mcVersion + "-" + data.seed + "-" + data.startX + "-" + data.startY + "-" + data.widthX + "-" + data.widthY + "-" + data.dimension + "-" + data.yHeight;
            this.drawCache[cacheKey] = data.colors;
            worker.callback(data.colors);
            this._cleanWorker(worker);
        }
        else if (e.data.kind === "DONE_GET_BIOMES") {
            const data = e.data.data;
            worker.callback(data.seed);
            this._cleanWorker(worker);
        }
        else if (e.data.kind === "DONE_GET_SPAWN") {
            const data = e.data.data;
            worker.callback(data.x, data.z);
            this._cleanWorker(worker);
        }
        else if (e.data.kind === "DONE_GET_STRONGHOLDS") {
            const data = e.data.data;
            worker.callback(data);
            this._cleanWorker(worker);
        }
        else if (e.data.kind === "DONE_FIND_STRUCTURES") {
            const data = e.data.data;
            worker.callback(data.seed);
            this._cleanWorker(worker);
        }
        else if (e.data.kind === "DONE_GET_BIOMES_WITH_STRUCTURES") {
            const data = e.data.data;
            worker.callback(data.seed);
            this._cleanWorker(worker);
        }
        else if (e.data.kind === "DONE_GET_STRUCTURES_IN_REGIONS") {
            const data = e.data.data;
            worker.callback(data);
            this._cleanWorker(worker);
        }
        else if (e.data.kind === "DONE_GET_COLORS") {
            const data = e.data.data;
            this.COLORS = data.colors;
            this._cleanWorker(worker);
        }
        else if (e.data.kind === "SEED_UPDATE") {
            if (this.seedUpdateCallback) {
                this.seedUpdateCallback();
            }
        }
    }

    _cleanWorker(worker) {
        worker.callback = null;
        worker.busy = false;
    }
}