// updates — finding and installing a new version (tauri-plugin-updater, latest.json on the
// GitHub release). Installed copies (installer, winget, macOS .app) install in place; the
// standalone exe can only be pointed at the download (see install_kind in lib.rs).

export const RELEASES = 'https://github.com/Markus-Wildgruber/breathpause/releases';
export const releaseUrl = (version) => `${RELEASES}/tag/v${version}`;

// The update, or null when this is the newest version. Throws when offline or the release
// has no latest.json yet; callers decide whether that is worth showing.
export async function findUpdate() {
  const { check } = await import('@tauri-apps/plugin-updater');
  return check();
}

// 'installed' | 'standalone'
export async function installKind() {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('install_kind');
}

// Download + install with a progress callback (0–100, or null while the size is unknown),
// then restart into the new version.
export async function installUpdate(update, onProgress) {
  let total = 0, got = 0;
  await update.downloadAndInstall((ev) => {
    if (ev.event === 'Started') total = ev.data.contentLength || 0;
    else if (ev.event === 'Progress') {
      got += ev.data.chunkLength;
      onProgress(total ? Math.min(100, Math.round((got / total) * 100)) : null);
    }
  });
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
