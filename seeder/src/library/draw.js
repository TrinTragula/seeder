import { BIOMES } from '../util/constants';

export class DrawSeed {
    constructor(mcVersion, queue, canvas, hiddenCanvasDimensions, onclick, onmousemove, drawDim) {
        this.mcVersion = mcVersion;
        this.dimension = 0; // Overworld
        this.yHeight = 320; // Top of the world
        this.queue = queue;
        this.canvas = canvas;
        this.hiddenCanvasDimensions = hiddenCanvasDimensions;
        this.halfHiddenDim = Math.floor(hiddenCanvasDimensions / 2);
        this.biomesDict = {};
        this.ctx = this.canvas.getContext("2d");
        this.drawDim = drawDim ?? 50;
        this.spawnShown = false;
        this.spawnX = null;
        this.spawnZ = null;
        this.strongholdsShown = false;
        this.strongholds = null;
        this.structuresShown = {};
        this.structures = {};
        this.toDraw = 0;
        this.showStructureCoords = true;
        this.drawnSquares = {}
        this.drawnTotale = {}

        // if (onclick) {
        //     this.canvas.onclick = (e) => {
        //         const [x, y, biome] = this.getBiomeAndPos(e);
        //         if (x && y && biome) {
        //             onclick(x, y, biome);
        //         }
        //     };
        // }

        // if (onmousemove) {
        //     this.canvas.onmousemove = (e) => {
        //         const [x, y, biome] = this.getBiomeAndPos(e);
        //         if (x && y && biome) {
        //             onmousemove(x, y, biome);
        //         }
        //     };
        // }
    }

