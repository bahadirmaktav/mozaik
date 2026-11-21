// Media, documents and archives go to their default application without being read.
const BINARY =
  /\.(png|jpe?g|gif|bmp|webp|ico|tiff?|psd|pdf|zip|7z|rar|gz|tgz|bz2|xz|tar|iso|mp3|m4a|wav|flac|ogg|mp4|mkv|avi|mov|webm|docx?|xlsx?|pptx?|odt|ods|odp|exe|dll|so|dylib|msi|bin)$/i;
export const textLike = (path: string) => !BINARY.test(path);
/** A read refused because the file is not text (rather than a text file with a problem). */
export const notText = (error: unknown) =>
  /binary file|Unsupported encoding|allocation safety limit/.test(
    String(error),
  );
