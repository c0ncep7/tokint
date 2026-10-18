import { deflateRawSync } from 'node:zlib';

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Small classic ZIP writer: no system zip executable or additional dependency.
// Stable entry ordering and a fixed 1980 timestamp make archives reproducible.
export function zip(entries) {
  if (entries.length > 65535) throw new Error('Too many files for a classic ZIP.');
  const local = [], directory = [], seen = new Set();
  let offset = 0;
  for (const { name, data } of [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').some(part => !part || part === '.' || part === '..') || seen.has(name)) throw new Error(`Invalid archive path: ${name}`);
    seen.add(name);
    const filename = Buffer.from(name), compressed = deflateRawSync(data, { level: 9 });
    if (filename.length > 65535 || data.length > 0xffffffff || offset + 30 + filename.length + compressed.length > 0xffffffff) throw new Error('Archive exceeds classic ZIP limits.');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4); // Version needed.
    header.writeUInt16LE(0x800, 6); // UTF-8 paths.
    header.writeUInt16LE(8, 8); // Deflate.
    header.writeUInt16LE(33, 12); // 1980-01-01.
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    header.copy(record, 6, 4, 30);
    record.writeUInt32LE(offset, 42);
    directory.push(record, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const central = Buffer.concat(directory);
  if (offset + central.length > 0xffffffff) throw new Error('Archive exceeds classic ZIP limits.');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}
