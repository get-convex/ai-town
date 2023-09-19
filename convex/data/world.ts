import { bgtiles, objmap, tiledim, tilefiledim, tilesetpath } from './map';

export const map = {
  tileSetUrl: tilesetpath,
  tileSetDim: tilefiledim,
  tileDim: tiledim,
  bgTiles: bgtiles,
  objectTiles: objmap,
};

export const world = {
  width: bgtiles[0][0].length,
  height: bgtiles[0].length,
};
