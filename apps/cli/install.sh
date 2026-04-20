#!/usr/bin/env bash
#
# Sia Storage CLI installer.
#
# Downloads the platform-specific `sia` binary into ~/.sia/bin, adds that
# directory to the user's shell PATH, and prints how to enable completions.

set -euo pipefail

# Host that serves the release binaries as `sia-storage-<os>-<arch>`. Fill in
# once a release host is wired up (e.g.
# `https://github.com/SiaFoundation/sia-storage-app/releases/latest/download`).
BASE_URL=""

INSTALL_DIR="${SIA_INSTALL:-$HOME/.sia}"
BIN_DIR="$INSTALL_DIR/bin"

if [ -z "$BASE_URL" ]; then
  printf "  error: BASE_URL is not configured in this installer yet\n" >&2
  exit 1
fi

# Colors are only emitted when stdout is a terminal so piped output stays clean.
if [ -t 1 ]; then
  BOLD='\033[1m'
  DIM='\033[2m'
  GREEN='\033[32m'
  RED='\033[31m'
  RESET='\033[0m'
  SIA='\033[38;2;30;214;96m'
else
  BOLD='' DIM='' GREEN='' RED='' RESET='' SIA=''
fi

info()    { printf "  ${DIM}%s${RESET}\n" "$1"; }
success() { printf "  ${GREEN}%s${RESET}\n" "$1"; }
error()   { printf "  ${RED}error${RESET}: %s\n" "$1" >&2; exit 1; }

# Returns "<os>-<arch>" matching the binary name on the release server.
detect_platform() {
  local os arch
  os=$(uname -s)
  arch=$(uname -m)

  case "$os" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *)      error "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64)   arch="x64" ;;
    aarch64|arm64)  arch="arm64" ;;
    *)              error "Unsupported architecture: $arch" ;;
  esac

  echo "${os}-${arch}"
}

# Streams $url to $dest using whichever of curl/wget is available.
download() {
  local url="$1" dest="$2"
  if command -v curl &>/dev/null; then
    curl --fail --location --silent --show-error --output "$dest" "$url"
  elif command -v wget &>/dev/null; then
    wget --quiet --show-progress --output-document="$dest" "$url"
  else
    error "curl or wget is required"
  fi
}

# Picks the rc file the user's login shell sources on startup.
detect_shell_config() {
  local shell_name
  shell_name=$(basename "${SHELL:-/bin/bash}")

  case "$shell_name" in
    zsh)  echo "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      if [ -f "$HOME/.bashrc" ]; then
        echo "$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      ;;
    fish) echo "${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish" ;;
    *)    echo "$HOME/.profile" ;;
  esac
}

# Appends the PATH export to $config_file, idempotently.
add_to_path() {
  local config_file="$1"
  local path_line="export PATH=\"$BIN_DIR:\$PATH\""

  if [ -f "$config_file" ] && grep -qF "$BIN_DIR" "$config_file"; then
    info "PATH already configured in $config_file"
  else
    {
      echo ""
      echo "# Sia Storage CLI"
      echo "$path_line"
    } >> "$config_file"
    info "Added to PATH in $config_file"
  fi
}

main() {
  printf "\n"
  printf "  ${SIA}${BOLD}Sia Storage CLI${RESET}\n"
  printf "\n"

  local platform
  platform=$(detect_platform)
  info "Platform: $platform"

  # Download the binary into a temp file first; only move it into place once
  # the transfer succeeds so a failed install never leaves a partial binary.
  mkdir -p "$BIN_DIR"
  local url="${BASE_URL}/sia-storage-${platform}"
  info "Downloading from ${url}..."
  printf "\n"

  local tmp
  tmp=$(mktemp)
  download "$url" "$tmp" &
  local dl_pid=$!

  # Render a spinner with running byte count while the background download runs.
  local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while kill -0 $dl_pid 2>/dev/null; do
    local c="${spin:i%${#spin}:1}"
    local size=0
    if [ -f "$tmp" ]; then
      size=$(wc -c < "$tmp" 2>/dev/null | tr -d ' ')
    fi
    local mb=$((size / 1048576))
    printf "\r  %s %d MB downloaded" "$c" "$mb" >&2
    i=$((i + 1))
    sleep 0.1
  done
  wait $dl_pid || error "Download failed"

  local final_size=$(wc -c < "$tmp" 2>/dev/null | tr -d ' ')
  local final_mb=$((final_size / 1048576))
  printf "\r  ${GREEN}Downloaded %d MB${RESET}              \n" "$final_mb" >&2
  mv "$tmp" "$BIN_DIR/sia"
  chmod +x "$BIN_DIR/sia"

  printf "\n"

  # Sanity-check the binary actually runs on this kernel/libc before reporting success.
  if ! "$BIN_DIR/sia" --version &>/dev/null; then
    error "Installation failed — binary is not executable on this system"
  fi

  local version
  version=$("$BIN_DIR/sia" --version 2>/dev/null || echo "unknown")
  success "Installed sia ${version} to ${BIN_DIR}/sia"

  local config_file
  config_file=$(detect_shell_config)

  # Interactive: ask before modifying the user's rc file.
  # Non-interactive (piped from curl): proceed automatically.
  if [ -t 0 ]; then
    printf "\n"
    printf "  Add to PATH? ${DIM}(modifies ${config_file})${RESET} [Y/n] "
    read -r answer </dev/tty
    case "$answer" in
      [nN]*) ;;
      *)     add_to_path "$config_file" ;;
    esac
  else
    add_to_path "$config_file"
  fi

  # Completions need an `eval` line in the rc file; we print it rather than
  # auto-add, since the user may want to gate it on shell version/plugins.
  printf "\n"
  info "To enable shell completions, add to ${config_file}:"
  printf "\n"
  printf "  ${BOLD}eval \"\$(${BIN_DIR}/sia completions)\"${RESET}\n"

  printf "\n"
  if command -v sia &>/dev/null; then
    info "Run 'sia connect' to get started."
  else
    info "Restart your shell, then run 'sia connect' to get started."
  fi
  printf "\n"
}

main "$@"
