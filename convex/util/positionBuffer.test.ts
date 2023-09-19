import { Point, Vector } from './types';
import { PositionBuffer } from './positionBuffer';

test('position buffer roundtrips', () => {
  const data: [Point, Vector][] = [
    [
      { x: 1, y: 2 },
      { dx: 1, dy: 0 },
    ],
    [
      { x: 3, y: 4 },
      { dx: 0, dy: 1 },
    ],
    [
      { x: 5, y: 6 },
      { dx: -1, dy: 0 },
    ],
    [
      { x: 7, y: 8 },
      { dx: 0, dy: -1 },
    ],
  ];
  const buffer = new PositionBuffer();
  for (let i = 0; i < data.length; i++) {
    const [position, vector] = data[i];
    buffer.push(i, position, vector);
  }
  const packed = buffer.pack();
  const unpacked = PositionBuffer.unpack(packed);

  expect(buffer).toStrictEqual(unpacked);
});
