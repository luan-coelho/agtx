import { open as openDialog } from "@tauri-apps/plugin-dialog";

export async function pickDirectory(options?: {
  defaultPath?: string;
  title?: string;
}): Promise<string | null> {
  try {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: options?.defaultPath,
      title: options?.title ?? "Escolha um diretório",
    });
    return typeof picked === "string" ? picked : null;
  } catch (e) {
    console.warn("pickDirectory failed", e);
    return null;
  }
}
