// Vite imports the markdown as a plain string at build time. Edit
// `billy-prompt.md` to change the assistant's personality / knowledge —
// no code changes needed, just bump the .md and rebuild.
import prompt from "./billy-prompt.md?raw";

export const BILLY_SYSTEM_PROMPT: string = prompt;
