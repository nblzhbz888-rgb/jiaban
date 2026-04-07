#!/bin/zsh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Missing dependency: Node.js is not installed."
  echo "Please install Node.js first, then try again."
  echo
  echo "Press Enter to close."
  read
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Missing dependency: pnpm is not installed."
  echo "Please install pnpm first, then try again."
  echo
  echo "Press Enter to close."
  read
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Dependencies are missing. Installing workspace dependencies..."
  pnpm install || exit 1
fi

prepare_package_if_needed() {
  local package_dir="$1"
  local package_name="$2"

  if [ -d "${package_dir}/dist" ] && find "${package_dir}/dist" -mindepth 1 -print -quit 2>/dev/null | grep -q .; then
    echo "Using cached workspace package: ${package_name}"
    return 0
  fi

  echo "Preparing workspace package: ${package_name}"
  pnpm -r --filter "${package_name}" build || return 1
}

prepare_package_if_needed "packages/plugin-protocol" "@jiaban/plugin-protocol" || exit 1
prepare_package_if_needed "packages/server-shared" "@jiaban/server-shared" || exit 1
prepare_package_if_needed "packages/server-runtime" "@jiaban/server-runtime" || exit 1

pnpm --dir apps/desktop dev
exit_code=$?

echo
echo "Jiaban exited with status ${exit_code}. Press Enter to close."
read

exit $exit_code