    clear() {
        this.biomesDict = {};
        this.drawnSquares = {}
        this.drawnTotale = {}
        this.spawnX = null;
        this.spawnZ = null;
        this.strongholds = null;
        this.structures = {};
        this.strongholdsShown = false;
        this.spawnShown = false;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    setShowStructureCoords(value) {
        if (value !== this.showStructureCoords) {
            this.showStructureCoords = value;
        }
    }

    setSeed(seed) {
        if (this.seed !== seed) {
            this.seed = seed;
        }
    }

    setDimension(dimension) {
        if (this.dimension !== dimension) {
            this.dimension = dimension;
        }
    }

    setYHeight(yHeight) {
        if (this.yHeight !== yHeight) {
            this.yHeight = yHeight;
        }
    }

    setMcVersion(mcVersion) {
        this.mcVersion = mcVersion;
    }

    findSpawn(callback) {
        if (this.spawnX && this.spawnZ) {
            if (callback) callback(this.seed, this.spawnX, this.spawnZ);
            return;
        }
        this.queue.findSpawn(this.mcVersion, this.seed, (x, z) => {
            this.spawnX = x;
            this.spawnZ = z;
            this.spawnShown = true;
            if (callback) callback(this.seed, this.spawnX, this.spawnZ);
        });
    }

    findStrongholds(callback) {
        if (this.strongholds?.length > 0) {
            if (callback) callback(this.seed, this.strongholds);
            return;
        }
        this.queue.findStrongholds(this.mcVersion, this.seed, 150, ({ coords }) => {
            this.strongholds = coords;
            this.strongholdsShown = true;
            if (callback) callback(this.seed, this.strongholds);
        });
    }

    findStructure(structType, callback) {
        if (this.structures && this.structures[structType]?.length > 0) {
            if (callback) callback(this.seed, this.structures[structType]);
            this.structuresShown[structType] = true;
            return;
        }
        this.queue.getStructuresInRegions(this.mcVersion, structType, this.seed, 50, this.dimension, ({ coords }) => {
            this.structures[structType] = coords;
            if (callback) callback(this.seed, this.structures[structType]);
            this.structuresShown[structType] = true;
        });
    }

    setStructuresShown(structTypes) {
        this.structuresShown = {};
        for (const structType of structTypes) {
            this.structuresShown[structType] = true;
        }
    }

    spiral(xDim, yDim, callback) {
        let x = 0;
        let y = 0;
        let dx = 0;
        let dy = -1;
        const baseX = Math.ceil(xDim / 2) - 1;
        const baseY = Math.ceil(yDim / 2) - 1;
        for (let i = 0; i < Math.pow(Math.max(xDim, yDim), 2); i++) {
            if ((-(xDim / 2) < x && x <= (xDim / 2)) && (-(yDim / 2) < y && y <= (yDim / 2))) {
                var shouldStop = callback(baseX + x, baseY + y);
                if (shouldStop) return;
            }
            if ((x === y) || (x < 0 && x === -y) || (x > 0 && x === (1 - y))) {
                const tempDy = dy;
                dy = dx;
                dx = -tempDy;
            }
            x = x + dx;
            y = y + dy;
        }
        return;
    }

    draw(x, y, width, height, callback) {
        const indexX = Math.floor(x / this.drawDim);
        const indexY = Math.floor(y / this.drawDim);
        if (this.drawnTotale[indexX + "-" + indexY]) {
            callback();
        } else {
            this.drawnTotale[indexX + "-" + indexY] = true;
            x = indexX + 1;
            y = indexY + 1;
            const xSize = Math.ceil(width / this.drawDim) + 1;
            const ySize = Math.ceil(height / this.drawDim) + 1;
            this.spiral(xSize, ySize, (i, j) => {
                let startX = Math.floor(this.drawDim * (i - x));
                let startY = Math.floor(this.drawDim * (j - y));
                if (this.drawnSquares[startX + "-" + startY]) {
                    callback();
                } else {
                    this.drawnSquares[startX + "-" + startY] = true;
                    this.queue.draw(this.mcVersion, this.seed, startX, startY, this.drawDim, this.drawDim, this.dimension, this.yHeight, (colors) => {
                        this._drawLoop(colors, startX, startY, this.drawDim, this.drawDim);
                        this.drawStructures();
                        callback();
                    });
                    return false; // countinue, don't stop iterating
                }
            });
        }
    }

    drawText(text, x, z) {
        if (this.showStructureCoords) {
            this.ctx.fillStyle = '#333333';
            this.ctx.strokeStyle = 'white';
            this.ctx.lineWidth = 3;

            this.ctx.font = '10pt Verdana';
            this.ctx.textAlign = "center";

            this.ctx.strokeText(text, x, z + 30);
            this.ctx.fillText(text, x, z + 30);

            this.ctx.fill();
            this.ctx.stroke();
        }
    }

    drawStructures() {
        if (this.spawnShown && this.dimension === 0 && this.spawnX != null && this.spawnZ != null) {
            let drawX = Math.floor(this.halfHiddenDim + this.spawnX / 4);
            let drawZ = Math.floor(this.halfHiddenDim + this.spawnZ / 4);
            if (drawX > 0 && drawZ > 0 && drawX < this.hiddenCanvasDimensions && drawZ < this.hiddenCanvasDimensions) {
                const image = new Image(32, 30);
                image.src = this.spawnImage;
                if (image.complete) {
                    this.ctx.drawImage(image, drawX - 16, drawZ - 15, 32, 30);
                } else {
                    image.onload = () => {
                        this.ctx.drawImage(image, drawX - 16, drawZ - 15, 32, 30);
                    };
                }
                this.drawText(`(${this.spawnX}, ${this.spawnZ})`, drawX, drawZ);
            }
        }

        if (this.strongholdsShown && this.dimension === 0 && this.strongholds && this.strongholds.length > 0) {
            for (const stronghold of this.strongholds) {
                let drawX = Math.floor(this.halfHiddenDim + stronghold[0] / 4);
                let drawZ = Math.floor(this.halfHiddenDim + stronghold[1] / 4);
                if (drawX > 0 && drawZ > 0 && drawX < this.hiddenCanvasDimensions && drawZ < this.hiddenCanvasDimensions) {
                    const image = new Image(30, 30);
                    image.src = this.eyeImage;
                    if (image.complete) {
                        this.ctx.drawImage(image, drawX - 15, drawZ - 15, 30, 30);
                    } else {
                        image.onload = () => {
                            this.ctx.drawImage(image, drawX - 15, drawZ - 15, 30, 30);
                        };
                    }
                    this.drawText(`(${stronghold[0]}, ${stronghold[1]})`, drawX, drawZ);
                }
            }
        }

        if (this.structuresShown) {
            for (let structureKey of Object.keys(this.structuresShown)) {
                if (this.structures[structureKey]) {
                    for (const structure of this.structures[structureKey]) {
                        let drawX = Math.floor(this.halfHiddenDim + structure[0] / 4);
                        let drawZ = Math.floor(this.halfHiddenDim + structure[1] / 4);
                        if (drawX > 0 && drawZ > 0 && drawX < this.hiddenCanvasDimensions && drawZ < this.hiddenCanvasDimensions) {
                            const image = new Image(30, 30);
                            image.src = this.images[structureKey];
                            if (image.complete) {
                                this.ctx.drawImage(image, drawX - 15, drawZ - 15, 30, 30);
                            } else {
                                image.onload = () => {
                                    this.ctx.drawImage(image, drawX - 15, drawZ - 15, 30, 30);
                                };
                            }
                            this.drawText(`(${structure[0]}, ${structure[1]})`, drawX, drawZ);
                        }
                    }
                }
            }
        }
    }

    _drawLoop(colors, startX, startY, widthX, widthY) {
        startX = Math.floor(startX);
        startY = Math.floor(startY);
        
        const pixels = new Array(widthY * widthX);
        for (let jj = 0; jj < (widthY); jj++) {
            const realjj = Math.floor(jj);
            const base = jj * widthX;
            for (let ii = 0; ii < (widthX); ii++) {
                const realii = Math.floor(ii);
                pixels[ii + base] = colors[(realii * widthX) + realjj];
                if (!this.biomesDict[startX + realii]) {
                    this.biomesDict[startX + realii] = {};
                }
                this.biomesDict[startX + realii][startY + realjj] = colors[(realii * widthX) + realjj];
            }
        }
        const arr = Uint8ClampedArray.from(pixels.flat());
        const imageData = new ImageData(arr, widthX, widthY);
        this.ctx.putImageData(imageData, this.halfHiddenDim + startX, this.halfHiddenDim + startY);
    }

    getBiomeAndPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const trueX = Math.floor(x - this.offsetX * (this.drawDim));
        const trueY = Math.floor(y - this.offsetZ * (this.drawDim));

        if (this.biomesDict && this.biomesDict[trueX] && this.biomesDict[trueX][trueY]) {
            const rgba = this.biomesDict[trueX][trueY];
            const key = rgba.join('-');
            if (this.queue.COLORS) {
                const index = this.queue.COLORS.findIndex(x => x.join('-') === key);
                if (index > -1) {
                    return [4 * trueX, 4 * trueY, BIOMES.find(x => x.value === index)?.label];
                }
            }
        }
        return [null, null, null];
    };

    spawnImage = '/img/spawn.png';

    eyeImage = '/img/eye.png';

    images = {
        /*  Desert_Pyramid */   1: '/img/temple.png',
        /*  Jungle_Pyramid */   2: '/img/jungle.png',
        /*  Swamp_Hut */        3: '/img/hut.png',
        /*  Igloo */            4: '/img/igloo.png',
        /*  Village */          5: '/img/village.png',
        /*  Ocean_Ruin */       6: '/img/ocean.png',
        /*  Shipwreck */        7: '/img/wood.jpg',
        /*  Monument */         8: '/img/guardian.png',
        /*  Mansion */          9: '/img/mansion.png',
        /*  Outpost */          10: '/img/outpost.png',
        /*  Ruined_Portal */    11: '/img/portal.png',
        // 12 Ruined_Portal_N,
        /*  Treasure */         13: '/img/treasure.png',
        // 14 Mineshaft,
        /*  Fortress */         15: '/img/fortress.png',
        /*  Bastion */          16: '/img/bastion.png',
        /*  End_City */         17: '/img/end_city.png',
        /*  End_Gateway */      18: '/img/end_gateway.png',
    }
}