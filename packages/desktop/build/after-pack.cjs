// electron-builder afterPack hook: without a Developer ID, give the macOS bundle a consistent ad-hoc signature under our
// own identifier (the linker's default is "Electron"), so Gatekeeper reports an unverified developer (right-click → Open
// works) instead of "damaged". Real distribution still needs a Developer ID certificate and notarization.
const { execSync } = require('node:child_process');
const path = require('node:path');
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_NAME || process.env.CSC_LINK) return; // a real identity is configured: electron-builder signs
  // a universal build packs x64 and arm64 first and merges them; signing those temp bundles makes their signature files
  // differ and the merge fails, so only sign the final bundle
  if (/-(x64|arm64)-temp$/.test(context.appOutDir)) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const id = context.packager.appInfo.id;
  execSync(`codesign --force --deep --sign - --identifier "${id}" "${app}"`, { stdio: 'inherit' });
  execSync(`codesign --verify --deep --strict "${app}"`, { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${app} as ${id}`);
};
