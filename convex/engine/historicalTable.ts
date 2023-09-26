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

  data: Map<Id<T>, Doc<T>> = new Map();
  modified: Set<Id<T>> = new Set();
  deleted: Set<Id<T>> = new Set();

  history: Map<Id<T>, Map<FieldPath, Sample[]>> = new Map();

  constructor(rows: Doc<T>[]) {
    for (const row of rows) {
      this.checkNumeric(row);
      this.data.set(row._id, row);
    }
  }

  checkNumeric(obj: any) {
    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('_')) {
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

  async insert(row: WithoutSystemFields<Doc<T>>): Promise<Id<T>> {
    this.checkNumeric(row);
    const id = await this.db.insert(this.table, row);
    const withSystemFields = await this.db.get(id);
    if (!withSystemFields) {
      throw new Error(`Failed to db.get() inserted row`);
    }
    this.data.set(id, withSystemFields);
    return id;
  }

  lookup(id: Id<T>, now: number): Doc<T> {
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
          this.markModified(id, now, `${path}.${prop}`, value);
          if (typeof prop === 'string' && typeof value === 'number') {
          }
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
    this.modified.add(id);
    let sampleMap = this.history.get(id);
    if (!sampleMap) {
      sampleMap = new Map();
      this.history.set(id, sampleMap);
    }
    this.appendToBuffer(sampleMap, now, fieldPath, value);
  }

  private appendToBuffer(
    sampleMap: Map<FieldPath, Sample[]>,
    now: number,
    fieldPath: FieldPath,
    value: any,
  ) {
    if (typeof value === 'number') {
      let samples = sampleMap.get(fieldPath);
      if (!samples) {
        samples = [];
        sampleMap.set(fieldPath, samples);
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
      this.appendToBuffer(sampleMap, now, `${fieldPath}.${key}`, value);
    }
  }
}
