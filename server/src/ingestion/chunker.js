import { config } from '../config.js';

/**
 * Line-aware splitter: packs whole lines up to `chunkSize` characters, then
 * carries roughly `overlap` characters of trailing lines into the next chunk so
 * a construct split across a boundary is still retrievable from both sides.
 * Every chunk is prefixed with its path — that prefix gets embedded too, which
 * is what lets "where is the auth code" match on filenames as well as bodies.
 */
export function chunkText(content, filePath, chunkSize = config.chunkSize, overlap = config.chunkOverlap) {
  const lines = content.split('\n');
  const chunks = [];

  let currentChunk = [];
  let currentSize = 0;
  let chunkIndex = 0;

  const push = () => {
    chunks.push({
      path: filePath,
      content: `File: ${filePath}\n\n${currentChunk.join('\n')}`,
      chunkIndex: chunkIndex++,
    });
  };

  for (const line of lines) {
    const lineSize = line.length + 1;

    if (currentSize + lineSize > chunkSize && currentChunk.length > 0) {
      push();

      const overlapLines = [];
      let overlapSize = 0;
      for (let i = currentChunk.length - 1; i >= 0; i--) {
        if (overlapSize + currentChunk[i].length >= overlap) break;
        overlapLines.unshift(currentChunk[i]);
        overlapSize += currentChunk[i].length;
      }

      currentChunk = overlapLines;
      currentSize = overlapSize;
    }

    currentChunk.push(line);
    currentSize += lineSize;
  }

  if (currentChunk.length > 0) push();

  return chunks;
}

export function chunkFiles(files) {
  return files.flatMap((file) => chunkText(file.content, file.path));
}
