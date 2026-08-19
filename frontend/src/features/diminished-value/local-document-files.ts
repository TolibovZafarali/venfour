const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
const ACCEPTED_EXTENSION_PATTERN = /\.(?:pdf|jpe?g|png|heic|heif)$/iu;

export function mergeUniqueFiles(
  currentFiles: readonly File[],
  incomingFiles: readonly File[],
) {
  const filesByIdentity = new Map(
    currentFiles.map((file) => [fileIdentity(file), file]),
  );
  for (const file of incomingFiles) {
    if (!filesByIdentity.has(fileIdentity(file))) {
      filesByIdentity.set(fileIdentity(file), file);
    }
  }
  return [...filesByIdentity.values()];
}

export function isAcceptedFile(file: File) {
  return (
    ACCEPTED_MIME_TYPES.has(file.type.toLocaleLowerCase("en-US")) ||
    ACCEPTED_EXTENSION_PATTERN.test(file.name)
  );
}

export function fileIdentity(file: File) {
  return [file.name, file.size, file.lastModified, file.type].join("\u0000");
}
