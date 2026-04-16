import { getPaths, getDataDir } from '@siastorage/node-adapters'
import { createDaemonClient } from '../lib/appServiceClient'

export async function completionsCommand(_dataDir: string, shell?: string) {
  const target = shell ?? (process.env.SHELL?.includes('zsh') ? 'zsh' : 'bash')

  if (target === 'zsh') {
    process.stdout.write(zshScript)
  } else {
    process.stdout.write(bashScript)
  }
}

export async function completeCommand(args: string[]) {
  const command = args[0]
  const partial = args.slice(1).join(' ').toLowerCase()

  try {
    const p = getPaths(getDataDir())
    const app = createDaemonClient(p.sockPath, 2000)

    switch (command) {
      case 'ls': {
        const dirs = await app.directories.getAll()
        const names = [...dirs.map((d: any) => d.name), 'No folder']
        for (const name of names) {
          if (name.toLowerCase().startsWith(partial)) {
            console.log(name.replace(/ /g, '\\ '))
          }
        }
        break
      }
      case 'info':
      case 'rm':
      case 'tag':
      case 'untag':
      case 'download': {
        const files = await app.files.query({
          limit: 100,
          order: 'DESC',
        })
        for (const f of files) {
          if (f.name.toLowerCase().startsWith(partial)) {
            console.log(f.name.replace(/ /g, '\\ '))
          }
        }
        break
      }
      default:
        break
    }
  } catch {
    // Completion should never crash the shell — daemon may not be running
  }
}

const zshScript = [
  '_sia() {',
  '  local -a commands',
  '  commands=(',
  "    'connect:Connect to a Sia indexer'",
  "    'daemon:Manage the background daemon'",
  "    'logs:Show daemon logs'",
  "    'ls:List files and directories'",
  "    'mkdir:Create a directory'",
  "    'rm:Remove a file or directory'",
  "    'add:Add a file'",
  "    'download:Download a file'",
  "    'mv:Move or rename a file or directory'",
  "    'info:Show file details'",
  "    'status:Show sync and storage status'",
  "    'sync:Show sync status'",
  "    'tags:List all tags'",
  "    'tag:Add a tag to a file'",
  "    'untag:Remove a tag from a file'",
  "    'search:Search files'",
  "    'config:View or set configuration'",
  "    'import:Recursively import files from a local directory'",
  "    'completions:Generate shell completions'",
  '  )',
  '',
  '  if (( CURRENT == 2 )); then',
  "    _describe 'command' commands",
  '    return',
  '  fi',
  '',
  '  local partial="${words[3,-1]}"',
  '',
  '  case "${words[2]}" in',
  '    ls|info|rm|download|tag|untag|mv)',
  '      local -a completions',
  '      completions=("${(@f)$(sia __complete ${words[2]} $partial)}")',
  '      if [[ -n "${completions[1]}" ]]; then',
  '        compadd -Q -S "" -- "${completions[@]}"',
  '      fi',
  '      ;;',
  '    add|import)',
  '      _files',
  '      ;;',
  '    daemon)',
  '      local -a actions',
  '      actions=(start stop restart status)',
  '      compadd -- "${actions[@]}"',
  '      ;;',
  '  esac',
  '}',
  '',
  'compdef _sia sia',
  '',
].join('\n')

const bashScript = [
  '_sia() {',
  '  local cur prev commands',
  '  COMPREPLY=()',
  '  cur="${COMP_WORDS[COMP_CWORD]}"',
  '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
  '  commands="connect daemon logs ls mkdir rm add download mv info status sync tags tag untag search config import completions"',
  '',
  '  if [[ ${COMP_CWORD} -eq 1 ]]; then',
  '    COMPREPLY=( $(compgen -W "${commands}" -- "${cur}") )',
  '    return',
  '  fi',
  '',
  '  case "${COMP_WORDS[1]}" in',
  '    ls|info|rm|download|tag|untag|mv)',
  '      local completions',
  '      completions=$(sia __complete "${COMP_WORDS[1]}" "${COMP_WORDS[@]:2}" 2>/dev/null)',
  '      COMPREPLY=( $(compgen -W "${completions}" -- "${cur}") )',
  '      ;;',
  '    add|import)',
  '      COMPREPLY=( $(compgen -f -- "${cur}") )',
  '      ;;',
  '    daemon)',
  '      COMPREPLY=( $(compgen -W "start stop restart status" -- "${cur}") )',
  '      ;;',
  '  esac',
  '}',
  '',
  'complete -F _sia sia',
  '',
].join('\n')
