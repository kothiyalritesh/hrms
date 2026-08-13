const fs = require("fs");
const path = require("path");

const sampleRate = 44100;
const durationSeconds = 0.65;
const sampleCount = Math.floor(sampleRate * durationSeconds);
const dataSize = sampleCount * 2;
const output = Buffer.alloc(44 + dataSize);

output.write("RIFF", 0);
output.writeUInt32LE(36 + dataSize, 4);
output.write("WAVE", 8);
output.write("fmt ", 12);
output.writeUInt32LE(16, 16);
output.writeUInt16LE(1, 20);
output.writeUInt16LE(1, 22);
output.writeUInt32LE(sampleRate, 24);
output.writeUInt32LE(sampleRate * 2, 28);
output.writeUInt16LE(2, 32);
output.writeUInt16LE(16, 34);
output.write("data", 36);
output.writeUInt32LE(dataSize, 40);

for (let index = 0; index < sampleCount; index += 1) {
  const time = index / sampleRate;
  const envelope = Math.max(0, 1 - time / durationSeconds);
  const firstTone = Math.sin(2 * Math.PI * 880 * time);
  const secondTone =
    time > 0.2 ? Math.sin(2 * Math.PI * 1174.66 * (time - 0.2)) : 0;
  const sample = Math.max(
    -1,
    Math.min(1, (firstTone * 0.65 + secondTone * 0.35) * envelope),
  );
  output.writeInt16LE(Math.round(sample * 32767 * 0.55), 44 + index * 2);
}

const outputDirectory = path.join(__dirname, "..", "assets", "sounds");
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "arrival_ping.wav"), output);
