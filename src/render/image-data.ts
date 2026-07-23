import type { Turn } from "../types.js";

const INLINE_IMAGE_DATA_SOURCE =
  String.raw`data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}`;
const EXACT_INLINE_IMAGE_DATA = new RegExp(`^${INLINE_IMAGE_DATA_SOURCE}$`, "i");

function isValidInlineImageData(value: string): boolean {
  if (!EXACT_INLINE_IMAGE_DATA.test(value)) return false;
  const payload = value.slice(value.indexOf(",") + 1);
  return payload.length > 0 && payload.length % 4 === 0;
}

export function containsInlineImageData(value: string | undefined): boolean {
  if (!value) return false;
  for (const match of value.matchAll(new RegExp(INLINE_IMAGE_DATA_SOURCE, "gi"))) {
    if (match[0] && isValidInlineImageData(match[0])) return true;
  }
  return false;
}

export function stripInlineImageData(value: string, placeholder = "[图片]"): string {
  const markdownImage = new RegExp(
    String.raw`!\[[^\]\r\n]*\]\((${INLINE_IMAGE_DATA_SOURCE})\)`,
    "gi",
  );
  const withoutMarkdownImages = value.replace(markdownImage, (match, dataUrl: string) =>
    isValidInlineImageData(dataUrl) ? placeholder : match);
  return withoutMarkdownImages.replace(
    new RegExp(INLINE_IMAGE_DATA_SOURCE, "gi"),
    (dataUrl) => isValidInlineImageData(dataUrl) ? placeholder : dataUrl,
  );
}

export function turnsContainImageBytes(turns: Turn[], extraText: readonly string[] = []): boolean {
  if (extraText.some((value) => containsInlineImageData(value))) return true;
  for (const turn of turns) {
    if ((turn.userImages?.length ?? 0) > 0) return true;
    if (containsInlineImageData(turn.userText) || containsInlineImageData(turn.userDisplayText)) return true;
    for (const block of turn.assistant) {
      if (
        containsInlineImageData(block.text)
        || containsInlineImageData(block.toolInput)
        || containsInlineImageData(block.toolPrimary)
        || containsInlineImageData(block.toolResult)
      ) {
        return true;
      }
    }
  }
  return false;
}
