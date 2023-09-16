export class MinHeap<T> {
  private tree: T[] = [];

  constructor(private lessThan: (a: T, b: T) => boolean) {}

  peek(): T | undefined {
    return this.tree[0];
  }

  length(): number {
    return this.tree.length;
  }

  push(newValue: T): void {
    let destinationIndex = this.tree.length;
    while (destinationIndex > 0) {
      const nextToCheck = destinationIndex >> 1;
      const existing = this.tree[nextToCheck];
      if (this.lessThan(existing, newValue)) break;
      this.tree[destinationIndex] = existing;
      destinationIndex = nextToCheck;
    }
    this.tree[destinationIndex] = newValue;
  }

  pop(): T | undefined {
    if (this.tree.length == 0) {
      return undefined;
    }
    const minValue = this.tree[0];
    // Fill the hole from popping the root with the last value
    // in the tree, temporarily breaking the heap invariant.
    // Reheapify the tree starting at the root.
    const candidate = this.tree.pop()!;
    let destinationIndex = 0;
    while (true) {
      const leftChild = destinationIndex * 2 + 1;
      const rightChild = destinationIndex * 2 + 2;

      // Examine the smaller of the two children.
      if (leftChild >= this.tree.length) {
        break;
      }
      let smallerChild = leftChild;
      if (
        rightChild < this.tree.length &&
        this.lessThan(this.tree[rightChild], this.tree[leftChild])
      ) {
        smallerChild = rightChild;
      }

      // If the child is smaller than our current value, we can insert
      // the current value at `destinationIndex` while preserving the
      // heap invariant.
      const childValue = this.tree[smallerChild];
      if (this.lessThan(candidate, childValue)) {
        break;
      }
      // Otherwise, swap the child and continue down the tree.
      this.tree[destinationIndex] = childValue;
      destinationIndex = smallerChild;
    }
    this.tree[destinationIndex] = candidate;
    return minValue;
  }
}
