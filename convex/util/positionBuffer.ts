import { v } from "convex/values";
import { Point } from "../schema/types";

export class PositionBuffer {
    t: Array<number> = [];
    x: Array<number> = [];
    y: Array<number> = [];
    orientation: Array<number> = [];

    maxTs(): number | null {
        return this.t.at(-1) ?? null;
    }

    push(t: number, x: number, y: number, orientation: number) {
        const lastTime = this.t.at(-1);
        if (lastTime && t < lastTime) {
            throw new Error(`Time moving backwards from ${lastTime} to ${t}`);
        }
        if (lastTime && t === lastTime) {
            this.x[this.x.length - 1] = x;
            this.y[this.y.length - 1] = y;
            this.orientation[this.orientation.length - 1] = orientation;
            return;
        }
        this.t.push(t);
        this.x.push(x);
        this.y.push(y);
        this.orientation.push(orientation);
    }

    query(time: number): { position: Point, orientation: number } | null {
        if (this.t.length <= 1) {
            return null;
        }
        if (time < this.t[0] || this.t[this.t.length - 1] < time)  {
            return null;
        }
        for (let i = 1; i < this.t.length; i++) {
            if (this.t[i - 1] <= time && time <= this.t[i]) {
                const dx = this.x[i] - this.x[i - 1];
                const dy = this.y[i] - this.y[i - 1];
                const dt = this.t[i] - this.t[i - 1];
                const interp = (time - this.t[i - 1]) / dt;
                return {
                    position: {
                        x: this.x[i - 1] + interp * dx,
                        y: this.y[i - 1] + interp * dy,
                    },
                    orientation: this.orientation[i - 1],
                }
            }
        }
        throw new Error("Didn't find overlapping segment?");
    }

    pack(): PackedPositionBuffer {
        const length = this.x.length;
        if (this.y.length !== length || this.t.length !== length) {
            throw new Error("Length mismatch")
        }
        const t = (new Float64Array(this.t)).buffer;
        const x = (new Float64Array(this.x)).buffer;
        const y = (new Float64Array(this.y)).buffer;
        const orientation = (new Float64Array(this.orientation)).buffer;
        return { t, x, y, orientation };
    }

    static unpack(packed: PackedPositionBuffer): PositionBuffer {
        const byteLength = packed.x.byteLength;
        if (packed.y.byteLength !== byteLength || packed.t.byteLength !== byteLength) {
            throw new Error("Length mismatch")
        }
        if (byteLength % 4 !== 0) {
            throw new Error("Length not a multiple of four")
        }
        const out = new PositionBuffer();
        out.t = Array.from(new Float64Array(packed.t));
        out.x = Array.from(new Float64Array(packed.x));
        out.y = Array.from(new Float64Array(packed.y));
        out.orientation = Array.from(new Float64Array(packed.orientation));
        return out;
    }
}

export const packedPositionBuffer = v.object({
    t: v.bytes(),
    x: v.bytes(),
    y: v.bytes(),
    orientation: v.bytes(),
})
export type PackedPositionBuffer = typeof packedPositionBuffer.type;

// TODO:
// [ ] Switch to fixed point
// [ ] Delta encode positions
// [ ] Use https://github.com/lemire/FastIntegerCompression.js/blob/master/FastIntegerCompression.js