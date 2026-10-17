import { requireOptionalNativeModule } from "expo";

export async function saveToDownloads(
  sourceUri: string,
  filename: string,
  mimeType: string,
): Promise<string> {
  const module = requireOptionalNativeModule<{
    saveAsync(sourceUri: string, filename: string, mimeType: string): Promise<string>;
  }>("StockroomDownloads");
  if (!module) {
    throw Error("Direct downloads require a new Android build of Stockroom.");
  }
  return module.saveAsync(sourceUri, filename, mimeType);
}
