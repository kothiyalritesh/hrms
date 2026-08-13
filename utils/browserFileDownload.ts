import { nativeBridge } from "@/services/nativeBridge/client";

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 32 * 1024;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

/** Saves normally in a browser and opens Android's native Save/Share sheet in the shell. */
export async function downloadBrowserBytes(
  value: ArrayBuffer | Uint8Array,
  filename: string,
  mimeType: string,
) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (!bytes.byteLength) throw new Error("The generated download is empty.");

  if (nativeBridge.isAvailable()) {
    await nativeBridge.request(
      "file.shareBase64",
      { filename, mimeType, base64: bytesToBase64(bytes) },
      120_000,
    );
    return;
  }

  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  const legacyNavigator = window.navigator as Navigator & {
    msSaveOrOpenBlob?: (blob: Blob, filename: string) => void;
  };
  if (typeof legacyNavigator.msSaveOrOpenBlob === "function") {
    legacyNavigator.msSaveOrOpenBlob(blob, filename);
    return;
  }
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  }, 1_000);
}
