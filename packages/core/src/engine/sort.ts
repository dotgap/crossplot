const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
/** Bins this small are insertion-sorted. */
const SMALL = 32;
const DIGIT = 11;
const RADIX = 1 << DIGIT;
const KEYS = 2 ** 32 - 1;

/**
 * Row ids grouped by bin (counting sort), so bin b's rows are
 * `order[offsets[b]] .. order[offsets[b + 1] - 1]`. Slot `size` holds missing
 * rows. With `values`, rows inside each bin are also sorted by value, which
 * turns a range filter's passing rows in a partially covered bin into one
 * contiguous slice.
 */
export function binOrder(
  bins: Uint32Array,
  size: number,
  values: Float64Array | null,
): { order: Uint32Array; offsets: Uint32Array } {
  const n = bins.length;
  const offsets = new Uint32Array(size + 2);
  for (let i = 0; i < n; i++) offsets[bins[i]! + 1]!++;
  for (let b = 0; b <= size; b++) offsets[b + 1]! += offsets[b]!;
  const cursor = offsets.slice(0, size + 1);
  const order = new Uint32Array(n);
  if (values === null) {
    for (let i = 0; i < n; i++) order[cursor[bins[i]!]!++] = i;
    return { order, offsets };
  }
  // Each bin's range of values, to skip single-valued bins and to scale keys.
  const min = new Float64Array(size).fill(Infinity);
  const max = new Float64Array(size).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    const b = bins[i]!;
    if (b === size) continue;
    const v = values[i]!;
    if (v < min[b]!) min[b] = v;
    if (v > max[b]!) max[b] = v;
  }
  const scale = new Float64Array(size);
  for (let b = 0; b < size; b++) scale[b] = KEYS / (max[b]! - min[b]!);
  // Scatter 32-bit sort keys along with the row ids so the per-bin sort reads
  // them in order. A key is the value's position in its bin's range: monotone
  // in the value, though nearby values may share one.
  const words = new Uint32Array(values.buffer, values.byteOffset, values.length * 2);
  const hiWord = LITTLE_ENDIAN ? 1 : 0;
  const keys = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const b = bins[i]!;
    const at = cursor[b]!++;
    order[at] = i;
    if (b === size) continue;
    const sc = scale[b]!;
    if (sc > 0 && sc < Infinity) {
      keys[at] = Math.min(KEYS, Math.floor((values[i]! - min[b]!) * sc));
    } else {
      // Infinite range: fall back to the high word of an order-preserving key.
      const h = words[2 * i + hiWord]!;
      keys[at] = h & 0x80000000 ? ~h >>> 0 : (h | 0x80000000) >>> 0;
    }
  }
  sortBins(order, offsets, keys, min, max, values);
  return { order, offsets };
}

/**
 * Sort each bin's slice of `order` by value. An LSD radix sort (11-bit
 * digits) orders rows by their 32-bit `keys`; runs that tie there are then
 * insertion-sorted on the full value. Digits that are the same across a bin
 * are skipped, and bins holding a single value are left alone.
 */
function sortBins(
  order: Uint32Array,
  offsets: Uint32Array,
  keys: Uint32Array,
  min: Float64Array,
  max: Float64Array,
  values: Float64Array,
): void {
  const size = min.length;
  let largest = 0;
  for (let b = 0; b < size; b++) largest = Math.max(largest, offsets[b + 1]! - offsets[b]!);
  let keyA = new Uint32Array(largest);
  let idA = new Uint32Array(largest);
  let keyB = new Uint32Array(largest);
  let idB = new Uint32Array(largest);
  const counts = new Uint32Array(RADIX);

  for (let b = 0; b < size; b++) {
    const start = offsets[b]!;
    const m = offsets[b + 1]! - start;
    if (m < 2 || !(min[b]! < max[b]!)) continue;
    keyA.set(keys.subarray(start, start + m));
    idA.set(order.subarray(start, start + m));

    if (m > SMALL) {
      for (let shift = 0; shift < 32; shift += DIGIT) {
        counts.fill(0);
        for (let k = 0; k < m; k++) counts[(keyA[k]! >>> shift) & (RADIX - 1)]!++;
        let sum = 0;
        let skip = false;
        for (let d = 0; d < RADIX; d++) {
          const c = counts[d]!;
          if (c === m) {
            skip = true;
            break;
          }
          counts[d] = sum;
          sum += c;
        }
        if (skip) continue;
        for (let k = 0; k < m; k++) {
          const at = counts[(keyA[k]! >>> shift) & (RADIX - 1)]!++;
          keyB[at] = keyA[k]!;
          idB[at] = idA[k]!;
        }
        [keyA, keyB] = [keyB, keyA];
        [idA, idB] = [idB, idA];
      }
    }
    // Insertion sort on (key, value). Large bins are already sorted by key,
    // so only rows that tie on the key move, and only within their run.
    for (let i = 1; i < m; i++) {
      const key = keyA[i]!;
      if (keyA[i - 1]! < key) continue;
      const r = idA[i]!;
      const v = values[r]!;
      let j = i - 1;
      while (j >= 0 && (keyA[j]! > key || (keyA[j] === key && values[idA[j]!]! > v))) {
        keyA[j + 1] = keyA[j]!;
        idA[j + 1] = idA[j]!;
        j--;
      }
      keyA[j + 1] = key;
      idA[j + 1] = r;
    }
    order.set(idA.subarray(0, m), start);
  }
}
