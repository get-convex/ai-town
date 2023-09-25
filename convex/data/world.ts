import { bgtiles, objmap, tiledim, tilefiledim, tilesetpath } from './map';

export const map = {
  tileSetUrl: tilesetpath,
  tileSetDim: tilefiledim,
  tileDim: tiledim,
  bgTiles: bgtiles,
  objectTiles: objmap,
};
export const mapWidth = bgtiles[0][0].length;
export const mapHeight = bgtiles[0].length;
