import { PositionBuffer } from "./positionBuffer";

test("position buffer roundtrips", () => {
    const data = [
        [1, 2, 0],
        [4, 5, 90],
        [7, 8, 270],
    ];
    const buffer = new PositionBuffer();
    for (let i = 0; i < data.length; i++) {
        const [x, y, orientation] = data[i];
        buffer.push(i, x, y, orientation);
    }
    const packed = buffer.pack();
    const unpacked = PositionBuffer.unpack(packed);

    expect(buffer).toStrictEqual(unpacked);
});