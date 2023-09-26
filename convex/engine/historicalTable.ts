import { WithoutSystemFields } from 'convex/server';
import { Doc, Id, TableNames } from '../_generated/dataModel';
import { DatabaseWriter } from '../_generated/server';
import { isSimpleObject } from '../util/isSimpleObject';

type FieldPath = string;

type Sample = {
  time: number;
  value: number;
};

export abstract class HistoricalTable<T extends TableNames> {
  abstract table: T;
  abstract db: DatabaseWriter;

  fields: FieldPath[];

  data: Map<Id<T>, Doc<T>> = new Map();
  modified: Set<Id<T>> = new Set();
  deleted: Set<Id<T>> = new Set();

  history: Map<Id<T>, Map<number, Sample[]>> = new Map();

  constructor(fields: FieldPath[], rows: Doc<T>[]) {
    this.fields = fields;
    for (const row of rows) {
      if ('history' in row) {
        delete row.history;
        this.modified.add(row._id);
      }
      this.checkNumeric(row);
      this.data.set(row._id, row);
    }
  }

  historyLength() {
    return [...this.history.values()]
      .flatMap((sampleMap) => [...sampleMap.values()])
      .map((b) => b.length)
      .reduce((a, b) => a + b, 0);
  }

  checkNumeric(obj: any) {
    for (const [key, value] of Object.entries(obj)) {
      if (this.isReservedFieldName(key)) {
        continue;
      }
      if (typeof value === 'number') {
        continue;
      }
      if (isSimpleObject(value)) {
        this.checkNumeric(value);
        continue;
      }
      throw new Error(
        `HistoricalTable only supports numeric leaf values, found: ${JSON.stringify(value)}`,
      );
    }
  }

  isReservedFieldName(key: string) {
    return key.startsWith('_') || key === 'history';
  }

  async insert(now: number, row: WithoutSystemFields<Doc<T>>): Promise<Id<T>> {
    this.checkNumeric(row);
    if ('history' in row) {
      throw new Error(`Cannot insert row with 'history' field`);
    }
    const id = await this.db.insert(this.table, row);
    const withSystemFields = await this.db.get(id);
    if (!withSystemFields) {
      throw new Error(`Failed to db.get() inserted row`);
    }
    this.data.set(id, withSystemFields);
    return id;
  }

  lookup(now: number, id: Id<T>): Doc<T> {
    const row = this.data.get(id);
    if (!row) {
      throw new Error(`Invalid ID: ${id}`);
    }
    const handlers = (path: FieldPath) => {
      return {
        defineProperty: (target: any, key: any, descriptor: any) => {
          throw new Error(`Adding new fields unsupported on HistoricalTable`);
        },
        get: (target: any, prop: any, receiver: any) => {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value === 'object') {
            return new Proxy<Doc<T>>(value, handlers(`${path}.${prop}`));
          } else {
            return value;
          }
        },
        set: (obj: any, prop: any, value: any) => {
          this.checkNumeric(value);
          const subPath = path.length > 0 ? `${path}.${prop}` : prop;
          this.markModified(id, now, subPath, value);
          return Reflect.set(obj, prop, value);
        },
        deleteProperty: (target: any, prop: any) => {
          throw new Error(`Deleting fields unsupported on HistoricalTable`);
        },
      };
    };
    return new Proxy<Doc<T>>(row, handlers(''));
  }

  private markModified(id: Id<T>, now: number, fieldPath: FieldPath, value: any) {
    if (logged < 10) {
      console.log(`markModified`, id, now, fieldPath, value);
      logged++;
    }
    if (fieldPath == 'history') {
      throw new Error(`Cannot modify 'history' field`);
    }
    this.modified.add(id);
    let sampleMap = this.history.get(id);
    if (!sampleMap) {
      sampleMap = new Map();
      this.history.set(id, sampleMap);
    }
    this.appendToBuffer(sampleMap, now, fieldPath, value);
  }

  private appendToBuffer(
    sampleMap: Map<number, Sample[]>,
    now: number,
    fieldPath: null | FieldPath,
    value: any,
  ) {
    if (typeof value === 'number') {
      if (!fieldPath) {
        throw new Error(`Numeric value at document root`);
      }
      let fieldNumber = this.fields.indexOf(fieldPath);
      if (fieldNumber === -1) {
        return;
      }
      let samples = sampleMap.get(fieldNumber);
      if (!samples) {
        samples = [];
        sampleMap.set(fieldNumber, samples);
      }
      if (samples.length > 0) {
        const last = samples[samples.length - 1];
        if (now < last.time) {
          throw new Error(`Server time moving backwards: ${now} < ${last.time}`);
        }
        if (now === last.time) {
          last.value = value;
          return;
        }
      }
      samples.push({ time: now, value });
      return;
    }
    if (!isSimpleObject(value)) {
      throw new Error(
        `HistoricalTable only supports numeric leaf values, found: ${JSON.stringify(value)}`,
      );
    }
    for (const [key, objectValue] of Object.entries(value)) {
      if (this.isReservedFieldName(key)) {
        continue;
      }
      this.appendToBuffer(sampleMap, now, `${fieldPath}.${key}`, objectValue);
    }
  }

  finishTick(now: number) {
    for (const [id, sampleMap] of this.history.entries()) {
      const row = this.data.get(id);
      if (!row) {
        throw new Error(`Invalid ID: ${id}`);
      }
      this.appendToBuffer(sampleMap, now, null, row);
    }
  }

  async save() {
    for (const id of this.deleted) {
      await this.db.delete(id);
    }
    for (const id of this.modified) {
      const row = this.data.get(id);
      if (!row) {
        throw new Error(`Invalid modified id: ${id}`);
      }
      if ('history' in row) {
        throw new Error(`Cannot save row with 'history' field`);
      }
      const sampleMap = this.history.get(id);
      if (sampleMap && sampleMap.size > 0) {
        (row as any).history = this.packSampleMap(sampleMap);
      }
      // Somehow TypeScript isn't able to figure out that our
      // generic `Doc<T>` unifies with `replace()`'s type.
      await this.db.replace(id, row as any);
    }
    this.modified.clear();
    this.deleted.clear();
  }

  packSampleMap(sampleMap: Map<number, Sample[]>): ArrayBuffer {
    const sampleArrays = [...sampleMap.entries()];
    sampleArrays.sort(([a], [b]) => a - b);

    const header = [];
    const allFloats = [];
    for (const [fieldPath, sampleBuffer] of sampleArrays) {
      header.push([fieldPath, sampleBuffer.length]);
      allFloats.push(...sampleBuffer.map((sample) => sample.time));
      allFloats.push(...sampleBuffer.map((sample) => sample.value));
    }
    const headerLength = new Uint32Array([header.length]);
    const textEncoder = new TextEncoder();
    const headerJson = JSON.stringify(header);
    const headerBytes = textEncoder.encode(headerJson);
    const floatBuffer = new Float64Array(allFloats);

    const out = new Uint8Array(
      headerLength.byteLength + headerBytes.byteLength + floatBuffer.byteLength,
    );
    out.set(new Uint8Array(headerLength.buffer), 0);
    out.set(new Uint8Array(headerBytes.buffer), headerLength.byteLength);
    out.set(new Uint8Array(floatBuffer.buffer), headerLength.byteLength + headerBytes.byteLength);
    return out.buffer;
  }
}

let logged = 0;
