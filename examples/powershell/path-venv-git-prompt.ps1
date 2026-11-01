# A PowerShell prompt with the folder, the active Python environment and the Git branch:
#
#    ~\..\mozaik (.venv) git(main) >>
#
# No modules or programs are needed: Git's branch is read from .git/HEAD, never by running
# git, so the prompt stays fast in large repositories. Works in Windows PowerShell 5.1 and
# PowerShell 7. The file is ASCII only; special characters are built with [char].
#
# Mozaik: Workspace Settings -> Terminal -> PowerShell prompt -> choose this file (or a copy
# you changed). New PowerShell terminals run it after your profile.
# Other terminals: add  . "C:\path\to\path-venv-git-prompt.ps1"  to your $PROFILE.

$PromptEscape = [char]27
function Get-PromptColor([string]$Hex) {
    $r = [Convert]::ToInt32($Hex.Substring(1, 2), 16)
    $g = [Convert]::ToInt32($Hex.Substring(3, 2), 16)
    $b = [Convert]::ToInt32($Hex.Substring(5, 2), 16)
    "$PromptEscape[38;2;${r};${g};${b}m"
}
$PromptColors = @{
    Path   = Get-PromptColor '#56B6C2'
    Venv   = Get-PromptColor '#9E7EFF'
    Git    = Get-PromptColor '#E8CC97'
    Branch = Get-PromptColor '#56B6C2'
    Mark   = Get-PromptColor '#FFE082'
    Reset  = "$PromptEscape[0m"
}
# U+276F twice; replace with '>>' if your font lacks it.
$PromptMark = [string][char]0x276F * 2

# The environment is shown here, so venv's Activate.ps1 should not add its own "(name)".
$env:VIRTUAL_ENV_DISABLE_PROMPT = '1'

# The root (or ~), then ".." for the folders in between and the current folder.
function Get-PromptPath {
    $location = $ExecutionContext.SessionState.Path.CurrentLocation
    if ($location.Provider.Name -ne 'FileSystem') { return $location.Path }
    $path = $location.ProviderPath
    if ($path.Length -gt [IO.Path]::GetPathRoot($path).Length) { $path = $path.TrimEnd('\', '/') }
    $separator = [IO.Path]::DirectorySeparatorChar
    $home_ = $HOME.TrimEnd('\', '/')
    if ($path -eq $home_) { return '~' }
    if ($path.StartsWith($home_ + $separator, [StringComparison]::OrdinalIgnoreCase)) {
        $root = '~'
        $rest = $path.Substring($home_.Length + 1)
    } else {
        $root = [IO.Path]::GetPathRoot($path).TrimEnd('\', '/')
        $rest = $path.Substring([IO.Path]::GetPathRoot($path).Length)
        if (-not $rest) { return [IO.Path]::GetPathRoot($path) }
    }
    $parts = $rest.Split([char[]]@('\', '/'), [StringSplitOptions]::RemoveEmptyEntries)
    if ($parts.Count -le 1) { return "$root$separator$rest" }
    "$root$separator..$separator$($parts[-1])"
}

# The active virtual environment or Conda environment, or nothing.
function Get-PromptVenv {
    if ($env:VIRTUAL_ENV) { return Split-Path -Leaf $env:VIRTUAL_ENV }
    if ($env:CONDA_DEFAULT_ENV) { return $env:CONDA_DEFAULT_ENV }
}

# The branch (or a short commit when detached) of the repository around the folder.
function Get-PromptBranch {
    $location = $ExecutionContext.SessionState.Path.CurrentLocation
    if ($location.Provider.Name -ne 'FileSystem') { return }
    $folder = $location.ProviderPath
    while ($folder) {
        $dotGit = Join-Path $folder '.git'
        if (Test-Path -LiteralPath $dotGit -PathType Container) {
            $gitDir = $dotGit
        } elseif (Test-Path -LiteralPath $dotGit -PathType Leaf) {
            # Worktrees and submodules: ".git" is a file naming the real folder.
            $line = Get-Content -LiteralPath $dotGit -TotalCount 1 -ErrorAction SilentlyContinue
            if ($line -notmatch '^gitdir:\s*(.+)$') { return }
            $gitDir = $Matches[1].Trim()
            if (-not [IO.Path]::IsPathRooted($gitDir)) { $gitDir = Join-Path $folder $gitDir }
        }
        if ($gitDir) {
            $head = Get-Content -LiteralPath (Join-Path $gitDir 'HEAD') -TotalCount 1 -ErrorAction SilentlyContinue
            if ($head -match '^ref:\s*refs/heads/(.+)$') { return $Matches[1] }
            if ($head -match '^[0-9a-f]{7,}') { return $head.Substring(0, 7) }
            return
        }
        $folder = Split-Path -Parent $folder
    }
}

function global:prompt {
    $exitCode = $global:LASTEXITCODE
    $c = $PromptColors
    $text = "$($c.Path) $(Get-PromptPath) "
    $venv = Get-PromptVenv
    if ($venv) { $text += "$($c.Venv)($venv) " }
    $branch = Get-PromptBranch
    if ($branch) { $text += "$($c.Git)git($($c.Branch)$branch$($c.Git)) " }
    $text += "$($c.Mark)$PromptMark$($c.Reset) "
    $global:LASTEXITCODE = $exitCode
    $text
}
